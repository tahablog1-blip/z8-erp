# modules/products/service.py — منطق الأعمال معزول عن طبقة الـ HTTP
# الاستعلامات منقولة من products.routes.js القديم بالحرف — نفس صيغة $1
import re
from decimal import Decimal

import asyncpg
from fastapi import HTTPException

from ...core.db import execute, fetch, fetchrow, transaction

# الأعمدة اللي بترجع للواجهة — مكتوبة صراحةً بدل SELECT *
# عشان أي عمود جديد يتضاف للجدول ما يسربش للواجهة من غير قصد.
_COLS = """id, category, name, spec, unit, barcode, sku, price, price_vat, is_service, is_oil, is_oil_filter, oil_brand,
           oil_type, filter_kind, cost_price, min_qty, service_interval_km, is_active, created_at"""

# نفس الأعمدة بدون price/price_vat — تُستخدم وقت تطبيق قائمة أسعار مخصّصة،
# عشان نستبدل السعرين بـ COALESCE مع price_list_items بدل العمودين الأصليين
_COLS_NO_PRICE = [c.strip() for c in _COLS.split(",") if c.strip() not in ("price", "price_vat")]

def _row_out(r: dict) -> dict:
    """UUID → نص، و NUMERIC (Decimal) → float عشان JSON"""
    r = dict(r)
    r["id"] = str(r["id"])
    for k in ("price", "price_vat", "cost_price", "stock_qty"):
        if isinstance(r.get(k), Decimal):
            r[k] = float(r[k])
    return r


# ── استنتاج الفئة تلقائياً لو الموظف سابها فاضية ──
# نفس قواعد الاستيراد بالظبط، عشان الفئة تفضل متسقة سواء الصنف اتضاف
# يدوياً أو باستيراد إكسيل. "الفئة" مش إلزامية حالياً بقرار عمل مؤقت.
_CATEGORY_GUESS_RULES = [
    (re.compile(r"فلتر|فلاتر"), "فلاتر"),
    (re.compile(r"زيت"), "زيوت"),
    (re.compile(r"شحم"), "شحوم"),
    (re.compile(r"معطر"), "معطرات"),
    (re.compile(r"منظف"), "منظفات"),
    (re.compile(r"فرامل|دركسيون|جير|تبريد"), "سوائل ومعالجات"),
]


def guess_category_from_name(name: str) -> str:
    n = str(name or "")
    for rx, cat in _CATEGORY_GUESS_RULES:
        if rx.search(n):
            return cat
    return "أخرى"


def _unique_violation_message(err: asyncpg.UniqueViolationError) -> str:
    constraint = err.constraint_name or ""
    if "barcode" in constraint:
        return "الباركود مستخدم بالفعل لصنف آخر"
    if "sku" in constraint:
        return "رمز SKU هذا مستخدم بالفعل لصنف آخر"
    return "هذا الصنف مسجل بالفعل بنفس الفئة والاسم واللزوجة"


async def _next_sku(company_id: str) -> str:
    """SKU تسلسلي مستقل عن الباركود — رقم كتالوج داخلي ثابت لا يتغير حتى لو الصنف
    اتغيّر باركوده أو مفيش له باركود من الأساس (شائع في قطع الغيار). نفس آلية ترقيم
    المستندات (document_counters) المستخدمة في المشتريات."""
    row = await fetchrow(
        """INSERT INTO document_counters (company_id, doc_type, last_number) VALUES ($1,'product_sku',1)
           ON CONFLICT (company_id, doc_type) DO UPDATE SET last_number = document_counters.last_number + 1
           RETURNING last_number""",
        company_id)
    return f"SKU-{row['last_number']:06d}"


# ══════════════════ قراءة ══════════════════

async def list_products(company_id: str, search: str | None = None, price_list_id: str | None = None) -> list[dict]:
    params: list = [company_id]
    where = "p.company_id = $1 AND p.is_active = TRUE"
    if search:
        params.append(f"%{search}%")
        i = len(params)
        where += (f" AND (p.category ILIKE ${i} OR p.name ILIKE ${i} "
                  f"OR p.spec ILIKE ${i} OR p.barcode ILIKE ${i})")
    # قائمة أسعار مخصّصة (عميل معيّن عليها): نفس الأعمدة لكن price/price_vat
    # تُستبدل بسعر القائمة لو الصنف له تخصيص فيها، وإلا السعر العادي كما هو —
    # صفر تغيير لأي شاشة ما بتبعتش priceListId
    if price_list_id:
        params.append(price_list_id)
        pli = len(params)
        cols = ", ".join(f"p.{c}" for c in _COLS_NO_PRICE)
        price_sql = ("COALESCE(pli.price, p.price) AS price, "
                     "COALESCE(pli.price_vat, p.price_vat) AS price_vat, "
                     "(pli.id IS NOT NULL) AS price_overridden,")
        join_sql = f"LEFT JOIN price_list_items pli ON pli.product_id = p.id AND pli.price_list_id = ${pli}"
    else:
        cols = ", ".join(f"p.{c.strip()}" for c in _COLS.split(","))
        price_sql = ""
        join_sql = ""
    # المخزون الفعلي: مجموع الرصيد في كل الفروع (loc_type='branch') لكل صنف —
    # عمود إضافي جديد stock_qty لا يكسر أي مستهلك حالي للمسار
    rows = await fetch(
        f"""SELECT {cols}, {price_sql}
                  COALESCE((SELECT SUM(inv.qty) FROM inventory inv
                             WHERE inv.product_id = p.id AND inv.loc_type = 'branch'), 0) AS stock_qty,
                  (p.image_base64 IS NOT NULL) AS has_image
           FROM products p {join_sql} WHERE {where} ORDER BY p.category, p.name, p.spec""", *params
    )
    return [_row_out(r) for r in rows]


async def get_by_barcode(company_id: str, code: str, price_list_id: str | None = None) -> dict:
    if price_list_id:
        cols = ", ".join(f"p.{c}" for c in _COLS_NO_PRICE)
        row = await fetchrow(
            f"""SELECT {cols}, COALESCE(pli.price, p.price) AS price,
                      COALESCE(pli.price_vat, p.price_vat) AS price_vat,
                      (pli.id IS NOT NULL) AS price_overridden
               FROM products p
               LEFT JOIN price_list_items pli ON pli.product_id = p.id AND pli.price_list_id = $3
               WHERE p.company_id = $1 AND p.barcode = $2 AND p.is_active = TRUE""",
            company_id, code, price_list_id,
        )
    else:
        row = await fetchrow(
            f"""SELECT {_COLS} FROM products p
                WHERE company_id = $1 AND barcode = $2 AND is_active = TRUE""",
            company_id, code,
        )
    if not row:
        raise HTTPException(404, "لا يوجد صنف بهذا الباركود")
    return _row_out(row)


async def cascade_categories(company_id: str) -> list[str]:
    rows = await fetch(
        """SELECT DISTINCT category FROM products
           WHERE company_id = $1 AND is_active = TRUE ORDER BY category""",
        company_id,
    )
    return [r["category"] for r in rows]


async def cascade_names(company_id: str, category: str) -> list[str]:
    rows = await fetch(
        """SELECT DISTINCT name FROM products
           WHERE company_id = $1 AND category = $2 AND is_active = TRUE ORDER BY name""",
        company_id, category,
    )
    return [r["name"] for r in rows]


async def cascade_specs(company_id: str, category: str, name: str) -> list[dict]:
    rows = await fetch(
        """SELECT id, spec, price, price_vat, barcode FROM products
           WHERE company_id = $1 AND category = $2 AND name = $3 AND is_active = TRUE
           ORDER BY spec""",
        company_id, category, name,
    )
    return [_row_out(r) for r in rows]


# ══════════════════ كتابة ══════════════════

async def create_product(company_id: str, d: dict) -> dict:
    # ── التدقيق الذكي وقت الإنشاء: الصنف يدخل النظام نضيف ومصنّف من أول لحظة ──
    d["name"] = _normalize_product_name(d["name"]) or d["name"]
    category = (d.get("category") or "").strip()
    if not category:
        hit = _classify_name(f"{d['name']} {d.get('spec') or ''}")
        if hit:
            category, d["isOil"], d["isOilFilter"] = hit[0], hit[1] or bool(d.get("isOil")), hit[2] or bool(d.get("isOilFilter"))
        else:
            category = guess_category_from_name(d["name"])
    # شركة الزيت تلقائياً من الاسم (لو زيت ومفيش شركة محددة)
    if not d.get("oilBrand") and (d.get("isOil") or "زيت" in d["name"]):
        low = f" {d['name'].lower()} "
        for bn, keys in _BRAND_ALIASES.items():
            if any(k.lower() in low for k in keys + [bn.lower()]):
                d["oilBrand"] = bn
                break
    sku = (d.get("sku") or "").strip() or await _next_sku(company_id)
    try:
        row = await fetchrow(
            f"""INSERT INTO products
                  (company_id, category, name, spec, unit, barcode, sku,
                   price, cost_price, min_qty, service_interval_km, is_service, is_oil, is_oil_filter, oil_brand, oil_type, filter_kind)
                VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
                RETURNING {_COLS}""",
            company_id, category, d["name"], d.get("spec", ""), d.get("unit", "قطعة"),
            d.get("barcode") or None, sku,
            Decimal(str(d.get("price", 0))), Decimal(str(d.get("costPrice", 0))),
            d.get("minQty", 0), d.get("serviceIntervalKm"), bool(d.get("isService", False)),
            bool(d.get("isOil", False)), bool(d.get("isOilFilter", False)), d.get("oilBrand"),
            d.get("oilType"), d.get("filterKind"),
        )
    except asyncpg.UniqueViolationError as e:
        raise HTTPException(409, _unique_violation_message(e))
    return _row_out(row)


_COL_MAP = {
    "category": "category", "name": "name", "spec": "spec", "unit": "unit",
    "barcode": "barcode", "sku": "sku", "price": "price", "costPrice": "cost_price",
    "minQty": "min_qty", "serviceIntervalKm": "service_interval_km",
    "isService": "is_service", "isOil": "is_oil", "isOilFilter": "is_oil_filter",
    "oilBrand": "oil_brand", "oilType": "oil_type", "filterKind": "filter_kind",
}
_DECIMAL_KEYS = {"price", "costPrice"}


async def update_product(company_id: str, product_id: str, fields: dict) -> dict:
    # exclude_unset في الـ API بيضمن إن اللي وصل هنا هو اللي المستخدم بعته فعلاً،
    # فـ None هنا معناها "امسح القيمة" مش "متغيرتش" — الباركود وفترة الصيانة
    # لازم يكون ممكن تفريغهم.
    updates = {k: v for k, v in fields.items() if k in _COL_MAP}
    if not updates:
        raise HTTPException(400, "لا يوجد ما يُحدَّث")

    set_parts, values = [], []
    for i, (k, v) in enumerate(updates.items(), start=3):
        set_parts.append(f"{_COL_MAP[k]} = ${i}")
        if k == "sku" and v is not None and not str(v).strip():
            v = None   # فراغ = امسح الـ SKU (الفهرس الفريد يتجاهل NULL فقط — فراغ متكرر يتعارض)
        values.append(Decimal(str(v)) if (k in _DECIMAL_KEYS and v is not None) else v)

    try:
        row = await fetchrow(
            f"""UPDATE products SET {', '.join(set_parts)}, updated_at = now()
                WHERE id = $1 AND company_id = $2
                RETURNING {_COLS}""",
            product_id, company_id, *values,
        )
    except asyncpg.UniqueViolationError as e:
        raise HTTPException(409, _unique_violation_message(e))
    if not row:
        raise HTTPException(404, "الصنف غير موجود")
    return _row_out(row)


async def deactivate_product(company_id: str, product_id: str) -> str:
    """حذف ناعم — الفواتير والحركات التاريخية المرتبطة بالصنف تفضل سليمة"""
    row = await fetchrow(
        """UPDATE products SET is_active = FALSE, updated_at = now()
           WHERE id = $1 AND company_id = $2 AND is_active = TRUE
           RETURNING name""",
        product_id, company_id,
    )
    if not row:
        raise HTTPException(404, "الصنف غير موجود")
    return row["name"]


# ══════════════════ المصنّف الذكي الجماعي ══════════════════
# قواعد مفردات قطاع خدمة السيارات — الترتيب مهم: الأخص أولاً
# (التصنيف، الكلمات المفتاحية، صنف زيت؟، فلتر زيت؟)
_CLASSIFY_RULES: list[tuple[str, list[str], bool, bool]] = [
    ("فلاتر زيت",        ["فلتر زيت", "فلتر الزيت", "oil filter", "فلترزيت"], False, True),
    ("فلاتر هواء",       ["فلتر هواء", "فلتر الهواء", "air filter"], False, False),
    ("فلاتر مكيف",       ["فلتر مكيف", "فلتر المكيف", "فلتر كبينة", "كابينة"], False, False),
    ("فلاتر ديزل وبنزين", ["فلتر ديزل", "فلتر بنزين", "فلتر سولار", "فلتر وقود"], False, False),
    ("فلاتر",            ["فلتر", "فلاتر"], False, False),
    ("زيوت قير ودفرنس",  ["قير", "دفرنس", "atf", "gear"], False, False),
    ("جريس وشحوم",       ["جريس", "شحم", "شحوم"], False, False),
    ("إضافات ومعالجات",  ["معالج", "منظف دورة", "اضافة", "إضافة", "additive", "flush"], False, False),
    ("زيوت",             ["زيت", "شيل ", "موبيل", "كاسترول", "توتال ", "بترومين", "رافينول",
                          "ليكوي", "ليكوى", "فالفولين", "valvoline", "فوكس ", "هليكس", "روميلا",
                          "ريميولا", "دلفاك", "كوارتز", "5w", "10w", "15w", "20w", "0w"], True, False),
    ("مناشف ونظافة",     ["منشفه", "منشفة", "مناشف", "فوطة", "فوط ", "ستوكينه"], False, False),
    ("سوائل تبريد",      ["رديتر", "راديتر", "كولنت", "coolant", "تبريد", "انتي فريز"], False, False),
    ("ماء مساحات ومساحات", ["مساحات", "مساحة زجاج", "ويبر"], False, False),
    ("بواجي",            ["بوجيه", "بواجي", "شمعات", "شمعة احتراق", "spark"], False, False),
    ("بطاريات",          ["بطارية", "بطاريات"], False, False),
    ("منظفات وعناية",    ["منظف", "ملمع", "شامبو", "معطر", "واكس"], False, False),
]


import re as _re2

# ══ منظّف الاسم الحتمي: شوائب الاستيراد المعروفة — يشتغل دايماً حتى بدون ذكاء ══
_NOISE = dict.fromkeys(map(ord, "\u200e\u200f\u202a\u202b\u202c\u200b\ufeff\u0640"))
def _normalize_product_name(name: str) -> str:
    s = str(name or "").translate(_NOISE)
    s = _re2.sub(r"\s*\d+\s*\*+\s*$", "", s)      # لاحقة الكرتونة: "... 1لتر 12*"→ تشال 12*
    s = _re2.sub(r"\*+", " ", s)                      # أي نجوم متبقية
    s = " ".join(s.split())
    return s.strip()


_AI_CATEGORIES = [c[0] for c in []]  # يُملأ ديناميكياً وقت النداء


async def _ai_classify_batch(items: list[dict], categories: list[str]) -> dict[str, tuple[str, bool, bool]]:
    """تصنيف بالذكاء — اختيار مغلق من قائمة فئات محددة (مش نص حر) = دقة شبه كاملة.
    يرجع {product_id: (category, is_oil, is_filter)} للي اتصنفوا بثقة فقط."""
    from ...core import ai as _ai
    cats_txt = "\n".join(f"{i}: {c}" for i, c in enumerate(categories))
    out: dict[str, tuple[str, bool, bool]] = {}
    CHUNK = 30
    for start in range(0, len(items), CHUNK):
        batch = items[start:start + CHUNK]
        listing = "\n".join(f'{j}| {it["name"]}' for j, it in enumerate(batch))
        prompt = (
            "منتجات مركز خدمة زيوت سيارات. صنّف كل منتج باختيار رقم فئة من القائمة المغلقة فقط:\n"
            f"{cats_txt}\n"
            "قواعد: cat = رقم الفئة (إجباري من القائمة). oil = هل هو زيت محرك/قير (true/false). "
            "filter_oil = هل هو فلتر زيت تحديداً. لو مش قادر تحسم بثقة، لا تُرجع السطر أصلاً.\n"
            f"المنتجات (رقم| الاسم):\n{listing}\n"
            'رد بمصفوفة JSON فقط: [{"i":0,"cat":3,"oil":false,"filter_oil":false}, ...]'
        )
        parsed = None
        for _attempt in range(2):  # محاولتان — مش تخمينة واحدة وخلاص
            try:
                parsed = _ai.extract_json(await _ai.ask_text(prompt, 1200))
                break
            except Exception:
                continue
        for item in parsed if isinstance(parsed, list) else []:
            try:
                it = batch[int(item["i"])]
                cat = categories[int(item["cat"])]
            except (KeyError, ValueError, IndexError, TypeError):
                continue
            out[it["id"]] = (cat, bool(item.get("oil")), bool(item.get("filter_oil")))
    return out


def _classify_name(name: str) -> tuple[str, bool, bool] | None:
    low = f" {name.lower()} "
    for cat, keys, is_oil, is_filter in _CLASSIFY_RULES:
        for k in keys:
            if k.lower() in low:
                return (cat, is_oil, is_filter)
    return None


async def auto_classify(company_id: str, apply: bool, only_uncategorized: bool = True) -> dict:
    """تصنيف جماعي بقواعد الأسماء — معاينة أولاً ثم تطبيق"""
    cond = "AND (category IS NULL OR category = '' OR category = 'أخرى')" if only_uncategorized else ""
    rows = await fetch(
        f"SELECT id, name, spec, category FROM products WHERE company_id=$1 AND is_active=TRUE {cond}",
        company_id)

    plan: dict[str, list] = {}          # التصنيف الجديد → [(id, is_oil, is_filter)]
    samples: dict[str, list[str]] = {}
    leftovers: list[dict] = []
    for r in rows:
        text = f"{r['name']} {r['spec'] or ''}"
        hit = _classify_name(text)
        if not hit:
            leftovers.append({"id": str(r["id"]), "name": r["name"]})
            continue
        cat, is_oil, is_filter = hit
        plan.setdefault(cat, []).append((str(r["id"]), is_oil, is_filter))
        if len(samples.setdefault(cat, [])) < 3:
            samples[cat].append(r["name"][:60])

    # ── المرحلة الثانية: الذكاء يحسم الباقي باختيار مغلق من فئات النظام نفسها ──
    ai_classified = 0
    if leftovers:
        db_cats = [r2["category"] for r2 in await fetch(
            """SELECT DISTINCT category FROM products
               WHERE company_id=$1 AND category IS NOT NULL AND category <> ''""", company_id)]
        categories = list(dict.fromkeys([c[0] for c in _CLASSIFY_RULES] + db_cats))
        try:
            ai_hits = await _ai_classify_batch(leftovers, categories)
        except Exception:
            ai_hits = {}
        for pid, (cat, is_oil, is_filter) in ai_hits.items():
            plan.setdefault(cat, []).append((pid, is_oil, is_filter))
            ai_classified += 1
        leftovers = [l for l in leftovers if l["id"] not in ai_hits]
    unclassified = len(leftovers)

    if apply:
        async with transaction() as conn:
            async with conn.transaction():
                for cat, items in plan.items():
                    for pid, is_oil, is_filter in items:
                        await conn.execute(
                            """UPDATE products
                               SET category=$1, is_oil=$2, is_oil_filter=$3
                               WHERE company_id=$4 AND id=$5""",
                            cat, is_oil, is_filter, company_id, pid)

    return {
        "scanned": len(rows),
        "classified": sum(len(v) for v in plan.values()),
        "aiClassified": ai_classified,
        "unclassified": unclassified,
        "unclassifiedSamples": [l["name"][:60] for l in leftovers[:6]],
        "applied": apply,
        "byCategory": [
            {"category": cat, "count": len(items), "samples": samples.get(cat, []),
             "isOil": items[0][1], "isOilFilter": items[0][2]}
            for cat, items in sorted(plan.items(), key=lambda x: -len(x[1]))
        ],
    }


# ══════════════════ شركات الزيوت + صور المنتجات + بوابة العميل ══════════════════

async def set_product_image(company_id: str, product_id: str, image_b64: str | None) -> dict:
    row = await fetchrow(
        "UPDATE products SET image_base64=$1 WHERE id=$2 AND company_id=$3 RETURNING id",
        image_b64, product_id, company_id)
    if not row:
        raise HTTPException(404, "الصنف غير موجود")
    return {"ok": True}


async def list_oil_brands(company_id: str) -> list[dict]:
    rows = await fetch(
        "SELECT id, name, logo_base64, sort FROM oil_brands WHERE company_id=$1 ORDER BY sort, name",
        company_id)
    return [{**r, "id": str(r["id"])} for r in rows]


async def upsert_oil_brand(company_id: str, name: str, logo_b64: str | None,
                           brand_id: str | None = None) -> dict:
    name = name.strip()
    if not name:
        raise HTTPException(400, "اسم الشركة مطلوب")
    if brand_id:
        # نمسك الاسم القديم قبل التعديل — لو الاسم اتغير لازم المنتجات المرتبطة
        # (المخزنة بالاسم في عمود oil_brand) تتحدث معاه وإلا الربط بينفك.
        old = await fetchrow(
            "SELECT name FROM oil_brands WHERE id=$1 AND company_id=$2", brand_id, company_id)
        if not old:
            raise HTTPException(404, "الشركة غير موجودة")
        row = await fetchrow(
            """UPDATE oil_brands SET name=$1, logo_base64=COALESCE($2, logo_base64)
               WHERE id=$3 AND company_id=$4 RETURNING id, name, logo_base64, sort""",
            name, logo_b64, brand_id, company_id)
        if not row:
            raise HTTPException(404, "الشركة غير موجودة")
        if old["name"] != name:
            await execute(
                "UPDATE products SET oil_brand=$1 WHERE company_id=$2 AND oil_brand=$3",
                name, company_id, old["name"])
    else:
        row = await fetchrow(
            """INSERT INTO oil_brands (company_id, name, logo_base64)
               VALUES ($1,$2,$3)
               ON CONFLICT (company_id, name) DO UPDATE SET logo_base64=COALESCE($3, oil_brands.logo_base64)
               RETURNING id, name, logo_base64, sort""",
            company_id, name, logo_b64)
    return {**row, "id": str(row["id"])}


async def delete_oil_brand(company_id: str, brand_id: str) -> dict:
    row = await fetchrow(
        "DELETE FROM oil_brands WHERE id=$1 AND company_id=$2 RETURNING name", brand_id, company_id)
    if not row:
        raise HTTPException(404, "الشركة غير موجودة")
    await execute("UPDATE products SET oil_brand=NULL WHERE company_id=$1 AND oil_brand=$2",
                  company_id, row["name"])
    return {"ok": True}


async def assign_brand_products(company_id: str, brand_id: str, product_ids: list[str]) -> dict:
    brand = await fetchrow("SELECT name FROM oil_brands WHERE id=$1 AND company_id=$2",
                           brand_id, company_id)
    if not brand:
        raise HTTPException(404, "الشركة غير موجودة")
    # إزالة التعيين القديم للشركة دي ثم تعيين المحدد — عملية كاملة
    async with transaction() as conn:
        async with conn.transaction():
            await conn.execute(
                "UPDATE products SET oil_brand=NULL WHERE company_id=$1 AND oil_brand=$2",
                company_id, brand["name"])
            if product_ids:
                await conn.execute(
                    "UPDATE products SET oil_brand=$1 WHERE company_id=$2 AND id = ANY($3::uuid[])",
                    brand["name"], company_id, product_ids)
    return {"ok": True, "count": len(product_ids)}


# الأنواع الخمسة الثابتة لتصنيف الزيوت والخدمات المرتبطة بها — نفس القيم
# تُستخدم في عمود oil_type لكل من صنف الزيت (أي نوعه) وصنف الخدمة (أي نوع
# يلزمها)، فربط "تغيير زيت الفرامل" بـ oil_type='brake' يحصر الزيوت
# المقترحة لها في زيوت الفرامل فقط، بدل عرض أي زيت عشوائي.
OIL_TYPES = {
    "engine": "زيت ماكينة", "differential": "زيت دفرنس", "steering": "زيت دركسيون",
    "brake": "زيت فرامل", "gearbox": "زيت قير", "transfer": "زيت دبل",
}

# الأنواع الثلاثة لتصنيف الفلاتر — كانت كلها مخلوطة تحت "فلاتر زيت" واحدة
FILTER_KINDS = {"oil": "فلتر زيت", "air": "فلتر هواء", "ac": "فلتر مكيف"}


async def assign_filter_kind(company_id: str, filter_kind: str, product_ids: list[str]) -> dict:
    if filter_kind not in FILTER_KINDS:
        raise HTTPException(400, "نوع فلتر غير معروف")
    if not product_ids:
        return {"ok": True, "count": 0}
    await execute(
        "UPDATE products SET filter_kind=$1 WHERE company_id=$2 AND id = ANY($3::uuid[])",
        filter_kind, company_id, product_ids)
    return {"ok": True, "count": len(product_ids)}


async def clear_filter_kind(company_id: str, product_ids: list[str]) -> dict:
    if not product_ids:
        return {"ok": True, "count": 0}
    await execute(
        "UPDATE products SET filter_kind=NULL WHERE company_id=$1 AND id = ANY($2::uuid[])",
        company_id, product_ids)
    return {"ok": True, "count": len(product_ids)}


async def auto_classify_filter_kind(company_id: str) -> dict:
    """تصنيف تلقائي من نص الفئة الموجود أصلاً (مثال: فئة "فلاتر زيت" على أصناف
    كتير بالفعل) — يوفر التحديد اليدوي صنفاً بصنف حين تكون البيانات موجودة
    أصلاً بنص واضح. لا يلمس أي صنف مصنّف بالفعل (يمس فقط filter_kind IS NULL)."""
    patterns = {
        "oil": ["%فلتر%زيت%", "%فلاتر%زيت%", "%oil%filter%", "%فلتر%محرك%", "%فلتر%ماكينة%"],
        "air": ["%فلتر%هواء%", "%فلاتر%هواء%", "%air%filter%"],
        "ac": ["%فلتر%مكيف%", "%فلاتر%مكيف%", "%فلتر%تكييف%", "%فلتر%كابينة%", "%فلتر%كابينه%", "%cabin%filter%", "%pollen%", "%ac%filter%"],
    }
    counts: dict[str, int] = {}
    for kind, pats in patterns.items():
        total = 0
        for pat in pats:
            # نعدّ المطابق أولاً (مضمون بغض النظر عن شكل رد execute)، ثم نحدّث
            matched = await fetch(
                """SELECT id FROM products
                   WHERE company_id=$1 AND filter_kind IS NULL
                     AND (category ILIKE $2 OR name ILIKE $2)""",
                company_id, pat)
            if matched:
                ids = [r["id"] for r in matched]
                await execute(
                    "UPDATE products SET filter_kind=$1 WHERE id = ANY($2::uuid[])",
                    kind, ids)
                total += len(ids)
        counts[kind] = total
    return {"ok": True, "counts": counts}


def _norm_ar(t: str) -> str:
    t = (t or "").lower()
    for a, b in (("أ", "ا"), ("إ", "ا"), ("آ", "ا"), ("ى", "ي"), ("ة", "ه"), ("ـ", "")):
        t = t.replace(a, b)
    return re.sub(r"\s+", " ", t)


# قواعد النوع بالأولوية: الأخص أولاً (فرامل/دركسيون/دبل/دفرنس) ثم القير ثم الماكينة
_OIL_TYPE_RULES: list[tuple[str, tuple[str, ...]]] = [
    ("brake", ("فرامل", "brake", "dot3", "dot 3", "dot4", "dot 4", "dot5", "dot 5")),
    ("steering", ("دركسيون", "دريكسيون", "باور", "power steering", "steering", "psf", "هيدروليك")),
    ("transfer", ("دبل", "transfer case", "transfer", "علبه نقل")),
    ("differential", ("دفرنس", "دفرنشال", "ديفرنس", "ديفر", "differential", "gl-5", "gl5", "gl 5", "limited slip")),
    ("gearbox", ("قير", "جير", "gear", "atf", "اتف", "اي تي اف", "dexron", "ديكسرون", "cvt", "سي في تي", "dct", "dsg", "mtf",
                 "transmission", "ناقل الحركه", "gl-4", "gl4", "gl 4", "اوتوماتيك")),
    ("engine", ("ماكينه", "محرك", "engine", "motor", "موتور", "ماجنتك", "ماجينتك", "magnatec", "ايدج", "edge", "هيلكس", "helix",
                "ريميولا", "rimula", "كوارتز", "quartz", "gtx", "maxlife", "ماكس لايف", "سينثتك", "سنثتك", "synthetic", "تخليقي")),
]
# درجات لزوجة الزيوت: الماكينة 0W/5W/10W/15W/20W/25W، والقير/الدفرنس 75W/80W/85W (لا تدل على النوع وحدها)
# تُكتب كثيراً بلا حرف W ("5-30" و"10/40")، فنقبل الصيغتين: 5W-30 أو 5-30 — والثاني رقم محرك معروف فقط (16/20/30/40/50/60)
_ENGINE_GRADE = re.compile(r"(?<!\d)(?:(?:0|5|10|15|20|25)\s*w\s*[-/]?\s*\d{2}|(?:0|5|10|15|20|25)\s*[-/]\s*(?:16|20|30|40|50|60))(?!\d)", re.I)


def classify_oil_type(text: str) -> str | None:
    """يستنتج نوع الزيت من اسمه/مواصفاته. None = غير واضح (يُصنَّف يدوياً)."""
    t = _norm_ar(text)
    for kind, words in _OIL_TYPE_RULES:
        if any(w in t for w in words):
            return kind
    if _ENGINE_GRADE.search(t):
        return "engine"
    return None


async def auto_classify_oil_types(company_id: str, apply: bool, redo: bool = False) -> dict:
    """تصنيف ذكي لنوع الزيت (ماكينة/قير/دفرنس/دبل/دركسيون/فرامل) من أسماء الأصناف.
    الزيوت وأصناف «أجرة/تغيير زيت …» معاً. المعاينة افتراضياً؛ redo=True يعيد تصنيف المصنّف أيضاً."""
    rows = await fetch(
        """SELECT id, name, spec, category, is_service, oil_type FROM products
           WHERE company_id=$1 AND is_active=TRUE AND is_oil_filter=FALSE
             AND ($2 OR oil_type IS NULL OR oil_type = '')
             AND is_service=FALSE          -- الخدمات تبقى خارج أنواع الزيت (خدمة «تغيير زيت دفرنس» ليست زيتاً)
             AND (is_oil=TRUE OR name ILIKE '%زيت%' OR category ILIKE '%زيت%' OR category ILIKE '%oil%')
             AND name NOT ILIKE '%فلتر%' AND name NOT ILIKE '%فلاتر%'
             AND COALESCE(category,'') NOT ILIKE '%فلتر%' AND COALESCE(category,'') NOT ILIKE '%filter%'""",
        company_id, redo)
    groups: dict[str, list] = {}
    unmatched: list[str] = []
    for r in rows:
        kind = classify_oil_type(f"{r['name'] or ''} {r['spec'] or ''} {r['category'] or ''}")
        if kind is None:
            unmatched.append(r["name"] or "")
        elif kind != (r["oil_type"] or None):
            groups.setdefault(kind, []).append(r)
    if apply:
        for kind, items in groups.items():
            await execute("UPDATE products SET oil_type=$1 WHERE company_id=$2 AND id = ANY($3::uuid[])",
                          kind, company_id, [i["id"] for i in items])
    return {
        "applied": apply, "scanned": len(rows),
        "matched": sum(len(v) for v in groups.values()), "unmatched": len(unmatched),
        "byType": [{"type": k, "label": OIL_TYPES[k], "count": len(v),
                    "oils": sum(1 for i in v if not i["is_service"]), "services": sum(1 for i in v if i["is_service"]),
                    "samples": [i["name"] for i in v[:4]]} for k, v in sorted(groups.items())],
        "unmatchedSamples": unmatched[:12],
    }


async def clear_all_oil_types(company_id: str) -> dict:
    """إلغاء نوع كل الأصناف دفعة واحدة — لإعادة التصنيف من الصفر. يشمل أي خدمة كانت مربوطة بنوع زيت
    (الخدمات لا تُصنَّف بنوع الزيت). لا يمس شركات الزيوت ولا علامة «زيت» ولا الفلاتر."""
    rows = await fetch(
        """UPDATE products SET oil_type=NULL
           WHERE company_id=$1 AND COALESCE(oil_type,'') <> ''
           RETURNING id""", company_id)
    return {"ok": True, "count": len(rows)}


async def assign_oil_type(company_id: str, oil_type: str, product_ids: list[str]) -> dict:
    if oil_type not in OIL_TYPES:
        raise HTTPException(400, "نوع زيت غير معروف")
    if not product_ids:
        return {"ok": True, "count": 0}
    await execute(
        "UPDATE products SET oil_type=$1 WHERE company_id=$2 AND id = ANY($3::uuid[])",
        oil_type, company_id, product_ids)
    return {"ok": True, "count": len(product_ids)}


async def clear_oil_type(company_id: str, product_ids: list[str]) -> dict:
    """إزالة تصنيف النوع عن أصناف محددة (بدون لمس is_oil/oil_brand)"""
    if not product_ids:
        return {"ok": True, "count": 0}
    await execute(
        "UPDATE products SET oil_type=NULL WHERE company_id=$1 AND id = ANY($2::uuid[])",
        company_id, product_ids)
    return {"ok": True, "count": len(product_ids)}


async def kiosk_oils(company_id: str) -> dict:
    """بيانات بوابة العميل: الشركات بشعاراتها + الزيوت بصورها + الفلاتر"""
    brands = await list_oil_brands(company_id)
    oils = await fetch(
        """SELECT id, name, spec, price_vat, oil_brand, image_base64
           FROM products
           WHERE company_id=$1 AND is_active=TRUE AND is_oil=TRUE
           ORDER BY oil_brand NULLS LAST, name""", company_id)
    filters = await fetch(
        """SELECT id, name, spec, price_vat, image_base64
           FROM products
           WHERE company_id=$1 AND is_active=TRUE AND is_oil_filter=TRUE
           ORDER BY name""", company_id)
    # كانت تُخمَّن نصياً من اسم الفئة (category ILIKE '%قير%') — استُبدلت
    # بعمود oil_type الحقيقي؛ ونفس الاستعلام يغطي بقية الأنواع الآن.
    by_type_rows = await fetch(
        """SELECT id, name, spec, price_vat, oil_brand, oil_type, image_base64
           FROM products
           WHERE company_id=$1 AND is_active=TRUE AND is_oil=TRUE AND oil_type IS NOT NULL
           ORDER BY oil_type, oil_brand NULLS LAST, name""", company_id)
    fix = lambda rows: [{**r, "id": str(r["id"]), "price_vat": float(r["price_vat"])} for r in rows]
    by_type_fixed = fix(by_type_rows)
    gear_oils = [r for r in by_type_fixed if r["oil_type"] == "gearbox"]
    return {
        "brands": brands, "oils": fix(oils), "filters": fix(filters),
        "gearOils": gear_oils,          # إبقاء الاسم القديم لعدم كسر الواجهة الحالية
        "oilsByType": by_type_fixed,    # كل الأنواع الخمسة — لاستخدام الواجهة مستقبلاً
    }


# ══════════════════ قواعد تسعير الخدمة ══════════════════

async def list_service_rules(company_id: str) -> list[dict]:
    rows = await fetch(
        """SELECT r.*, p.name AS product_name, p.category AS product_category
           FROM service_price_rules r JOIN products p ON p.id = r.service_product_id
           WHERE r.company_id=$1
           ORDER BY r.brand NULLS LAST, r.model NULLS LAST, r.year_from""", company_id)
    return [{**r, "id": str(r["id"]), "service_product_id": str(r["service_product_id"]),
             "price": float(r["price"])} for r in rows]


async def create_service_rule(company_id: str, d: dict) -> dict:
    if d.get("price") is None or float(d["price"]) < 0:
        raise HTTPException(422, "أدخل سعر خدمة صحيح")
    row = await fetchrow(
        """INSERT INTO service_price_rules
             (company_id, service_product_id, brand, model, year_from, year_to, price)
           VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id""",
        company_id, d["serviceProductId"],
        (d.get("brand") or "").strip() or None, (d.get("model") or "").strip() or None,
        d.get("yearFrom"), d.get("yearTo"), d["price"])
    return {"ok": True, "id": str(row["id"])}


async def bulk_service_rules(company_id: str, service_product_id: str, price: float,
                             brands: list[str], all_brands: bool = False) -> dict:
    """سعر خدمة واحد لعدة ماركات دفعة واحدة (أو لكل السيارات). القاعدة العامة للماركة (بلا موديل/سنة)
    تُستبدل لو كانت موجودة بدل التكرار؛ القواعد الأخص (موديل/سنة) لا تُمس."""
    if price is None or float(price) < 0:
        raise HTTPException(422, "أدخل سعر خدمة صحيح")
    names = [b.strip() for b in brands if b and b.strip()]
    if not names and not all_brands:
        raise HTTPException(422, "اختر ماركة واحدة على الأقل")
    if not await fetchrow("SELECT 1 FROM products WHERE id=$1 AND company_id=$2 AND is_service=TRUE", service_product_id, company_id):
        raise HTTPException(404, "الخدمة غير موجودة")
    targets: list[str | None] = ([None] if all_brands else []) + list(dict.fromkeys(names))
    for b in targets:
        await execute(
            """DELETE FROM service_price_rules
               WHERE company_id=$1 AND service_product_id=$2 AND brand IS NOT DISTINCT FROM $3
                 AND model IS NULL AND year_from IS NULL AND year_to IS NULL""",
            company_id, service_product_id, b)
        await execute(
            "INSERT INTO service_price_rules (company_id, service_product_id, brand, price) VALUES ($1,$2,$3,$4)",
            company_id, service_product_id, b, price)
    return {"ok": True, "count": len(targets)}


async def delete_service_rule(company_id: str, rule_id: str) -> dict:
    row = await fetchrow(
        "DELETE FROM service_price_rules WHERE id=$1 AND company_id=$2 RETURNING id",
        rule_id, company_id)
    if not row:
        raise HTTPException(404, "القاعدة غير موجودة")
    return {"ok": True}


# ══════════════════ استيراد المنتجات من ملف Excel (تصدير Odoo) ══════════════════
# القاعدة الذهبية: عمود "سعر البيع" في الملف *شامل ضريبة القيمة المضافة* —
# بنخزنه كما هو بلا أي انحراف: price = السعر/1.15 (بدقة عالية) ثم بنثبّت
# price_vat على قيمة الملف حرفياً لو العمود قابل للكتابة (مش generated).

_CAT_INVISIBLE = dict.fromkeys(map(ord, "\u200e\u200f\u202a\u202b\u202c\u200b\ufeff\u0640"))
_CAT_INVISIBLE[0x00A0] = " "


def clean_category(raw: str) -> str:
    """نص الفئة كما في الملف حرفياً — بإزالة محارف الاتجاه الخفية وتوحيد المسافات فقط"""
    return " ".join(str(raw or "").translate(_CAT_INVISIBLE).split())


IMPORT_KINDS = ("normal", "service", "oil", "filter")


def category_kind(category: str) -> str:
    """نوع الصنف المستنتج من اسم فئته: service | filter | oil | normal.
    (فلاتر الزيت تُعدّ فلتراً قبل أن تُعدّ زيتاً)"""
    t = _norm_ar(category)
    if any(w in t for w in ("خدم", "اجره", "اجور", "عماله", "service", "labor", "labour")):
        return "service"
    if any(w in t for w in ("فلتر", "فلاتر", "filter")):
        return "filter"
    if any(w in t for w in ("زيت", "زيوت", "oil")):
        return "oil"
    return "normal"


def _filter_kind_of(text: str) -> str:
    t = _norm_ar(text)
    if any(w in t for w in ("هواء", "هوا", "air")):
        return "air"
    if any(w in t for w in ("مكيف", "تكييف", "كابين", "cabin", "pollen", "ac ")):
        return "ac"
    return "oil"


async def import_products_rows(company_id: str, rows: list[dict], kinds: dict[str, str] | None = None) -> dict:
    """kinds: تعيين صريح فئة→نوع من شاشة المراجعة (يتقدّم على الاستنتاج من اسم الفئة)"""
    kinds = {clean_category(k): v for k, v in (kinds or {}).items() if v in IMPORT_KINDS}
    added = updated = 0
    errors: list[str] = []
    warnings: list[str] = []
    for i, r in enumerate(rows, start=2):  # الصف 1 عناوين
        try:
            name = (r.get("name") or "").strip()
            if not name:
                continue  # صف فاضي
            barcode = (r.get("barcode") or "").strip().lstrip(".'\u2018\u2019") or None
            price_vat_in = r.get("price_vat")
            cost = r.get("cost")
            unit = (r.get("unit") or "").strip() or "قطعة"
            category = clean_category(r.get("category") or "")
            file_category = category            # فئة الملف الحرفية — تُحدّد نوع الصنف أدناه

            price_ex = round(float(price_vat_in) / 1.15, 6) if price_vat_in not in (None, "") else None
            cost_val = round(float(cost), 4) if cost not in (None, "") else None

            # ── التدقيق وقت الاستيراد: تنظيف حتمي + تصنيف بالقواعد لو الفئة فاضية ──
            name = _normalize_product_name(name) or name
            if not category:
                hit = _classify_name(name)
                if hit:
                    category = hit[0]

            # المطابقة: الباركود أولاً (مرجع داخلي) وإلا الاسم — على *كل* الأصناف
            # حتى المعطلة: بعد "مسح الكل" الباركودات لسه محجوزة بقيد فريد،
            # فالصنف المعطل بنفس الباركود بيتحيي ويتحدث بدل ما الإدخال يصطدم بيه
            existing = None
            if barcode:
                existing = await fetchrow(
                    """SELECT id FROM products WHERE company_id=$1 AND barcode=$2
                       ORDER BY is_active DESC LIMIT 1""",
                    company_id, barcode)
            if not existing:
                existing = await fetchrow(
                    """SELECT id FROM products WHERE company_id=$1 AND name=$2
                       ORDER BY is_active DESC LIMIT 1""",
                    company_id, name)

            if existing:
                # صنف آخر بنفس (الفئة + الاسم + المواصفة) يكسر القيد الفريد uq_products_combo لو أعدنا تسمية هذا الصنف.
                # حينها نحدّث السعر/التكلفة/الوحدة/الباركود فقط ونُبقي الاسم والفئة، ونُبلغ بتحذير مقروء بدل خطأ قاعدة بيانات.
                clash = await fetchrow(
                    """SELECT o.name FROM products p1
                       JOIN products o ON o.company_id=p1.company_id AND o.id<>p1.id
                        AND o.category = (CASE WHEN $3<>'' THEN $3 ELSE p1.category END)
                        AND o.name=$2 AND COALESCE(o.spec,'')=COALESCE(p1.spec,'')
                       WHERE p1.id=$1 LIMIT 1""",
                    existing["id"], name, category)
                if clash:
                    await execute(
                        """UPDATE products SET
                             barcode=COALESCE($2, barcode),
                             price=COALESCE($3, price), cost_price=COALESCE($4, cost_price),
                             unit=$5, is_active=TRUE
                           WHERE id=$1""",
                        existing["id"], barcode, price_ex, cost_val, unit)
                    pid = existing["id"]; updated += 1
                    warnings.append(f"صف {i}: «{name}» موجود بنفس الفئة والاسم لصنف آخر — حُدّث السعر/التكلفة فقط وبقي الاسم والفئة كما هما")
                else:
                    await execute(
                        """UPDATE products SET
                             name=$2, barcode=COALESCE($3, barcode),
                             price=COALESCE($4, price), cost_price=COALESCE($5, cost_price),
                             unit=$6, category=CASE WHEN $7 <> '' THEN $7 ELSE category END,
                             is_active=TRUE
                           WHERE id=$1""",
                        existing["id"], name, barcode, price_ex, cost_val, unit, category)
                    pid = existing["id"]; updated += 1
            else:
                row_new = await fetchrow(
                    """INSERT INTO products
                         (company_id, category, name, spec, unit, barcode, price, cost_price)
                       VALUES ($1,$2,$3,'',$4,$5,COALESCE($6,0),COALESCE($7,0))
                       RETURNING id""",
                    company_id, category, name, unit, barcode, price_ex, cost_val)
                pid = row_new["id"]; added += 1

            # نوع الصنف يتبع فئة الملف: خدمة / زيت / فلتر / عادي (الأصناف بلا فئة في الملف لا تُمس)
            if file_category:
                kind = kinds.get(file_category) or category_kind(file_category)
                await execute(
                    """UPDATE products SET is_service=$2, is_oil=$3, is_oil_filter=$4,
                              filter_kind=CASE WHEN $4 THEN $5 ELSE NULL END
                       WHERE id=$1""",
                    pid, kind == "service", kind == "oil", kind == "filter",
                    _filter_kind_of(f"{file_category} {name}") if kind == "filter" else None)
                if kind == "service":   # الخدمة ليست زيتاً: لا يبقى عليها نوع زيت من تصنيف سابق
                    await execute("UPDATE products SET oil_type=NULL WHERE id=$1", pid)

            # تثبيت السعر شامل الضريبة على قيمة الملف حرفياً — لو العمود قابل للكتابة.
            # لو generated في قاعدة بياناتك، الأمر بيفشل بأمان والقيمة المحسوبة تبقى
            # مطابقة عملياً (فرق أقصاه هللة) بفضل دقة الـ6 خانات في price.
            if price_vat_in not in (None, ""):
                try:
                    await execute("UPDATE products SET price_vat=$2 WHERE id=$1",
                                  pid, round(float(price_vat_in), 2))
                except Exception:
                    pass
        except Exception as e:
            errors.append(f"صف {i}: {type(e).__name__}: {e}")
    return {"added": added, "updated": updated, "errors": errors[:20],
            "errorsTotal": len(errors), "warnings": warnings[:20], "warningsTotal": len(warnings)}


async def wipe_all_products(company_id: str) -> dict:
    """مسح كل الأصناف = تعطيل شامل (نفس فلسفة الحذف الفردي) —
    تاريخ الفواتير والمخزون بيفضل سليم، والاستيراد الجديد بيبدأ على نضيف
    لأن المطابقة بتدور في الأصناف النشطة فقط."""
    r = await execute(
        "UPDATE products SET is_active = FALSE, updated_at = now() WHERE company_id=$1 AND is_active=TRUE",
        company_id)
    count = int(r.split()[-1]) if r else 0
    return {"deactivated": count}


# ══════════════════ توزيع شركات الزيوت تلقائياً ══════════════════
_BRAND_ALIASES = {
    "كاسترول": ["castrol", "كاسترول"], "موبيل": ["mobil", "موبيل", "موبيل1", "mobil 1"],
    "شل": ["shell", "شل ", " شل", "هليكس", "helix", "روميلا", "ريميولا", "rimula"],
    "توتال": ["total", "توتال", "كوارتز", "quartz"], "فالفولين": ["valvoline", "فالفولين"],
    "ليكوي مولي": ["liqui", "ليكوي", "ليكوى"], "بترومين": ["بترومين", "petromin"],
    "فوكس": ["fuchs", "فوكس"], "رافينول": ["ravenol", "رافينول"], "زيك": ["zic", "زيك"],
    "هيونداي": ["hyundai", "هيونداي", "شل هيلكس"], "نيسان": ["نيسان", "nissan"],
    "تويوتا": ["تويوتا", "toyota"], "موتيل": ["motul", "موتيل", "موتول"],
    "جيلي": ["جيلي", "geely"], "امارون": ["امارون", "amaron"],
}


async def auto_assign_brands(company_id: str, apply: bool) -> dict:
    """توزيع الزيوت على شركاتها: مطابقة حتمية بأسماء الشركات وبدائلها،
    والذكاء يحسم الباقي باختيار مغلق من شركاتك المسجلة فقط."""
    brands = await fetch(
        "SELECT id, name FROM oil_brands WHERE company_id=$1 ORDER BY sort, name",
        company_id)
    if not brands:
        return {"error": "سجّل شركات الزيوت الأول من نفس الشاشة", "scanned": 0}
    brand_names = [b["name"] for b in brands]
    brand_id_of = {b["name"]: str(b["id"]) for b in brands}

    rows = await fetch(
        """SELECT id, name FROM products
           WHERE company_id=$1 AND is_active=TRUE AND is_oil=TRUE AND oil_brand IS NULL""",
        company_id)

    plan: dict[str, list[str]] = {}
    leftovers: list[dict] = []
    for r in rows:
        low = f" {r['name'].lower()} "
        hit = None
        for bn in brand_names:
            keys = _BRAND_ALIASES.get(bn, []) + [bn.lower()]
            if any(k.lower() in low for k in keys):
                hit = bn
                break
        if hit:
            plan.setdefault(hit, []).append(str(r["id"]))
        else:
            leftovers.append({"id": str(r["id"]), "name": r["name"]})

    ai_assigned = 0
    if leftovers:
        try:
            ai_hits = await _ai_classify_batch(leftovers, brand_names)
            for pid, (bn, _o, _f) in ai_hits.items():
                plan.setdefault(bn, []).append(pid)
                ai_assigned += 1
            leftovers = [l for l in leftovers if l["id"] not in ai_hits]
        except Exception:
            pass

    if apply:
        for bn, ids in plan.items():
            await execute(
                "UPDATE products SET oil_brand=$1 WHERE company_id=$2 AND id = ANY($3::uuid[])",
                bn, company_id, ids)

    return {
        "scanned": len(rows),
        "assigned": sum(len(v) for v in plan.values()),
        "aiAssigned": ai_assigned,
        "unassigned": len(leftovers),
        "unassignedSamples": [l["name"][:55] for l in leftovers[:6]],
        "applied": apply,
        "byBrand": [{"brand": bn, "count": len(ids)} for bn, ids in sorted(plan.items(), key=lambda x: -len(x[1]))],
    }


# ══════════════════ بوابة الحجز العامة — خريطة الأصناف الكاملة ══════════════════
# نقاط عامة (بلا توكن) لصفحة حجز العميل: الأقسام كما هي في القاعدة + الخدمات،
# ثم أصناف كل قسم عند فتحه. الصور بتتجاب في طلب منفصل عشان الاستجابة تفضل خفيفة
# مهما كان عدد الأصناف.
import base64 as _b64


async def _public_branch_company(branch_id: str) -> str:
    try:
        row = await fetchrow("SELECT company_id FROM branches WHERE id = $1::uuid", branch_id)
    except Exception:
        row = None
    if not row:
        raise HTTPException(404, "الفرع غير موجود")
    return str(row["company_id"])


def _public_row(r) -> dict:
    price = r["price_vat"]
    if isinstance(price, Decimal):
        price = float(price)
    return {"id": str(r["id"]), "name": r["name"], "spec": r["spec"] or "",
            "unit": r["unit"] or "", "price": price or 0, "hasImage": bool(r["has_image"])}


async def public_catalog_overview(branch_id: str) -> dict:
    company_id = await _public_branch_company(branch_id)
    cats = await fetch(
        """SELECT COALESCE(NULLIF(TRIM(category), ''), 'أخرى') AS cat, COUNT(*) AS cnt
           FROM products
           WHERE company_id = $1 AND is_active = TRUE AND is_service = FALSE
           GROUP BY 1
           ORDER BY cnt DESC, cat""",
        company_id)
    services = await fetch(
        """SELECT id, name, spec, unit, price_vat,
                  (image_base64 IS NOT NULL AND image_base64 <> '') AS has_image
           FROM products
           WHERE company_id = $1 AND is_active = TRUE AND is_service = TRUE
           ORDER BY name, spec""",
        company_id)
    return {"categories": [{"name": r["cat"], "count": r["cnt"]} for r in cats],
            "services": [_public_row(r) for r in services]}


async def public_catalog_products(branch_id: str, category: str) -> dict:
    company_id = await _public_branch_company(branch_id)
    if category == "أخرى":
        cond, params = "AND (category IS NULL OR TRIM(category) = '' OR category = 'أخرى')", [company_id]
    else:
        cond, params = "AND category = $2", [company_id, category]
    rows = await fetch(
        f"""SELECT id, name, spec, unit, price_vat,
                   (image_base64 IS NOT NULL AND image_base64 <> '') AS has_image
            FROM products
            WHERE company_id = $1 AND is_active = TRUE AND is_service = FALSE {cond}
            ORDER BY name, spec""",
        *params)
    return {"products": [_public_row(r) for r in rows]}


async def public_product_image(product_id: str) -> dict | None:
    try:
        row = await fetchrow(
            "SELECT image_base64 FROM products WHERE id = $1::uuid AND is_active = TRUE",
            product_id)
    except Exception:
        return None
    if not row:
        return None
    raw = row["image_base64"] or ""
    if not raw:
        return None
    mime, b64 = "image/jpeg", raw
    if raw.startswith("data:"):
        head, _, b64 = raw.partition(",")
        mime = head[5:].split(";")[0] or "image/jpeg"
    try:
        return {"bytes": _b64.b64decode(b64), "mime": mime}
    except Exception:
        return None


async def public_booking_service(branch_id: str, brand: str, model: str, year: str) -> dict:
    """حلّ خدمة تغيير الزيت المناسبة للسيارة: أدق قاعدة تسعير مطابقة
    (ماركة+موديل+سنة > ماركة+موديل > ماركة > قاعدة عامة)، وإن لم توجد قواعد
    نرجع لأقرب صنف خدمة اسمه يدل على تغيير الزيت — وإلا لا شيء."""
    company_id = await _public_branch_company(branch_id)
    yr = None
    digits = "".join(ch for ch in (year or "") if ch.isdigit())
    if len(digits) == 4:
        yr = int(digits)

    def _norm(s):
        return (s or "").strip().lower()

    b, m = _norm(brand), _norm(model)
    rules = await fetch(
        """SELECT r.service_product_id AS pid, r.price, r.brand, r.model,
                  r.year_from, r.year_to, p.name
           FROM service_price_rules r
           JOIN products p ON p.id = r.service_product_id
           WHERE r.company_id = $1 AND p.is_active = TRUE AND p.is_service = TRUE""",
        company_id)

    best, best_score = None, -1
    for r in rules:
        rb, rm = _norm(r["brand"]), _norm(r["model"])
        if rb and not (b and (rb in b or b in rb)):
            continue
        if rm and not (m and (rm in m or m in rm)):
            continue
        if r["year_from"] is not None and (yr is None or yr < r["year_from"]):
            continue
        if r["year_to"] is not None and (yr is None or yr > r["year_to"]):
            continue
        score = (2 if rb else 0) + (2 if rm else 0) + (1 if (r["year_from"] is not None or r["year_to"] is not None) else 0)
        if score > best_score:
            best, best_score = r, score
    if best:
        price = best["price"]
        return {"service": {"id": str(best["pid"]), "name": best["name"],
                            "price": float(price) if isinstance(price, Decimal) else (price or 0)}}

    row = await fetchrow(
        """SELECT id, name, price_vat FROM products
           WHERE company_id = $1 AND is_active = TRUE AND is_service = TRUE
             AND (name ILIKE '%تغيير%زيت%' OR name ILIKE '%غيار%زيت%' OR name ILIKE '%زيت%')
           ORDER BY (name ILIKE '%تغيير%زيت%') DESC,
                    (name ILIKE '%غيار%زيت%') DESC, name
           LIMIT 1""",
        company_id)
    if row:
        pv = row["price_vat"]
        return {"service": {"id": str(row["id"]), "name": row["name"],
                            "price": float(pv) if isinstance(pv, Decimal) else (pv or 0)}}
    return {"service": None}


async def public_brand_logo(brand_id: str) -> dict | None:
    try:
        row = await fetchrow("SELECT logo_base64 FROM oil_brands WHERE id = $1::uuid", brand_id)
    except Exception:
        return None
    if not row:
        return None
    raw = row["logo_base64"] or ""
    if not raw:
        return None
    mime, b64 = "image/png", raw
    if raw.startswith("data:"):
        head, _, b64 = raw.partition(",")
        mime = head[5:].split(";")[0] or "image/png"
    try:
        return {"bytes": _b64.b64decode(b64), "mime": mime}
    except Exception:
        return None


# ══════════════════ صفحة الصنف (كروت الأصناف) ══════════════════

async def get_product_detail(company_id: str, product_id: str) -> dict:
    """بيانات الصنف + أرصدته في كل موقع + آخر الحركات (قراءة فقط)."""
    from uuid import UUID
    try:
        pid = str(UUID(product_id))
    except (ValueError, TypeError):
        raise HTTPException(404, "الصنف غير موجود")

    row = await fetchrow(
        f"""SELECT {_COLS},
                   (image_base64 IS NOT NULL AND image_base64 <> '') AS has_image
            FROM products WHERE id = $1 AND company_id = $2""",
        pid, company_id,
    )
    if not row:
        raise HTTPException(404, "الصنف غير موجود")

    stock_rows = await fetch(
        """SELECT inv.loc_type, inv.loc_id, inv.qty,
                  CASE WHEN inv.loc_type = 'warehouse' THEN 'المستودع الرئيسي'
                       ELSE COALESCE(b.name, inv.loc_id) END AS loc_name
           FROM inventory inv
           LEFT JOIN branches b
             ON inv.loc_type = 'branch' AND b.id::text = inv.loc_id
           WHERE inv.company_id = $1 AND inv.product_id = $2
           ORDER BY inv.loc_type DESC, loc_name""",
        company_id, pid,
    )
    stock = [
        {"locType": r["loc_type"], "locId": r["loc_id"],
         "locName": r["loc_name"], "qty": r["qty"]}
        for r in stock_rows
    ]

    move_rows = await fetch(
        """SELECT move_type, qty, move_no, note, supplier_name, unit_cost, created_at,
                  from_loc_type, from_loc_id, to_loc_type, to_loc_id
           FROM stock_moves
           WHERE company_id = $1 AND product_id = $2
           ORDER BY created_at DESC LIMIT 20""",
        company_id, pid,
    )
    moves = []
    for m in move_rows:
        moves.append({
            "type": m["move_type"], "qty": m["qty"], "moveNo": m["move_no"],
            "note": m["note"], "supplier": m["supplier_name"],
            "unitCost": float(m["unit_cost"]) if m["unit_cost"] is not None else None,
            "createdAt": m["created_at"].isoformat() if m["created_at"] else None,
            "fromLoc": f'{m["from_loc_type"] or ""}:{m["from_loc_id"] or ""}'.strip(":"),
            "toLoc": f'{m["to_loc_type"] or ""}:{m["to_loc_id"] or ""}'.strip(":"),
        })

    product = _row_out(row)
    if product.get("created_at"):
        product["created_at"] = product["created_at"].isoformat()
    return {
        "product": product,
        "stock": stock,
        "totalStock": sum(s["qty"] or 0 for s in stock),
        "moves": moves,
    }


# ══════════════════ أصناف بديلة/مرتبطة (product_links) ══════════════════
# تطبيع الترتيب: نخزّن الزوج دايماً بترتيب نصّي ثابت لـ UUID الاتنين، عشان
# ربط A→B وربط B→A بعد كده يقعوا على نفس الصف تحت UNIQUE(product_id, linked_product_id, link_type)
# بدل ما يتكرر الربط عكسياً بصفين متضاربين.

async def add_product_link(company_id: str, product_id: str, linked_product_id: str, link_type: str) -> dict:
    if product_id == linked_product_id:
        raise HTTPException(422, "لا يمكن ربط الصنف بنفسه")
    a, b = sorted([product_id, linked_product_id])
    try:
        row = await fetchrow(
            """INSERT INTO product_links (company_id, product_id, linked_product_id, link_type)
               VALUES ($1,$2,$3,$4) RETURNING id""",
            company_id, a, b, link_type,
        )
    except asyncpg.UniqueViolationError:
        raise HTTPException(409, "الربط موجود بالفعل")
    except asyncpg.ForeignKeyViolationError:
        raise HTTPException(404, "الصنف المطلوب ربطه غير موجود")
    return {"id": str(row["id"])}


async def remove_product_link(company_id: str, link_id: str) -> None:
    row = await fetchrow(
        "DELETE FROM product_links WHERE id=$1 AND company_id=$2 RETURNING id",
        link_id, company_id,
    )
    if not row:
        raise HTTPException(404, "الربط غير موجود")


async def list_product_links(company_id: str, product_id: str) -> list[dict]:
    """بيانات الصنف الآخر (مش الصنف الحالي) — الربط مخزّن بترتيب نصّي ثابت
    للزوج فمرة الصنف الحالي يكون product_id ومرة linked_product_id."""
    rows = await fetch(
        """SELECT pl.id, pl.link_type,
                  CASE WHEN pl.product_id = $2 THEN pl.linked_product_id ELSE pl.product_id END AS other_id
           FROM product_links pl
           WHERE pl.company_id = $1 AND (pl.product_id = $2 OR pl.linked_product_id = $2)""",
        company_id, product_id,
    )
    if not rows:
        return []
    other_ids = [str(r["other_id"]) for r in rows]
    prod_rows = await fetch(
        f"""SELECT p.id, p.category, p.name, p.spec, p.price,
                   COALESCE((SELECT SUM(inv.qty) FROM inventory inv
                              WHERE inv.product_id = p.id AND inv.loc_type = 'branch'), 0) AS stock_qty
            FROM products p WHERE p.company_id = $1 AND p.id = ANY($2::uuid[])""",
        company_id, other_ids,
    )
    by_id = {str(p["id"]): p for p in prod_rows}
    out = []
    for r in rows:
        p = by_id.get(str(r["other_id"]))
        if not p:   # الصنف الآخر محذوف/غير موجود — تجاهل الربط بدل كسر الطلب
            continue
        out.append({
            "id": str(r["id"]), "linkType": r["link_type"], "productId": str(p["id"]),
            "category": p["category"], "name": p["name"], "spec": p["spec"],
            "price": float(p["price"]) if isinstance(p["price"], Decimal) else p["price"],
            "stock_qty": float(p["stock_qty"]) if isinstance(p["stock_qty"], Decimal) else p["stock_qty"],
        })
    return out
