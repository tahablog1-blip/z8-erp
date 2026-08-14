# modules/products/service.py — منطق الأعمال معزول عن طبقة الـ HTTP
# الاستعلامات منقولة من products.routes.js القديم بالحرف — نفس صيغة $1
import re
from decimal import Decimal

import asyncpg
from fastapi import HTTPException

from ...core.db import execute, fetch, fetchrow, transaction

# الأعمدة اللي بترجع للواجهة — مكتوبة صراحةً بدل SELECT *
# عشان أي عمود جديد يتضاف للجدول ما يسربش للواجهة من غير قصد.
_COLS = """id, category, name, spec, unit, barcode, price, price_vat, is_service, is_oil, is_oil_filter, oil_brand,
           cost_price, min_qty, service_interval_km, is_active, created_at"""


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
    return "هذا الصنف مسجل بالفعل بنفس الفئة والاسم واللزوجة"


# ══════════════════ قراءة ══════════════════

async def list_products(company_id: str, search: str | None = None) -> list[dict]:
    params: list = [company_id]
    where = "p.company_id = $1 AND p.is_active = TRUE"
    if search:
        params.append(f"%{search}%")
        i = len(params)
        where += (f" AND (p.category ILIKE ${i} OR p.name ILIKE ${i} "
                  f"OR p.spec ILIKE ${i} OR p.barcode ILIKE ${i})")
    # المخزون الفعلي: مجموع الرصيد في كل الفروع (loc_type='branch') لكل صنف —
    # عمود إضافي جديد stock_qty لا يكسر أي مستهلك حالي للمسار
    cols = ", ".join(f"p.{c.strip()}" for c in _COLS.split(","))
    rows = await fetch(
        f"""SELECT {cols},
                  COALESCE((SELECT SUM(inv.qty) FROM inventory inv
                             WHERE inv.product_id = p.id AND inv.loc_type = 'branch'), 0) AS stock_qty
           FROM products p WHERE {where} ORDER BY p.category, p.name, p.spec""", *params
    )
    return [_row_out(r) for r in rows]


async def get_by_barcode(company_id: str, code: str) -> dict:
    row = await fetchrow(
        f"""SELECT {_COLS} FROM products
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
    try:
        row = await fetchrow(
            f"""INSERT INTO products
                  (company_id, category, name, spec, unit, barcode,
                   price, cost_price, min_qty, service_interval_km, is_service, is_oil, is_oil_filter, oil_brand)
                VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
                RETURNING {_COLS}""",
            company_id, category, d["name"], d.get("spec", ""), d.get("unit", "قطعة"),
            d.get("barcode") or None,
            Decimal(str(d.get("price", 0))), Decimal(str(d.get("costPrice", 0))),
            d.get("minQty", 0), d.get("serviceIntervalKm"), bool(d.get("isService", False)),
            bool(d.get("isOil", False)), bool(d.get("isOilFilter", False)), d.get("oilBrand"),
        )
    except asyncpg.UniqueViolationError as e:
        raise HTTPException(409, _unique_violation_message(e))
    return _row_out(row)


_COL_MAP = {
    "category": "category", "name": "name", "spec": "spec", "unit": "unit",
    "barcode": "barcode", "price": "price", "costPrice": "cost_price",
    "minQty": "min_qty", "serviceIntervalKm": "service_interval_km",
    "isService": "is_service", "isOil": "is_oil", "isOilFilter": "is_oil_filter",
    "oilBrand": "oil_brand",
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
        row = await fetchrow(
            """UPDATE oil_brands SET name=$1, logo_base64=COALESCE($2, logo_base64)
               WHERE id=$3 AND company_id=$4 RETURNING id, name, logo_base64, sort""",
            name, logo_b64, brand_id, company_id)
        if not row:
            raise HTTPException(404, "الشركة غير موجودة")
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
    gear_oils = await fetch(
        """SELECT id, name, spec, price_vat, oil_brand, image_base64
           FROM products
           WHERE company_id=$1 AND is_active=TRUE AND is_service=FALSE
             AND (category ILIKE '%قير%' OR category ILIKE '%دفرنس%')
           ORDER BY oil_brand NULLS LAST, name""", company_id)
    fix = lambda rows: [{**r, "id": str(r["id"]), "price_vat": float(r["price_vat"])} for r in rows]
    return {"brands": brands, "oils": fix(oils), "filters": fix(filters), "gearOils": fix(gear_oils)}


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


async def delete_service_rule(company_id: str, rule_id: str) -> dict:
    row = await fetchrow(
        "DELETE FROM service_price_rules WHERE id=$1 AND company_id=$2 RETURNING id",
        rule_id, company_id)
    if not row:
        raise HTTPException(404, "القاعدة غير موجودة")
    return {"ok": True}


# ══════════════════ منظف الأسماء الذكي ══════════════════

async def ai_clean_names(company_id: str, apply: bool, only_oils: bool, limit: int = 120) -> dict:
    """إعادة صياغة أسماء الأصناف بالعربي النظيف + استخراج اللزوجة/السعة — على دفعات"""
    from ...core import ai as _ai
    cond = "AND (is_oil=TRUE OR category ILIKE '%زيت%' OR category ILIKE '%قير%')" if only_oils else ""
    rows = await fetch(
        f"""SELECT id, name, spec FROM products
            WHERE company_id=$1 AND is_active=TRUE AND is_service=FALSE
              AND original_name IS NULL {cond}
            ORDER BY name LIMIT $2""", company_id, limit)
    if not rows:
        return {"scanned": 0, "changed": 0, "applied": apply, "items": [], "remaining": 0}

    changed: list[dict] = []
    failed_batches = 0
    CHUNK = 30
    for i in range(0, len(rows), CHUNK):
        batch = rows[i:i + CHUNK]
        listing = "\n".join(f'{j}| {_normalize_product_name(r["name"])} | {r["spec"] or ""}' for j, r in enumerate(batch))
        prompt = (
            "منتجات مركز زيوت سيارات بأسماء مستوردة فوضوية. أعد صياغة كل سطر:\n"
            "- name: اسم عربي تجاري نظيف مختصر (الماركة بالعربي + النوع). بدون أكواد أو أرقام مرجعية.\n"
            "- spec: اللزوجة/السعة/المواصفة إن وجدت (مثال: 5W-30 · 4 لتر). فاضي لو لا يوجد.\n"
            "- لو الاسم أصلاً نظيف رجّعه كما هو.\n"
            f"الأسطر (رقم| الاسم | المواصفة):\n{listing}\n"
            'رد بمصفوفة JSON فقط: [{"i":0,"name":"...","spec":"..."}, ...] بنفس الأرقام.'
        )
        parsed = None
        for _attempt in range(2):  # محاولتان لكل دفعة — الفشل بيتحاسب مش بيتبلع
            try:
                parsed = _ai.extract_json(await _ai.ask_text(prompt, 1400))
                break
            except Exception:
                continue
        if parsed is None:
            failed_batches += 1
            # حتى لو الذكاء فشل: التنظيف الحتمي بيتطبق (شيل النجوم والشوائب)
            for r in batch:
                nn = _normalize_product_name(r["name"])
                if nn and nn != r["name"]:
                    changed.append({"id": str(r["id"]), "old": r["name"], "name": nn, "spec": r["spec"]})
            continue
        for item in parsed if isinstance(parsed, list) else []:
            try:
                r = batch[int(item["i"])]
            except (KeyError, ValueError, IndexError, TypeError):
                continue
            new_name = str(item.get("name", "")).strip()[:120]
            new_spec = str(item.get("spec", "")).strip()[:80] or None
            if new_name and (new_name != r["name"] or (new_spec or "") != (r["spec"] or "")):
                changed.append({"id": str(r["id"]), "old": r["name"],
                                "name": new_name, "spec": new_spec})

    if apply and changed:
        async with transaction() as conn:
            async with conn.transaction():
                for c in changed:
                    await conn.execute(
                        """UPDATE products SET original_name=name, name=$1, spec=$2
                           WHERE id=$3 AND company_id=$4""",
                        c["name"], c["spec"], c["id"], company_id)

    remaining = await fetchrow(
        f"""SELECT COUNT(*) AS n FROM products
            WHERE company_id=$1 AND is_active=TRUE AND is_service=FALSE
              AND original_name IS NULL {cond}""", company_id)
    return {"scanned": len(rows), "changed": len(changed), "applied": apply,
            "failedBatches": failed_batches,
            "items": changed[:60], "remaining": max(0, remaining["n"] - (len(rows) if not apply else 0))}


# ══════════════════ استيراد المنتجات من ملف Excel (تصدير Odoo) ══════════════════
# القاعدة الذهبية: عمود "سعر البيع" في الملف *شامل ضريبة القيمة المضافة* —
# بنخزنه كما هو بلا أي انحراف: price = السعر/1.15 (بدقة عالية) ثم بنثبّت
# price_vat على قيمة الملف حرفياً لو العمود قابل للكتابة (مش generated).

async def import_products_rows(company_id: str, rows: list[dict]) -> dict:
    added = updated = 0
    errors: list[str] = []
    for i, r in enumerate(rows, start=2):  # الصف 1 عناوين
        try:
            name = (r.get("name") or "").strip()
            if not name:
                continue  # صف فاضي
            barcode = (r.get("barcode") or "").strip().lstrip(".'\u2018\u2019") or None
            price_vat_in = r.get("price_vat")
            cost = r.get("cost")
            unit = (r.get("unit") or "").strip() or "قطعة"
            category = (r.get("category") or "").strip()

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
            "errorsTotal": len(errors)}


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
