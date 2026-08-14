# modules/cars/service.py — منطق الأعمال معزول عن طبقة الـ HTTP
# الاستعلامات منقولة من cars.routes.js القديم بالحرف — نفس صيغة $1
#
# ⚠ إشعارات واتساب في النسخة الأصلية (تسجيل/دخول/تنبيه يدوي) مُسقَطة عن قصد
# من هذا الميناء — تكامل خارجي منفصل، يُضاف لاحقاً كموديول مستقل لو احتجناه.
import json
import re

from fastapi import HTTPException

from ...core.accounting import reverse_journal_entries
from ...core.db import execute, fetch, fetchrow, transaction

_PLATE_CLEAN = re.compile(r"[^A-Za-z0-9]")
_DIGITS = re.compile(r"\D")


def _clean_plate(s: str) -> str:
    return _PLATE_CLEAN.sub("", (s or "").upper())


def _row_out(r: dict) -> dict:
    r = dict(r)
    r["id"] = str(r["id"])
    r["branch_id"] = str(r["branch_id"])
    if r.get("customer_id"):
        r["customer_id"] = str(r["customer_id"])
    return r


# ══════════════════ قراءة ══════════════════

async def list_cars(company_id: str, branch_scope: str | None, branch_id_param: str | None,
                    active_only: bool, limit: int, offset: int) -> list[dict]:
    branch_id = branch_scope or branch_id_param
    conditions = ["company_id = $1", "COALESCE(is_deleted, FALSE) = FALSE"]
    params: list = [company_id]
    if branch_id:
        params.append(branch_id)
        conditions.append(f"branch_id = ${len(params)}")
    if active_only:
        conditions.append("exited_at IS NULL")
    params.append(min(max(limit, 1), 500))
    params.append(max(offset, 0))

    rows = await fetch(
        f"""SELECT * FROM cars WHERE {' AND '.join(conditions)}
            ORDER BY created_at DESC LIMIT ${len(params) - 1} OFFSET ${len(params)}""",
        *params,
    )
    return [_row_out(r) for r in rows]


async def lookup(company_id: str, plate: str | None, phone: str | None) -> dict | None:
    """بحث ذكي شامل عن عميل/سيارة سابقة برقم اللوحة أو الجوال (لتعبئة تلقائية كاملة).
    بيبحث في customers + customer_vehicles — بيشتغل حتى لو السيارة اتسجّلت أول مرة
    من نقطة البيع أو من شاشة العملاء، مش بس من شاشة تسجيل السيارات."""
    if not plate and not phone:
        raise HTTPException(400, "أدخل رقم لوحة أو رقم جوال للبحث")

    customer = None
    vehicle = None
    norm_plate = _clean_plate(plate) if plate else None

    # 1) أولوية لتطابق اللوحة — بيرجع العميل ومواصفات هذه السيارة تحديداً
    if norm_plate:
        row = await fetchrow(
            """SELECT cv.*, c.id AS customer_id, c.name AS customer_name,
                      c.phone AS customer_phone, c.customer_type
               FROM customer_vehicles cv
               JOIN customers c ON c.id = cv.customer_id AND c.company_id = cv.company_id
               WHERE cv.company_id = $1 AND c.is_active = TRUE
                 AND upper(replace(replace(cv.plate,' ',''),'-','')) = $2
               ORDER BY cv.created_at DESC LIMIT 1""",
            company_id, norm_plate,
        )
        if row:
            customer = {"id": str(row["customer_id"]), "name": row["customer_name"],
                       "phone": row["customer_phone"], "customerType": row["customer_type"]}
            vehicle = {"plate": row["plate"], "plateType": row["plate_type"], "brand": row["brand"],
                      "makeModel": row["make_model"], "modelYear": row["model_year"],
                      "color": row["color"], "chassisNumber": row["chassis_number"]}

    # 2) لو مفيش تطابق باللوحة، دوّر على عميل بنفس رقم الجوال
    if not customer and phone:
        digits = _DIGITS.sub("", phone)
        if digits:
            row = await fetchrow(
                """SELECT id, name, phone, customer_type FROM customers
                   WHERE company_id=$1 AND is_active=TRUE AND regexp_replace(phone,'\\D','','g') = $2
                   ORDER BY created_at DESC LIMIT 1""",
                company_id, digits,
            )
            if row:
                customer = {"id": str(row["id"]), "name": row["name"],
                           "phone": row["phone"], "customerType": row["customer_type"]}

    # 3) آخر قراءة عداد لنفس اللوحة تحديداً
    last_odometer = None
    if norm_plate:
        row = await fetchrow(
            """SELECT odometer_current FROM cars
               WHERE company_id=$1 AND upper(replace(plate,' ','')) = $2 AND odometer_current IS NOT NULL
               ORDER BY created_at DESC LIMIT 1""",
            company_id, norm_plate,
        )
        if row:
            last_odometer = row["odometer_current"]

    if not customer and not vehicle and last_odometer is None:
        return None
    return {"customer": customer, "vehicle": vehicle, "lastOdometer": last_odometer}


async def billing_queue(company_id: str, branch_scope: str | None,
                        branch_id_param: str | None, include_invoiced: bool,
                        stage: str | None = None) -> list[dict]:
    """stage=None (الكاشير): سيارات مؤكدة 'ready' فقط — أمر العمل المؤقت مخفي عنه.
       stage='prepare' (موظف الإعداد): queued + preparing — اللي لسه محتاجة تجهيز وتأكيد."""
    branch_id = branch_scope or branch_id_param
    if stage == "prepare":
        stage_cond = "c.work_status IN ('queued','preparing')"
    else:
        stage_cond = "c.work_status = 'ready'"
    rows = await fetch(
        f"""SELECT c.*, b.name AS branch_name,
                  i.id AS invoice_id, i.invoice_no, i.total_inc AS invoice_total,
                  i.issued_at AS invoice_issued_at
           FROM cars c
           LEFT JOIN branches b ON b.id = c.branch_id
           LEFT JOIN invoices i ON i.car_id = c.id AND i.is_returned = FALSE
           WHERE c.company_id = $1
             AND COALESCE(c.is_deleted, FALSE) = FALSE
             AND ($2::uuid IS NULL OR c.branch_id = $2)
             AND (
                  (c.created_at AT TIME ZONE 'Asia/Riyadh')::date = (now() AT TIME ZONE 'Asia/Riyadh')::date
                  OR c.exited_at IS NULL
                 )
             AND ($3::boolean = TRUE OR i.id IS NULL)
             AND ({stage_cond} OR i.id IS NOT NULL)
           ORDER BY c.created_at ASC""",
        company_id, branch_id, include_invoiced,
    )
    # ── تجهيز عناصر مقترحة للفوترة: أولوية لمسودة بوابة اختيار الزيت، ثم آخر فاتورة لنفس العميل ──
    pending_ids = [str(r["id"]) for r in rows if r.get("invoice_id") is None]
    customer_ids = list({str(r["customer_id"]) for r in rows
                          if r.get("invoice_id") is None and r.get("customer_id")})

    # 1) مسودات بوابة اختيار الزيت (draft_items jsonb على السيارة نفسها)
    draft_by_car: dict[str, list[dict]] = {}
    draft_product_ids: set[str] = set()
    for r in rows:
        if r.get("invoice_id") is None and r.get("draft_items"):
            items = r["draft_items"] if isinstance(r["draft_items"], list) else []
            if items:
                draft_by_car[str(r["id"])] = items
                draft_product_ids.update(str(it["productId"]) for it in items if it.get("productId"))

    products_map: dict[str, dict] = {}
    if draft_product_ids:
        prod_rows = await fetch(
            """SELECT id, category, name, spec, price, price_vat, is_service
               FROM products WHERE id = ANY($1::uuid[])""", list(draft_product_ids))
        products_map = {str(p["id"]): p for p in prod_rows}

    # 2) آخر فاتورة لكل عميل (للعملاء اللي معهم تاريخ ومفيش مسودة زيت)
    suggested_by_customer: dict[str, list[dict]] = {}
    remaining_customers = [cid for cid in customer_ids
                           if not any(str(rr.get("customer_id")) == cid and str(rr["id"]) in draft_by_car for rr in rows)]
    if remaining_customers:
        item_rows = await fetch(
            """WITH latest_inv AS (
                 SELECT DISTINCT ON (customer_id) customer_id, id AS invoice_id
                 FROM invoices
                 WHERE company_id=$1 AND is_returned=FALSE AND customer_id = ANY($2::uuid[])
                 ORDER BY customer_id, issued_at DESC
               )
               SELECT li.customer_id, ii.product_id, ii.label, ii.qty, ii.unit_price, ii.unit_price_vat
               FROM latest_inv li JOIN invoice_items ii ON ii.invoice_id = li.invoice_id""",
            company_id, remaining_customers)
        for it in item_rows:
            cid = str(it["customer_id"])
            suggested_by_customer.setdefault(cid, []).append({
                "productId": str(it["product_id"]) if it["product_id"] else None,
                "label": it["label"], "qty": it["qty"],
                "unitPrice": float(it["unit_price"]), "unitPriceVat": float(it["unit_price_vat"]),
                "isService": False,
            })

    # رقم الدور محسوب على مستوى اليوم لكل فرع
    by_branch_day: dict[str, int] = {}
    out = []
    for r in rows:
        r = dict(r)
        key = f"{r['branch_id'] or '-'}:{r['created_at'].date()}"
        by_branch_day[key] = by_branch_day.get(key, 0) + 1
        car_id = str(r["id"])
        r["id"] = car_id; r["branch_id"] = str(r["branch_id"])
        r["customer_id"] = str(r["customer_id"]) if r.get("customer_id") else None
        r["invoice_id"] = str(r["invoice_id"]) if r.get("invoice_id") else None
        r["invoice_total"] = float(r["invoice_total"]) if r.get("invoice_total") is not None else None
        r["queue_no"] = by_branch_day[key]
        timeline = [
            {"step": "registered", "label": "تم التسجيل في الدور", "at": r["created_at"], "by": r.get("registrar_name")},
            {"step": "entered", "label": "دخلت الخدمة", "at": r.get("entered_at")},
            {"step": "exited", "label": "خرجت", "at": r.get("exited_at")},
            {"step": "invoiced", "label": "صدرت الفاتورة", "at": r.get("invoice_issued_at"), "ref": r.get("invoice_no")},
        ]
        r["timeline"] = [t for t in timeline if t["at"] is not None]

        prepared = None
        if car_id in draft_by_car:
            prepared = []
            for it in draft_by_car[car_id]:
                p = products_map.get(str(it.get("productId")))
                if not p:
                    continue
                override = it.get("priceVat")
                price_vat = float(override) if override is not None else float(p["price_vat"])
                price_ex = round(price_vat / 1.15, 2) if override is not None else float(p["price"])
                prepared.append({
                    "productId": str(p["id"]),
                    "label": " — ".join(filter(None, [p["category"], p["name"], p["spec"]])),
                    "qty": int(it.get("qty", 1)), "unitPrice": price_ex,
                    "unitPriceVat": price_vat, "isService": bool(p["is_service"]),
                })
        elif r.get("customer_id") and str(r["customer_id"]) in suggested_by_customer:
            prepared = suggested_by_customer[str(r["customer_id"])]
        r["prepared_items"] = prepared
        r.pop("draft_items", None)
        out.append(r)
    return out


# ══════════════════ كتابة ══════════════════

async def create_car(company_id: str, user_id: str, user_email: str, d: dict) -> dict:
    plate = " ".join(filter(None, [d.get("plateLetters"), d.get("plateNumbers")])).strip()

    user_row = await fetchrow("SELECT full_name FROM users WHERE id = $1", user_id)
    registrar_name = (user_row and user_row["full_name"]) or user_email

    # ضمان إن كل سيارة مرتبطة بملف عميل حقيقي دائماً.
    # الترتيب: customerId المُرسَل صراحة ← عميل مطابق بنفس الجوال ← إنشاء عميل جديد تلقائياً.
    customer_id = d.get("customerId")

    async with transaction() as conn:
        async with conn.transaction():
            if not customer_id and d.get("customerPhone"):
                digits = _DIGITS.sub("", d["customerPhone"])
                if digits:
                    row = await conn.fetchrow(
                        """SELECT id FROM customers
                           WHERE company_id=$1 AND is_active=TRUE
                             AND regexp_replace(phone,'\\D','','g') = $2 LIMIT 1""",
                        company_id, digits,
                    )
                    if row:
                        customer_id = str(row["id"])

            if not customer_id and d.get("customerName"):
                try:
                    # SAVEPOINT (ترانزاكشن متداخلة): لو الإدخال فشل بيترجع لوحده
                    # من غير ما يسمّم ترانزاكشن التسجيل الأم — وإلا الـCOMMIT النهائي
                    # كان بيتحول ROLLBACK صامت والسيارة "تتسجل وتتبخر"
                    async with conn.transaction():
                        row = await conn.fetchrow(
                            """INSERT INTO customers (company_id, name, phone, customer_type)
                               VALUES ($1,$2,$3,'individual') RETURNING id""",
                            company_id, d["customerName"], d.get("customerPhone"),
                        )
                    customer_id = str(row["id"])
                except Exception as e:
                    # فشل الإنشاء غالباً لأن عميل بنفس الجوال موجود فعلاً (تعارض فريد) —
                    # نحاول نلاقيه ونربطه بدل ما نسيب السيارة من غير عميل بصمت
                    print(f"⚠ create_car: فشل إنشاء عميل جديد ({type(e).__name__}: {e}) — بنحاول نلاقيه بجواله")
                    if d.get("customerPhone"):
                        digits = _DIGITS.sub("", d["customerPhone"])
                        if digits:
                            retry = await conn.fetchrow(
                                """SELECT id FROM customers
                                   WHERE company_id=$1 AND regexp_replace(phone,'\\D','','g') = $2
                                   LIMIT 1""",
                                company_id, digits)
                            if retry:
                                customer_id = str(retry["id"])

            row = await conn.fetchrow(
                """INSERT INTO cars
                     (company_id, branch_id, plate, plate_type, name, model_year, brand, car_category,
                      cylinders, color, chassis_number, customer_name, customer_phone, customer_id,
                      station, odometer_current, odometer_previous, notes, registrar_name, created_by)
                   VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
                   RETURNING *""",
                company_id, d["branchId"], plate or None, d.get("plateType", "saudi"),
                d.get("name"), d.get("modelYear"), d.get("brand"), d.get("carCategory"),
                d.get("cylinders"), d.get("color"), d.get("chassisNumber"),
                d["customerName"], d["customerPhone"], customer_id, d.get("station"),
                d.get("odometerCurrent"), d.get("odometerPrevious"), d.get("notes"),
                registrar_name, user_id,
            )

    # ── ربط اللوحة بجراج العميل الدائم — عمداً *خارج* ترانزاكشن التسجيل وعلى اتصال مستقل:
    #    أي فشل جوه الترانزاكشن (حتى الملتقط بـ except) بيسمّمها ويحوّل الـCOMMIT
    #    لـROLLBACK صامت — وده كان سبب "السيارة بتتسجل وترجع تتبخر". هنا فشله بيتسجل ويعدي. ──
    if customer_id and plate:
        try:
            await execute(
                """INSERT INTO customer_cars
                     (company_id, customer_id, plate, brand, name, model_year,
                      car_category, cylinders, color, chassis_number, last_odometer)
                   VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
                   ON CONFLICT (customer_id, plate) DO UPDATE SET
                     brand=COALESCE(EXCLUDED.brand, customer_cars.brand),
                     name=COALESCE(EXCLUDED.name, customer_cars.name),
                     model_year=COALESCE(EXCLUDED.model_year, customer_cars.model_year),
                     car_category=COALESCE(EXCLUDED.car_category, customer_cars.car_category),
                     cylinders=COALESCE(EXCLUDED.cylinders, customer_cars.cylinders),
                     color=COALESCE(EXCLUDED.color, customer_cars.color),
                     chassis_number=COALESCE(EXCLUDED.chassis_number, customer_cars.chassis_number),
                     last_odometer=COALESCE(EXCLUDED.last_odometer, customer_cars.last_odometer)""",
                company_id, customer_id, plate, d.get("brand"), d.get("name"), d.get("modelYear"),
                d.get("carCategory"), d.get("cylinders"), d.get("color"), d.get("chassisNumber"),
                d.get("odometerCurrent"),
            )
        except Exception as e:
            print(f"⚠ ربط الجراج فشل (السيارة اتسجلت عادي): {type(e).__name__}: {e}")

    return _row_out(row)


async def _auto_prepare_from_last_invoice(company_id: str, car_id: str, customer_id: str | None) -> None:
    """تجهيز الفاتورة تلقائياً بنفس أصناف آخر فاتورة للعميل — بأي طريقة دخول (best-effort، فشلها ما يمنعش الدخول)"""
    if not customer_id:
        return
    try:
        inv = await fetchrow(
            """SELECT id FROM invoices
               WHERE company_id=$1 AND customer_id=$2 AND is_returned=FALSE
               ORDER BY issued_at DESC LIMIT 1""",
            company_id, customer_id)
        if not inv:
            return
        items = await fetch(
            """SELECT product_id, qty FROM invoice_items
               WHERE invoice_id=$1 AND product_id IS NOT NULL ORDER BY id""",
            inv["id"])
        if items:
            await set_draft_items(
                company_id, car_id,
                [{"productId": str(i["product_id"]), "qty": i["qty"]} for i in items])
    except Exception:
        pass   # التجهيز التلقائي رفاهية — فشله ما يمنعش تأكيد الدخول أبداً


async def confirm_entry(company_id: str, car_id: str) -> dict:
    state = await fetchrow(
        "SELECT entered_at, exited_at FROM cars WHERE id=$1 AND company_id=$2", car_id, company_id)
    if not state:
        raise HTTPException(404, "السيارة غير موجودة")
    if state["exited_at"]:
        raise HTTPException(409, "هذه الزيارة انتهت وخرجت السيارة — سجّل زيارة جديدة بدلاً من إعادة إدخالها")
    if state["entered_at"]:
        raise HTTPException(409, "تم تأكيد دخول السيارة بالفعل — هي داخل الخدمة الآن")
    row = await fetchrow(
        """UPDATE cars SET entered_at = now(),
                           work_status = CASE WHEN work_status='queued' THEN 'preparing'
                                              ELSE work_status END
           WHERE id = $1 AND company_id = $2 AND entered_at IS NULL RETURNING *""",
        car_id, company_id,
    )
    if not row:
        raise HTTPException(409, "تم تأكيد دخول السيارة بالفعل من جهاز آخر")
    await _auto_prepare_from_last_invoice(company_id, str(row["id"]), row["customer_id"])
    row = await fetchrow("SELECT * FROM cars WHERE id=$1", row["id"])
    return _row_out(row)


async def confirm_exit(company_id: str, car_id: str) -> dict:
    state = await fetchrow(
        """SELECT c.exited_at, c.entered_at, c.work_status,
                  i.invoice_no
           FROM cars c
           LEFT JOIN invoices i ON i.car_id = c.id AND i.is_returned = FALSE
           WHERE c.id=$1 AND c.company_id=$2""", car_id, company_id)
    if not state:
        raise HTTPException(404, "السيارة غير موجودة")
    if state["exited_at"]:
        raise HTTPException(409, "السيارة خرجت بالفعل — لا يمكن تسجيل الخروج مرتين")
    # ── أمر عمل معتمد بلا فاتورة = ممنوع الخروج: يا فاتورة يا إلغاء رسمي للأمر ──
    if state["work_status"] == "ready" and not state["invoice_no"]:
        raise HTTPException(409,
            "لا يمكن الإخراج: أمر العمل معتمد ولم يُفوتر — أصدر الفاتورة من الكاشير، "
            "أو ألغِ أمر العمل رسمياً إن رفض العميل الخدمة")
    # ── خروج بلا خدمة (عميل انصرف قبل/أثناء التجهيز) = يتوثّق كإلغاء لا كتسريب صامت ──
    cancel = state["work_status"] in ("queued", "preparing") and not state["invoice_no"]
    row = await fetchrow(
        """UPDATE cars SET exited_at = now(),
                           work_status = CASE WHEN $3::boolean THEN 'cancelled' ELSE work_status END,
                           draft_items = CASE WHEN $3::boolean THEN NULL ELSE draft_items END
           WHERE id = $1 AND company_id = $2 AND exited_at IS NULL RETURNING *""",
        car_id, company_id, cancel,
    )
    if not row:
        raise HTTPException(409, "السيارة خرجت بالفعل من جهاز آخر")
    return _row_out(row)


async def cancel_order(company_id: str, car_id: str) -> dict:
    """إلغاء رسمي لأمر عمل معتمد (العميل رفض الخدمة بعد الاعتماد) —
    المسار الوحيد المسموح لفك حالة 'ready' بدون فاتورة. الفنيون يظلون مسجّلين للمساءلة."""
    state = await fetchrow(
        """SELECT c.work_status, i.invoice_no
           FROM cars c
           LEFT JOIN invoices i ON i.car_id = c.id AND i.is_returned = FALSE
           WHERE c.id=$1 AND c.company_id=$2""", car_id, company_id)
    if not state:
        raise HTTPException(404, "السيارة غير موجودة")
    if state["invoice_no"]:
        raise HTTPException(409, f"السيارة مفوترة بالفعل ({state['invoice_no']}) — "
                                 "استخدم مرتجع الفاتورة بدلاً من إلغاء أمر العمل")
    if state["work_status"] != "ready":
        raise HTTPException(409, "لا يوجد أمر عمل معتمد لإلغائه على هذه السيارة")
    row = await fetchrow(
        """UPDATE cars SET work_status='cancelled', draft_items=NULL
           WHERE id=$1 AND company_id=$2 RETURNING id, plate""", car_id, company_id)
    return {"ok": True, "plate": row["plate"]}


_EDIT_COL_MAP = {
    "name": "name", "brand": "brand", "modelYear": "model_year", "color": "color",
    "chassisNumber": "chassis_number", "customerName": "customer_name",
    "customerPhone": "customer_phone", "odometerCurrent": "odometer_current", "notes": "notes",
}


async def update_car(company_id: str, user_id: str, user_email: str, car_id: str, d: dict) -> dict:
    keys = [k for k in d if k in _EDIT_COL_MAP and d[k] is not None]
    set_parts = [f"{_EDIT_COL_MAP[k]} = ${i}" for i, k in enumerate(keys, start=3)]
    values = [d[k] for k in keys]

    # اللوحة بتتخزّن كنص واحد مركّب — نعيد بناءه لو اتبعت أجزاؤه
    if d.get("plateLetters") is not None or d.get("plateNumbers") is not None:
        cur = await fetchrow("SELECT plate FROM cars WHERE id=$1 AND company_id=$2", car_id, company_id)
        if not cur:
            raise HTTPException(404, "السيارة غير موجودة")
        parts = str(cur["plate"] or "").strip().split()
        letters = (d.get("plateLetters") if d.get("plateLetters") is not None
                  else (parts[0] if parts else "")).upper().strip()
        numbers = (d.get("plateNumbers") if d.get("plateNumbers") is not None
                  else (parts[1] if len(parts) > 1 else "")).strip()
        set_parts.append(f"plate = ${len(values) + 3}")
        values.append(" ".join(filter(None, [letters, numbers])))

    if not set_parts:
        raise HTTPException(400, "لا يوجد ما يُحدَّث")

    row = await fetchrow(
        f"UPDATE cars SET {', '.join(set_parts)} WHERE id = $1 AND company_id = $2 RETURNING *",
        car_id, company_id, *values,
    )
    if not row:
        raise HTTPException(404, "السيارة غير موجودة")

    await fetchrow(
        """INSERT INTO audit_log (company_id, branch_id, actor_id, actor_name, action, scope, car_id, details)
           VALUES ($1,$2,$3,$4,'car_edit','cars',$5,$6) RETURNING id""",
        company_id, row["branch_id"], user_id, user_email, row["id"],
        f"تعديل بيانات: {', '.join(keys) or 'اللوحة'}",
    )
    return _row_out(row)


async def delete_car(company_id: str, user_id: str, user_email: str, car_id: str) -> None:
    async with transaction() as conn:
        async with conn.transaction():
            car = await conn.fetchrow(
                "SELECT * FROM cars WHERE id=$1 AND company_id=$2 FOR UPDATE", car_id, company_id
            )
            if not car:
                raise HTTPException(404, "السيارة غير موجودة")

            # ⛔ لا يجوز حذف سيارة لها فاتورة ضريبية صادرة
            inv = await conn.fetchrow(
                "SELECT invoice_no FROM invoices WHERE car_id=$1 AND company_id=$2 AND is_returned=FALSE LIMIT 1",
                car_id, company_id,
            )
            if inv:
                raise HTTPException(
                    409, f"لا يمكن حذف السيارة — لها فاتورة صادرة رقم {inv['invoice_no']}. "
                         "نفّذ مرتجع للفاتورة أولاً.")

            await conn.execute(
                "UPDATE cars SET is_deleted=TRUE, deleted_at=now() WHERE id=$1", car_id
            )
            await reverse_journal_entries(conn, company_id, "car_sale", car_id)
            await reverse_journal_entries(conn, company_id, "car_sale_cogs", car_id)
            await conn.execute(
                """INSERT INTO audit_log (company_id, branch_id, actor_id, actor_name, action, scope, car_id)
                   VALUES ($1,$2,$3,$4,'delete','cars',$5)""",
                company_id, car["branch_id"], user_id, user_email, car_id,
            )

# ══════════════════ نقاط التشييك أثناء الخدمة ══════════════════

async def _car_or_404(company_id: str, car_id: str) -> dict:
    row = await fetchrow(
        "SELECT id, checklist FROM cars WHERE id=$1 AND company_id=$2 AND is_deleted=FALSE",
        car_id, company_id)
    if not row:
        raise HTTPException(404, "السيارة غير موجودة")
    return dict(row)


async def get_checklist(company_id: str, car_id: str) -> dict:
    row = await _car_or_404(company_id, car_id)
    return {"items": row.get("checklist") or []}


async def set_checklist(company_id: str, car_id: str, items: list[dict]) -> dict:
    await _car_or_404(company_id, car_id)
    await fetchrow(
        "UPDATE cars SET checklist=$1::jsonb WHERE id=$2 AND company_id=$3 RETURNING id",
        items, car_id, company_id)
    return {"items": items}



# ══════════════════ بوابة الدخول الذكية ══════════════════
# اللوحة المقروءة → مطابقة سيارة في الدور → تأكيد دخول تلقائي → بيانات العميل + آخر فاتورة

async def gate_scan(company_id: str, letters: str, numbers: str, branch_id: str | None = None) -> dict:
    """مطابقة اللوحة بسيارة نشطة (لسه ما خرجتش) وتأكيد دخولها تلقائياً"""
    # ── قاعدة إجبارية: الحروف لازم تكون 3 كابيتال بالظبط — أقل من كده = قراءة ناقصة تُعاد ──
    if not numbers and len(letters) != 3:
        return {"matched": False, "incomplete": True, "letters": letters, "numbers": numbers}

    car = None
    match_by = "exact"
    if len(letters) == 3 and numbers:
        # مطابقة تامة: 3 حروف + أرقام (بعد إزالة المسافات وأي ترتيب حروف/أرقام)
        normalized1 = f"{letters}{numbers}"
        normalized2 = f"{numbers}{letters}"
        car = await fetchrow(
            """SELECT * FROM cars
               WHERE company_id=$1 AND is_deleted=FALSE AND exited_at IS NULL
                 AND (UPPER(REPLACE(COALESCE(plate,''), ' ', '')) = $2
                      OR UPPER(REPLACE(COALESCE(plate,''), ' ', '')) = $3)
               ORDER BY created_at DESC LIMIT 1""",
            company_id, normalized1, normalized2)
    if not car and numbers and len(numbers) >= 2:
        # احتياط الأرقام: بس لو في سيارة نشطة واحدة فقط بالأرقام دي (منع المطابقة الغلط)
        matches = await fetch(
            """SELECT * FROM cars
               WHERE company_id=$1 AND is_deleted=FALSE AND exited_at IS NULL
                 AND plate ILIKE '%' || $2 || '%'
               ORDER BY created_at DESC LIMIT 2""",
            company_id, numbers)
        if len(matches) == 1:
            car = matches[0]
            match_by = "numbers"

    is_walk_in = False
    if not car:
        # ══ عميل مسجل معانا قبل كده (من أي طريقة: حجز أونلاين أو تسجيل يدوي) بيوصل من غير حجز ══
        # الكاميرا قرأت لوحة مش في طابور اليوم — نبحث أولاً في جراج الحجز الدائم (customer_cars)،
        # ولو مفيش، نبحث في كل تاريخ السيارات الفعلي (cars) بغض النظر عن طريقة تسجيلها —
        # عشان أي سيارة سبق دخولها بالنظام (حتى لو اتسجلت يدوياً من الموظف) تتعرّف عليها المرة الجاية.
        norm1 = f"{letters}{numbers}"
        norm2 = f"{numbers}{letters}"
        veh = await fetchrow(
            """SELECT cv.*, c.name AS cust_name, c.phone AS cust_phone
               FROM customer_cars cv JOIN customers c ON c.id = cv.customer_id
               WHERE cv.company_id=$1
                 AND (UPPER(REPLACE(cv.plate,' ','')) = $2 OR UPPER(REPLACE(cv.plate,' ','')) = $3)
               ORDER BY cv.created_at DESC LIMIT 1""",
            company_id, norm1, norm2)

        hist = None
        if not veh:
            hist = await fetchrow(
                """SELECT * FROM cars
                   WHERE company_id=$1 AND is_deleted=FALSE AND customer_id IS NOT NULL
                     AND (UPPER(REPLACE(COALESCE(plate,''),' ','')) = $2
                          OR UPPER(REPLACE(COALESCE(plate,''),' ','')) = $3)
                   ORDER BY created_at DESC LIMIT 1""",
                company_id, norm1, norm2)

        # ── احتياط الأرقام في كل التاريخ: بيغطي خطأ قراءة حرف متشابه بصرياً (H/R مثلاً) ──
        # الأرقام أصعب تتقرأ غلط من الحروف — فلو رقم اللوحة ده يطابق سيارة واحدة بس
        # في كل سجلك (جراج + تاريخ)، نعتمدها بأمان بدل ما نرفض لوحة العميل الحقيقي.
        if not veh and not hist and numbers and len(numbers) >= 3:
            cand_cc = await fetch(
                """SELECT cv.*, c.name AS cust_name, c.phone AS cust_phone
                   FROM customer_cars cv JOIN customers c ON c.id = cv.customer_id
                   WHERE cv.company_id=$1 AND REPLACE(cv.plate,' ','') ILIKE '%' || $2 || '%'
                   ORDER BY cv.created_at DESC LIMIT 3""",
                company_id, numbers)
            cand_hist = await fetch(
                """SELECT * FROM cars
                   WHERE company_id=$1 AND is_deleted=FALSE AND customer_id IS NOT NULL
                     AND REPLACE(COALESCE(plate,''),' ','') ILIKE '%' || $2 || '%'
                   ORDER BY created_at DESC LIMIT 3""",
                company_id, numbers)
            distinct_plates = {re.sub(r"[^A-Z0-9]", "", (r["plate"] or "").upper())
                               for r in [*cand_cc, *cand_hist]}
            if len(distinct_plates) == 1:
                if cand_cc:
                    veh = cand_cc[0]
                elif cand_hist:
                    hist = cand_hist[0]

        if veh or hist:
            # ── تحديد فرع الدخول الجديد: الفرع المرسَل من الشاشة ← فرع آخر زيارة له ← أول فرع مسجل ──
            entry_branch_id = branch_id
            if not entry_branch_id and hist:
                entry_branch_id = str(hist["branch_id"]) if hist["branch_id"] else None
            if not entry_branch_id:
                last_visit = await fetchrow(
                    """SELECT branch_id FROM cars
                       WHERE company_id=$1 AND customer_id=$2 AND branch_id IS NOT NULL
                       ORDER BY created_at DESC LIMIT 1""",
                    company_id, (veh or hist)["customer_id"])
                entry_branch_id = str(last_visit["branch_id"]) if last_visit else None
            if not entry_branch_id:
                any_branch = await fetchrow(
                    "SELECT id FROM branches WHERE company_id=$1 ORDER BY created_at LIMIT 1", company_id)
                entry_branch_id = str(any_branch["id"]) if any_branch else None
            if not entry_branch_id:
                raise HTTPException(500, "لا يوجد فرع مسجل بالمنشأة — أضف فرعاً أولاً")

        if veh:
            row = await fetchrow(
                """INSERT INTO cars
                     (company_id, branch_id, plate, plate_type, brand, name, model_year,
                      car_category, cylinders, color, chassis_number,
                      customer_name, customer_phone, customer_id,
                      odometer_current, service_type, entered_at, registrar_name)
                   VALUES ($1,$2,$3,'saudi',$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15, now(), 'دخول تلقائي — عميل مسجل')
                   RETURNING *""",
                company_id, entry_branch_id, veh["plate"], veh["brand"], veh["name"], veh["model_year"],
                veh["car_category"], veh["cylinders"], veh["color"], veh["chassis_number"],
                veh["cust_name"], veh["cust_phone"], veh["customer_id"],
                veh["last_odometer"], veh["service_type"])
            car = row
            is_walk_in = True
            await _auto_prepare_from_last_invoice(company_id, str(car["id"]), car["customer_id"])
        elif hist:
            row = await fetchrow(
                """INSERT INTO cars
                     (company_id, branch_id, plate, plate_type, brand, name, model_year,
                      car_category, cylinders, color, chassis_number,
                      customer_name, customer_phone, customer_id,
                      odometer_current, service_type, entered_at, registrar_name)
                   VALUES ($1,$2,$3,'saudi',$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15, now(), 'دخول تلقائي — عميل مسجل')
                   RETURNING *""",
                company_id, entry_branch_id, hist["plate"], hist["brand"], hist["name"], hist["model_year"],
                hist["car_category"], hist["cylinders"], hist["color"], hist["chassis_number"],
                hist["customer_name"], hist["customer_phone"], hist["customer_id"],
                hist["odometer_current"], hist["service_type"])
            car = row
            is_walk_in = True
            await _auto_prepare_from_last_invoice(company_id, str(car["id"]), car["customer_id"])

    if not car:
        # لو الحروف ناقصة عن 3، اعتبرها قراءة ناقصة عشان الواجهة تعيد فوراً
        return {"matched": False, "incomplete": len(letters) != 3,
                "letters": letters, "numbers": numbers}

    already_entered = car["entered_at"] is not None
    if not already_entered:
        car = await fetchrow(
            "UPDATE cars SET entered_at = now() WHERE id=$1 RETURNING *", car["id"])
        # تجهيز الفاتورة تلقائياً بنفس أصناف آخر مرة — مركزي وبيشتغل من أي طريقة دخول
        await _auto_prepare_from_last_invoice(company_id, str(car["id"]), car["customer_id"])

    # آخر فاتورة لنفس العميل — بعناصرها الكاملة لتكرارها بضغطة وتعديلها بسهولة
    last_invoice_id = None
    last_invoice_items = []
    if car["customer_id"]:
        inv = await fetchrow(
            """SELECT id FROM invoices
               WHERE company_id=$1 AND customer_id=$2 AND is_returned=FALSE
               ORDER BY issued_at DESC LIMIT 1""",
            company_id, car["customer_id"])
        if inv:
            last_invoice_id = str(inv["id"])
            items = await fetch(
                """SELECT ii.product_id, ii.product_label, ii.qty, ii.unit_price_vat
                   FROM invoice_items ii WHERE ii.invoice_id=$1 ORDER BY ii.id""",
                inv["id"])
            last_invoice_items = [
                {"productId": str(i["product_id"]) if i["product_id"] else None,
                 "label": i["product_label"], "qty": i["qty"], "unitPriceVat": float(i["unit_price_vat"])}
                for i in items if i["product_id"]]

    return {
        "matched": True,
        "matchBy": "customer_cars" if is_walk_in else match_by,
        "isWalkIn": is_walk_in,   # عميل مسجل وصل من غير حجز — علم للواجهة تعرض بانر خاص
        "alreadyEntered": already_entered,
        "car": _row_out(dict(car)),
        "lastInvoiceId": last_invoice_id,
        "lastInvoiceItems": last_invoice_items,
        "letters": letters, "numbers": numbers,
    }


async def resolve_service_fee(company_id: str, car_id: str) -> dict | None:
    """أخص قاعدة تسعير منطبقة على السيارة: ماركة+موديل+سنة > ماركة+موديل > ماركة > افتراضي"""
    car = await fetchrow(
        "SELECT brand, name, model_year FROM cars WHERE id=$1 AND company_id=$2", car_id, company_id)
    if not car:
        return None
    rules = await fetch(
        """SELECT r.*, p.name AS product_name, p.category AS product_category, p.spec AS product_spec
           FROM service_price_rules r
           JOIN products p ON p.id = r.service_product_id
           WHERE r.company_id=$1 AND p.is_active=TRUE""", company_id)
    brand = (car["brand"] or "").strip().lower()
    model = (car["name"] or "").strip().lower()
    try:
        year = int(car["model_year"]) if car["model_year"] else None
    except (TypeError, ValueError):
        year = None

    best, best_score = None, -1
    for r in rules:
        score = 0
        rb = (r["brand"] or "").strip().lower()
        rm = (r["model"] or "").strip().lower()
        if rb:
            if not brand or rb not in brand:
                continue
            score += 4
        if rm:
            if not model or rm not in model:
                continue
            score += 2
        if r["year_from"] or r["year_to"]:
            if year is None:
                continue
            if r["year_from"] and year < r["year_from"]:
                continue
            if r["year_to"] and year > r["year_to"]:
                continue
            score += 1
        if score > best_score:
            best, best_score = r, score
    if not best:
        return None
    return {
        "productId": str(best["service_product_id"]),
        "label": " — ".join(filter(None, [best["product_category"], best["product_name"], best["product_spec"]])),
        "price": float(best["price"]),
    }


INSPECTION_FEE = 25.0     # رسم فحص القير الثابت (شامل الضريبة)


async def _ensure_inspection_product(company_id: str) -> str:
    """صنف «خدمة فحص» — بيتنشأ تلقائياً أول مرة بسعر 25"""
    row = await fetchrow(
        """SELECT id FROM products
           WHERE company_id=$1 AND is_service=TRUE AND name='خدمة فحص' LIMIT 1""", company_id)
    if row:
        return str(row["id"])
    from decimal import Decimal
    row = await fetchrow(
        """INSERT INTO products (company_id, category, name, unit, price, price_vat, is_service, is_active)
           VALUES ($1, 'الخدمات', 'خدمة فحص', 'خدمة', $2, $3, TRUE, TRUE)
           RETURNING id""",
        company_id, Decimal("21.74"), Decimal(str(INSPECTION_FEE)))
    return str(row["id"])


async def force_prepare_last_invoice(company_id: str, car_id: str) -> dict:
    """تجهيز يدوي فوري لسيارة موجودة بالفعل — بنفس أصناف آخر فاتورة لعميلها (زرار «جهّز الآن»)
    ولو السيارة مش مربوطة بعميل (بسبب تعارض إنشاء قديم)، نحاول نربطها ذاتياً بجوالها الأول"""
    car = await fetchrow(
        "SELECT id, customer_id, customer_phone, customer_name FROM cars WHERE id=$1 AND company_id=$2 AND is_deleted=FALSE",
        car_id, company_id)
    if not car:
        raise HTTPException(404, "السيارة غير موجودة")
    customer_id = car["customer_id"]
    if not customer_id and car["customer_phone"]:
        digits = _DIGITS.sub("", car["customer_phone"])
        if digits:
            match = await fetchrow(
                """SELECT id FROM customers
                   WHERE company_id=$1 AND regexp_replace(phone,'\\\\D','','g') = $2 LIMIT 1""",
                company_id, digits)
            if match:
                customer_id = str(match["id"])
                await execute("UPDATE cars SET customer_id=$1 WHERE id=$2", customer_id, car_id)
    if not customer_id:
        raise HTTPException(422, "السيارة دي مش مرتبطة بعميل معروف — عدّل بياناتها وأضف جوال العميل الأول")
    inv = await fetchrow(
        """SELECT id FROM invoices
           WHERE company_id=$1 AND customer_id=$2 AND is_returned=FALSE
           ORDER BY issued_at DESC LIMIT 1""",
        company_id, customer_id)
    if not inv:
        raise HTTPException(404, "مفيش فاتورة سابقة لهذا العميل يتجهّز منها")
    items = await fetch(
        """SELECT product_id, qty FROM invoice_items
           WHERE invoice_id=$1 AND product_id IS NOT NULL ORDER BY id""",
        inv["id"])
    if not items:
        raise HTTPException(404, "الفاتورة السابقة بلا أصناف حقيقية")
    await set_draft_items(
        company_id, car_id,
        [{"productId": str(i["product_id"]), "qty": i["qty"]} for i in items])
    return {"ok": True, "itemsCount": len(items)}


async def set_draft_items(company_id: str, car_id: str, items: list[dict], flow: str = "engine") -> dict:
    """حفظ اختيار العميل من بوابة الزيت الذاتية + الخدمة المناسبة حسب نوع الرحلة"""
    clean = [{"productId": it["productId"], "qty": max(1, int(it.get("qty", 1)))}
             for it in items if it.get("productId")]
    if flow == "gear":
        # ── رحلة القير: رسم فحص ثابت — وسعر خدمة التغيير يتحدد بالفرع بعد الفحص ──
        insp = await _ensure_inspection_product(company_id)
        if not any(it["productId"] == insp for it in clean):
            clean.append({"productId": insp, "qty": 1, "priceVat": INSPECTION_FEE})
    else:
        # ── رحلة الماكينة: خدمة التغيير التلقائية حسب الماركة/الموديل/السنة ──
        fee = await resolve_service_fee(company_id, car_id)
        if fee and not any(it["productId"] == fee["productId"] for it in clean):
            clean.append({"productId": fee["productId"], "qty": 1, "priceVat": fee["price"]})
    # ملاحظة: codec الـ jsonb في core/db بيعمل json.dumps تلقائياً — تمرير القائمة مباشرة
    row = await fetchrow(
        """UPDATE cars SET draft_items = $1::jsonb
           WHERE id=$2 AND company_id=$3 AND is_deleted=FALSE
           RETURNING id""",
        clean, car_id, company_id)
    if not row:
        raise HTTPException(404, "السيارة غير موجودة")
    return {"ok": True, "itemsCount": len(clean)}


async def prepare_confirm(company_id: str, user_name: str, car_id: str,
                          items: list[dict], odometer: int | None,
                          notes: str | None,
                          filler_id: str | None = None, fitter1_id: str | None = None,
                          fitter2_id: str | None = None, checker_id: str | None = None,
                          approval_pin: str | None = None) -> dict:
    """موظف الإعداد أكّد البيانات وجهّز الأصناف — أمر العمل يتحول 'ready' ويظهر للكاشير.
       الأصناف تتخزن draft_items (نفس تخزين الفاتورة المؤقتة) والتسعير النهائي بيتحسم
       في السيرفر وقت الإصدار زي المعتاد — مفيش منطق تسعير مكرر هنا."""
    clean = [{"productId": it["productId"], "qty": max(1, int(it.get("qty", 1))),
              **({"priceVat": it["priceVat"]} if it.get("priceVat") is not None else {})}
             for it in items if it.get("productId")]
    if not clean:
        raise HTTPException(400, "أمر العمل لازم يحتوي على صنف أو خدمة واحدة على الأقل")

    # ── حارس الحالة: الاعتماد لسيارة داخل الخدمة فعلاً وغير مفوترة وغير خارجة ──
    state = await fetchrow(
        """SELECT c.entered_at, c.exited_at, c.work_status, i.invoice_no
           FROM cars c
           LEFT JOIN invoices i ON i.car_id = c.id AND i.is_returned = FALSE
           WHERE c.id=$1 AND c.company_id=$2 AND COALESCE(c.is_deleted, FALSE)=FALSE""",
        car_id, company_id)
    if not state:
        raise HTTPException(404, "السيارة غير موجودة")
    if state["invoice_no"]:
        raise HTTPException(409, f"السيارة مفوترة بالفعل ({state['invoice_no']}) — "
                                 "لا يمكن اعتماد أمر عمل جديد لنفس الزيارة. لو محتاج تعديل: مرتجع الفاتورة أولاً")
    if state["exited_at"]:
        raise HTTPException(409, "السيارة خرجت — لا يمكن اعتماد أمر عمل لزيارة منتهية")
    if not state["entered_at"]:
        raise HTTPException(409, "أكّد دخول السيارة أولاً من خانة 'في الانتظار' قبل اعتماد أمر العمل")

    # ── حارس الفنيين: لا تكرار لنفس الفني في خانتي الفك والتركيب،
    #    وكل فني مُرسَل لازم يكون موظفاً نشطاً بدور مطابق ──
    if fitter1_id and fitter1_id == fitter2_id:
        raise HTTPException(400, "لا يمكن اختيار نفس الفني في خانتي الفك والتركيب — اختر فنيَّين مختلفَين")
    tech_expect = [(filler_id, "filling", "فني التعبئة"),
                   (fitter1_id, "fitting", "فني الفك والتركيب 1"),
                   (fitter2_id, "fitting", "فني الفك والتركيب 2"),
                   (checker_id, "checking", "فني التشييك")]
    tech_ids = [tid for tid, _, _ in tech_expect if tid]
    if tech_ids:
        rows_t = await fetch(
            """SELECT id, tech_role, is_active FROM hr_employees
               WHERE company_id=$1 AND id = ANY($2::uuid[])""", company_id, tech_ids)
        found = {str(r["id"]): r for r in rows_t}
        for tid, role, label in tech_expect:
            if not tid:
                continue
            r = found.get(str(tid))
            if not r:
                raise HTTPException(400, f"{label}: الموظف غير موجود")
            if not r["is_active"]:
                raise HTTPException(400, f"{label}: الموظف غير نشط — حدّث قائمة الفنيين")
            if r["tech_role"] != role:
                raise HTTPException(400, f"{label}: دور الموظف الفني لا يطابق الخانة — راجع دوره في الموارد البشرية")

    # ── رمز الاعتماد: لو أُرسل لازم يطابق موظفاً نشطاً — والاعتماد يتسجل باسمه ──
    approver_id = None
    if approval_pin and approval_pin.strip():
        emp = await fetchrow(
            """SELECT id, full_name FROM hr_employees
               WHERE company_id=$1 AND approval_pin=$2 AND is_active=TRUE""",
            company_id, approval_pin.strip())
        if not emp:
            raise HTTPException(403, "رمز الاعتماد غير صحيح — راجع رمزك مع المدير")
        approver_id = emp["id"]
        user_name = emp["full_name"]   # المساءلة بالشخص لا بحساب التابلت المشترك
    else:
        # ── الإلزام: بمجرد وجود رموز مفعّلة في الشركة، ممنوع الاعتماد بدون رمز —
        #    الحارس على السيرفر نفسه فلا يُتجاوز من أي تطبيق أو API مباشرة ──
        pins_active = await fetchrow(
            """SELECT 1 AS x FROM hr_employees
               WHERE company_id=$1 AND approval_pin IS NOT NULL AND is_active=TRUE LIMIT 1""",
            company_id)
        if pins_active:
            raise HTTPException(403, "رمز الاعتماد مطلوب — أدخل رمزك الشخصي قبل الإرسال للكاشير")
    async with transaction() as conn:
        async with conn.transaction():
            row = await conn.fetchrow(
                """UPDATE cars SET draft_items = $1::jsonb,
                                   work_status = 'ready',
                                   prepared_by_name = $4,
                                   prepared_at = now(),
                                   odometer_current = COALESCE($5, odometer_current),
                                   notes = COALESCE($6, notes),
                                   filler_id = COALESCE($7::uuid, filler_id),
                                   fitter1_id = COALESCE($8::uuid, fitter1_id),
                                   fitter2_id = COALESCE($9::uuid, fitter2_id),
                                   checker_id = COALESCE($10::uuid, checker_id),
                                   approved_by_employee_id = COALESCE($11::uuid, approved_by_employee_id)
                   WHERE id=$2 AND company_id=$3 AND is_deleted=FALSE
                   RETURNING id, plate""",
                clean, car_id, company_id, user_name, odometer, notes,
                filler_id, fitter1_id, fitter2_id, checker_id, approver_id)
            if not row:
                raise HTTPException(404, "السيارة غير موجودة")
    return {"ok": True, "carId": str(row["id"]), "plate": row["plate"],
            "itemsCount": len(clean), "workStatus": "ready"}


# ══════════════════ الباقات الجاهزة — أمر عمل كامل بزر واحد ══════════════════

async def list_bundles(company_id: str) -> list[dict]:
    rows = await fetch(
        "SELECT id, name, items FROM work_bundles WHERE company_id=$1 ORDER BY created_at",
        company_id)
    out = []
    for r in rows:
        items = r["items"]
        if isinstance(items, str):
            items = json.loads(items)
        out.append({"id": str(r["id"]), "name": r["name"], "items": items})
    return out


async def create_bundle(company_id: str, name: str, items: list[dict]) -> dict:
    clean = [{"productId": it["productId"], "qty": max(1, int(it.get("qty", 1)))}
             for it in items if it.get("productId")]
    if not clean:
        raise HTTPException(400, "الباقة لازم تحتوي على صنف واحد على الأقل")
    row = await fetchrow(
        """INSERT INTO work_bundles (company_id, name, items)
           VALUES ($1, $2, $3::jsonb) RETURNING id""",
        company_id, name.strip(), clean)
    return {"ok": True, "id": str(row["id"])}


async def delete_bundle(company_id: str, bundle_id: str) -> dict:
    n = await execute(
        "DELETE FROM work_bundles WHERE id=$1::uuid AND company_id=$2", bundle_id, company_id)
    return {"ok": True}


# ══════════════════ الحجز الذاتي بالباركود (بدون تسجيل دخول) ══════════════════

async def public_branch_info(branch_id: str) -> dict:
    row = await fetchrow(
        "SELECT id, name, company_id FROM branches WHERE id=$1 AND is_frozen=FALSE", branch_id)
    if not row:
        raise HTTPException(404, "الفرع غير موجود")
    comp = await fetchrow("SELECT name FROM companies WHERE id=$1", row["company_id"])
    return {"branchId": str(row["id"]), "branchName": row["name"],
            "companyName": (comp or {}).get("name") or "مصدر الزيوت"}


async def _queue_position(car: dict) -> dict:
    """رقم الدور اليومي + عدد السيارات المنتظرة قبله"""
    qn = await fetchrow(
        """SELECT COUNT(*) AS n FROM cars
           WHERE branch_id=$1 AND is_deleted=FALSE
             AND created_at::date = $2::timestamptz::date AND created_at <= $3""",
        car["branch_id"], car["created_at"], car["created_at"])
    ahead = await fetchrow(
        """SELECT COUNT(*) AS n FROM cars
           WHERE branch_id=$1 AND is_deleted=FALSE
             AND exited_at IS NULL AND entered_at IS NULL
             AND created_at < $2""",
        car["branch_id"], car["created_at"])
    return {"queueNo": qn["n"], "ahead": ahead["n"]}


async def public_book(branch_id: str, d: dict) -> dict:
    branch = await fetchrow(
        "SELECT id, company_id, name FROM branches WHERE id=$1 AND is_frozen=FALSE", branch_id)
    if not branch:
        raise HTTPException(404, "الفرع غير موجود")
    name = (d.get("customerName") or "").strip()
    phone = _DIGITS.sub("", d.get("customerPhone") or "")
    letters = (d.get("plateLetters") or "").strip().upper()
    numbers = (d.get("plateNumbers") or "").strip()
    if len(name) < 2:
        raise HTTPException(400, "اكتب اسمك")
    if len(phone) < 9:
        raise HTTPException(400, "اكتب رقم جوال صحيح")
    if not numbers:
        raise HTTPException(400, "اكتب أرقام اللوحة")

    # منع الحجز المكرر: لو نفس اللوحة ليها حجز نشط في الفرع، نرجّع حجزه الحالي
    normalized = f"{letters}{numbers}"
    existing = await fetchrow(
        """SELECT * FROM cars
           WHERE company_id=$1 AND branch_id=$2 AND is_deleted=FALSE AND exited_at IS NULL
             AND UPPER(REPLACE(COALESCE(plate,''), ' ', '')) IN ($3, $4)
           ORDER BY created_at DESC LIMIT 1""",
        branch["company_id"], branch_id, f"{letters}{numbers}", f"{numbers}{letters}")
    if existing:
        pos = await _queue_position(dict(existing))
        return {"carId": str(existing["id"]), "existing": True, **pos}

    car = await create_car(
        str(branch["company_id"]), None, "حجز ذاتي 📱", {
            "branchId": branch_id,
            "plateLetters": letters or None, "plateNumbers": numbers,
            "plateType": "saudi",
            "brand": (d.get("brand") or "").strip() or None,
            "name": (d.get("carName") or "").strip() or None,
            "customerName": name, "customerPhone": phone,
        })
    pos = await _queue_position(car)
    return {"carId": car["id"], "existing": False, **pos}


async def public_status(car_id: str) -> dict:
    car = await fetchrow(
        """SELECT c.*, b.name AS branch_name FROM cars c
           JOIN branches b ON b.id = c.branch_id
           WHERE c.id=$1 AND c.is_deleted=FALSE""", car_id)
    if not car:
        raise HTTPException(404, "الحجز غير موجود")
    if car["exited_at"]:
        status = "done"
    elif car["entered_at"]:
        status = "in_service"
    else:
        status = "queued"
    pos = await _queue_position(dict(car))
    return {
        "status": status, "plate": car["plate"], "branchName": car["branch_name"],
        "station": car["station"], **pos,
    }


# ══════════════════ حجز الدور العام (QR — بدون تسجيل دخول) ══════════════════
AVG_SERVICE_MIN = 18   # متوسط زمن خدمة السيارة بالدقائق (لتقدير الانتظار)


async def public_booking_info(branch_id: str) -> dict:
    br = await fetchrow(
        "SELECT id, company_id, name, is_frozen FROM branches WHERE id=$1", branch_id)
    if not br or br["is_frozen"]:
        raise HTTPException(404, "الفرع غير متاح للحجز حالياً")
    stats = await fetchrow(
        """SELECT
             COUNT(*) FILTER (WHERE entered_at IS NULL) AS waiting,
             COUNT(*) FILTER (WHERE entered_at IS NOT NULL AND exited_at IS NULL) AS in_service
           FROM cars
           WHERE branch_id=$1 AND is_deleted=FALSE AND exited_at IS NULL
             AND created_at::date = CURRENT_DATE""", branch_id)
    return {
        "branchName": br["name"],
        "waiting": stats["waiting"], "inService": stats["in_service"],
        "estWaitMinutes": stats["waiting"] * AVG_SERVICE_MIN,
    }


async def _upsert_garage(company_id: str, customer_id: str, plate: str, car: dict, service_type: str):
    """حفظ السيارة في كراج العميل — ما بيضيعش أبداً حتى لو مسح بيانات موبايله"""
    await execute(
        """INSERT INTO customer_cars
             (company_id, customer_id, plate, brand, name, model_year,
              car_category, cylinders, color, chassis_number, service_type)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
           ON CONFLICT (customer_id, plate) DO UPDATE SET
             brand=COALESCE(EXCLUDED.brand, customer_cars.brand),
             name=COALESCE(EXCLUDED.name, customer_cars.name),
             model_year=COALESCE(EXCLUDED.model_year, customer_cars.model_year),
             car_category=COALESCE(EXCLUDED.car_category, customer_cars.car_category),
             cylinders=COALESCE(EXCLUDED.cylinders, customer_cars.cylinders),
             color=COALESCE(EXCLUDED.color, customer_cars.color),
             chassis_number=COALESCE(EXCLUDED.chassis_number, customer_cars.chassis_number),
             service_type=EXCLUDED.service_type""",
        company_id, customer_id, plate, car.get("brand"), car.get("carName"),
        car.get("modelYear"), car.get("carCategory"), car.get("cylinders"),
        car.get("color"), car.get("chassisNumber"), service_type)


async def public_lookup(branch_id: str, phone: str, plate: str | None = None) -> dict:
    """استرجاع ملف العميل وسياراته بالجوال أو بلوحة أي سيارة له — بياناته ما بتضيعش أبداً"""
    br = await fetchrow("SELECT company_id FROM branches WHERE id=$1", branch_id)
    if not br:
        raise HTTPException(404, "الفرع غير موجود")
    phone = re.sub(r"[^0-9]", "", phone or "")
    plate_norm = re.sub(r"[^A-Z0-9]", "", (plate or "").upper())
    if len(phone) < 9 and len(plate_norm) < 4:
        raise HTTPException(422, "أدخل رقم جوال صحيح أو رقم لوحة")
    cust = None
    if len(phone) >= 9:
        cust = await fetchrow(
            """SELECT id, name, phone, customer_type, vat_number, cr_number, address,
                      building_no, street, district, city, postal_code, additional_no
               FROM customers WHERE company_id=$1 AND phone=$2""", br["company_id"], phone)
    if not cust and plate_norm:
        via = await fetchrow(
            """SELECT customer_id FROM customer_cars
               WHERE company_id=$1 AND UPPER(REPLACE(plate,' ','')) = $2
               ORDER BY created_at DESC LIMIT 1""", br["company_id"], plate_norm)
        if not via:
            via = await fetchrow(
                """SELECT customer_id FROM cars
                   WHERE company_id=$1 AND is_deleted=FALSE AND customer_id IS NOT NULL
                     AND UPPER(REPLACE(COALESCE(plate,''),' ','')) = $2
                   ORDER BY created_at DESC LIMIT 1""", br["company_id"], plate_norm)
        if via:
            cust = await fetchrow(
                """SELECT id, name, phone, customer_type, vat_number, cr_number, address,
                          building_no, street, district, city, postal_code, additional_no
                   FROM customers WHERE id=$1""", via["customer_id"])
    if not cust:
        return {"found": False}
    cars_rows = await fetch(
        """SELECT id, plate, brand, name, model_year, car_category, cylinders,
                  color, chassis_number, service_type
           FROM customer_cars WHERE customer_id=$1 ORDER BY created_at DESC""", cust["id"])
    # سيارات من تاريخ الزيارات مش متسجلة في الكراج؟ نكملها تلقائياً
    if not cars_rows:
        hist = await fetch(
            """SELECT DISTINCT ON (plate) plate, brand, name, model_year
               FROM cars WHERE customer_id=$1 AND plate IS NOT NULL AND is_deleted=FALSE
               ORDER BY plate, created_at DESC LIMIT 6""", cust["id"])
        for h in hist:
            await _upsert_garage(br["company_id"], str(cust["id"]), h["plate"],
                                 {"brand": h["brand"], "carName": h["name"], "modelYear": h["model_year"]}, "basic")
        cars_rows = await fetch(
            """SELECT id, plate, brand, name, model_year, car_category, cylinders,
                      color, chassis_number, service_type
               FROM customer_cars WHERE customer_id=$1 ORDER BY created_at DESC""", cust["id"])
    return {
        "found": True,
        "customer": {**{k: cust[k] for k in cust.keys()}, "id": str(cust["id"])},
        "cars": [{**dict(r), "id": str(r["id"])} for r in cars_rows],
    }


def _validate_by_type(service_type: str, d: dict, car: dict):
    """قواعد الإلزام لكل فئة تسجيل"""
    req = lambda cond, msg: (_ for _ in ()).throw(HTTPException(422, msg)) if not cond else None
    req((d.get("name") or "").strip(), "الاسم مطلوب")
    req(len(re.sub(r"[^0-9]", "", d.get("phone") or "")) >= 9, "رقم جوال صحيح مطلوب")
    req(car.get("brand"), "ماركة السيارة مطلوبة")
    req(car.get("carName"), "موديل السيارة مطلوب")
    req(car.get("modelYear"), "سنة الصنع مطلوبة")
    req(car.get("odometer") not in (None, ""), "ممشى السيارة الحالي مطلوب")
    if service_type in ("warranty", "company"):
        req(car.get("carCategory"), "فئة السيارة مطلوبة لسيارات الضمان")
        req(car.get("cylinders"), "عدد السلندرات مطلوب لسيارات الضمان")
        req(car.get("color"), "لون السيارة مطلوب لسيارات الضمان")
        req(car.get("chassisNumber"), "رقم الهيكل (الشاصي) مطلوب لسيارات الضمان")
    if service_type == "company":
        comp = d.get("company") or {}
        req(re.fullmatch(r"3\d{14}", comp.get("vat", "") or ""), "الرقم الضريبي 15 رقم يبدأ بـ 3")
        req((comp.get("cr") or "").strip(), "رقم السجل التجاري مطلوب")
        req((comp.get("city") or "").strip() and (comp.get("district") or "").strip()
            and (comp.get("street") or "").strip() and (comp.get("buildingNo") or "").strip(),
            "العنوان الوطني كامل مطلوب (مبنى، شارع، حي، مدينة)")


async def public_create_booking(branch_id: str, d: dict) -> dict:
    br = await fetchrow(
        "SELECT id, company_id, name, is_frozen FROM branches WHERE id=$1", branch_id)
    if not br or br["is_frozen"]:
        raise HTTPException(404, "الفرع غير متاح للحجز حالياً")
    company_id = br["company_id"]

    service_type = d.get("serviceType") or "basic"
    if service_type not in ("basic", "warranty", "company"):
        service_type = "basic"

    phone = re.sub(r"[^0-9]", "", d.get("phone") or "")
    name = (d.get("name") or "").strip()

    # ── سيارة محفوظة من الكراج؟ حجز فوري ──
    car: dict = d.get("car") or {}
    saved_id = d.get("savedCarId")
    if saved_id:
        saved = await fetchrow(
            """SELECT cc.*, c.phone AS cust_phone, c.name AS cust_name, c.id AS cust_id
               FROM customer_cars cc JOIN customers c ON c.id = cc.customer_id
               WHERE cc.id=$1 AND cc.company_id=$2""", saved_id, company_id)
        if not saved:
            raise HTTPException(404, "السيارة المحفوظة غير موجودة")
        m = re.match(r"^(\d+)\s+([A-Z]{3})$", saved["plate"] or "")
        car = {"plateNumbers": m.group(1) if m else re.sub(r"[^0-9]", "", saved["plate"] or ""),
               "plateLetters": m.group(2) if m else re.sub(r"[^A-Z]", "", (saved["plate"] or "").upper()),
               "brand": saved["brand"], "carName": saved["name"], "modelYear": saved["model_year"],
               "carCategory": saved["car_category"], "cylinders": saved["cylinders"],
               "color": saved["color"], "chassisNumber": saved["chassis_number"],
               "odometer": d.get("odometer") or (car.get("odometer") if car else None)}
        service_type = d.get("serviceType") or saved["service_type"] or "basic"
        phone, name = saved["cust_phone"], saved["cust_name"]
        if car.get("odometer") in (None, ""):
            raise HTTPException(422, "أدخل ممشى السيارة الحالي")
    else:
        _validate_by_type(service_type, d, car)

    letters = re.sub(r"[^A-Z]", "", (car.get("plateLetters") or "").upper())[:3]
    numbers = re.sub(r"[^0-9]", "", str(car.get("plateNumbers") or ""))[:4]
    if len(letters) != 3 or not numbers:
        raise HTTPException(422, "أدخل لوحة صحيحة: 3 حروف إنجليزية وأرقامها")
    plate = f"{numbers} {letters}"

    # ── نفس اللوحة نشطة؟ رجّع حجزها ──
    existing = await fetchrow(
        """SELECT id FROM cars WHERE branch_id=$1 AND is_deleted=FALSE AND exited_at IS NULL
             AND UPPER(REPLACE(COALESCE(plate,''),' ','')) = $2""",
        branch_id, f"{numbers}{letters}")
    if existing:
        return await public_booking_status(str(existing["id"]))

    # ── العميل: موجود بالجوال أو جديد — وتحديث بيانات الشركة لو فئة 3 ──
    cust = await fetchrow(
        "SELECT id, name FROM customers WHERE company_id=$1 AND phone=$2", company_id, phone)
    if not cust:
        cust = await fetchrow(
            """INSERT INTO customers (company_id, name, phone, customer_type)
               VALUES ($1,$2,$3,$4) RETURNING id, name""",
            company_id, name, phone, "company" if service_type == "company" else "individual")
    if service_type == "company":
        comp = d.get("company") or {}
        await execute(
            """UPDATE customers SET customer_type='company',
                 vat_number=$1, cr_number=$2,
                 building_no=$3, street=$4, district=$5, city=$6,
                 postal_code=$7, additional_no=$8,
                 address=$9
               WHERE id=$10""",
            comp.get("vat"), comp.get("cr"),
            comp.get("buildingNo"), comp.get("street"), comp.get("district"), comp.get("city"),
            comp.get("postalCode"), comp.get("additionalNo"),
            " — ".join(filter(None, [comp.get("city"), comp.get("district"),
                                      comp.get("street"), f"مبنى {comp.get('buildingNo')}" if comp.get("buildingNo") else None])),
            cust["id"])

    # ── حفظ السيارة في كراج العميل (دائم) ──
    await _upsert_garage(company_id, str(cust["id"]), plate, car, service_type)

    # ── إنشاء الحجز في الدور ──
    odo = None
    try: odo = int(car.get("odometer")) if car.get("odometer") not in (None, "") else None
    except (TypeError, ValueError): odo = None
    row = await fetchrow(
        """INSERT INTO cars
             (company_id, branch_id, plate, plate_type, brand, name, model_year,
              car_category, cylinders, color, chassis_number,
              customer_name, customer_phone, customer_id,
              odometer_current, service_type, registrar_name)
           VALUES ($1,$2,$3,'saudi',$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,'حجز أونلاين QR')
           RETURNING id""",
        company_id, branch_id, plate, car.get("brand"), car.get("carName"), car.get("modelYear"),
        car.get("carCategory"), car.get("cylinders"), car.get("color"), car.get("chassisNumber"),
        name, phone, cust["id"], odo, service_type)
    return await public_booking_status(str(row["id"]))


async def public_booking_status(car_id: str) -> dict:
    car = await fetchrow(
        """SELECT c.*, b.name AS branch_name FROM cars c
           JOIN branches b ON b.id = c.branch_id
           WHERE c.id=$1 AND c.is_deleted=FALSE""", car_id)
    if not car:
        raise HTTPException(404, "الحجز غير موجود")

    # رقم الدور: ترتيبه بين سيارات الفرع لليوم نفسه
    queue_no = await fetchrow(
        """SELECT COUNT(*) AS n FROM cars
           WHERE branch_id=$1 AND is_deleted=FALSE
             AND created_at::date = $2::date AND created_at <= $3""",
        car["branch_id"], car["created_at"], car["created_at"])
    # كام سيارة قدامه لسه مستنية
    ahead = await fetchrow(
        """SELECT COUNT(*) AS n FROM cars
           WHERE branch_id=$1 AND is_deleted=FALSE AND exited_at IS NULL
             AND entered_at IS NULL AND created_at < $2 AND id <> $3""",
        car["branch_id"], car["created_at"], car["id"])

    if car["exited_at"]:
        state = "done"
    elif car["entered_at"]:
        state = "in_service"
    else:
        state = "waiting"
    return {
        "bookingId": str(car["id"]),
        "state": state,
        "queueNo": queue_no["n"],
        "ahead": ahead["n"],
        "estWaitMinutes": ahead["n"] * AVG_SERVICE_MIN,
        "plate": car["plate"],
        "customerName": car["customer_name"],
        "station": car["station"],
        "branchName": car["branch_name"],
    }


# ══════════════════ ملف العميل وجراجه (استرجاع دائم بالجوال أو اللوحة) ══════════════════

def _vehicle_out(v: dict) -> dict:
    v = dict(v)
    for k in ("id", "customer_id"):
        v[k] = str(v[k])
    v.pop("company_id", None)
    v.pop("plate_norm", None)
    return v


async def public_profile(branch_id: str, phone: str | None, plate: str | None) -> dict:
    br = await fetchrow("SELECT company_id FROM branches WHERE id=$1", branch_id)
    if not br:
        raise HTTPException(404, "الفرع غير موجود")
    company_id = br["company_id"]

    customer = None
    if phone:
        phone = re.sub(r"[^0-9]", "", phone)
        customer = await fetchrow(
            """SELECT id, name, phone, vat_number, cr_number, address
               FROM customers WHERE company_id=$1 AND phone=$2""", company_id, phone)
    if not customer and plate:
        norm = re.sub(r"[^A-Z0-9]", "", plate.upper())
        veh = await fetchrow(
            "SELECT customer_id FROM customer_vehicles WHERE company_id=$1 AND plate_norm=$2",
            company_id, norm)
        if veh:
            customer = await fetchrow(
                """SELECT id, name, phone, vat_number, cr_number, address
                   FROM customers WHERE id=$1""", veh["customer_id"])
    if not customer:
        return {"found": False}

    vehicles = await fetch(
        """SELECT * FROM customer_vehicles
           WHERE company_id=$1 AND customer_id=$2 ORDER BY created_at""",
        company_id, customer["id"])
    return {
        "found": True,
        "customer": {"id": str(customer["id"]), "name": customer["name"],
                     "phone": customer["phone"], "hasTax": bool(customer["vat_number"])},
        "vehicles": [_vehicle_out(v) for v in vehicles],
    }


def _validate_booking_vehicle(ctype: str, v: dict) -> None:
    """قواعد الإلزام حسب نوع التسجيل"""
    base_missing = [k for k in ("brand", "carName", "modelYear") if not (v.get(k) or "").strip()]
    if base_missing:
        raise HTTPException(422, "أكمل نوع السيارة وموديلها وسنة الصنع")
    if ctype in ("warranty", "company"):
        full_missing = [k for k in ("carCategory", "cylinders", "color", "chassisNumber")
                        if not (v.get(k) or "").strip()]
        if full_missing:
            raise HTTPException(422, "سيارات الضمان تتطلب بيانات السيارة كاملة (الفئة، السلندرات، اللون، رقم الهيكل)")


async def public_register_and_book(branch_id: str, d: dict) -> dict:
    """تسجيل عميل + حفظ سيارته في جراجه + حجز الدور — حسب نوع التسجيل الثلاثي"""
    br = await fetchrow(
        "SELECT id, company_id, is_frozen FROM branches WHERE id=$1", branch_id)
    if not br or br["is_frozen"]:
        raise HTTPException(404, "الفرع غير متاح للحجز حالياً")
    company_id = br["company_id"]

    ctype = d.get("customerType") or "standard"
    name = (d.get("name") or "").strip()
    phone = re.sub(r"[^0-9]", "", d.get("phone") or "")
    if not name or len(phone) < 9:
        raise HTTPException(422, "أدخل الاسم ورقم جوال صحيح")

    v = d.get("vehicle") or {}
    letters = re.sub(r"[^A-Z]", "", (v.get("plateLetters") or "").upper())[:3]
    numbers = re.sub(r"[^0-9]", "", v.get("plateNumbers") or "")[:4]
    if len(letters) != 3 or not numbers:
        raise HTTPException(422, "أدخل لوحة صحيحة: أرقامها و3 حروف إنجليزية")
    plate = f"{numbers} {letters}"
    plate_norm = f"{numbers}{letters}"
    _validate_booking_vehicle(ctype, v)

    odometer = d.get("odometer")
    if odometer is None or int(odometer) < 0:
        raise HTTPException(422, "أدخل ممشى السيارة الحالي (العداد)")
    odometer = int(odometer)

    if ctype == "company":
        vat = re.sub(r"[^0-9]", "", d.get("vatNumber") or "")
        cr = (d.get("crNumber") or "").strip()
        addr = (d.get("nationalAddress") or "").strip()
        if len(vat) != 15:
            raise HTTPException(422, "الرقم الضريبي لازم يكون 15 رقم")
        if not cr or len(addr) < 10:
            raise HTTPException(422, "أدخل رقم السجل والعنوان الوطني كاملاً")

    async with transaction() as conn:
        async with conn.transaction():
            # ── العميل: موجود بالجوال أو جديد + تحديث البيانات الضريبية لو شركة ──
            cust = await conn.fetchrow(
                "SELECT id FROM customers WHERE company_id=$1 AND phone=$2", company_id, phone)
            if cust:
                customer_id = cust["id"]
                if ctype == "company":
                    await conn.execute(
                        """UPDATE customers SET name=$1, customer_type='company',
                             vat_number=$2, cr_number=$3, address=$4 WHERE id=$5""",
                        name, vat, cr, addr, customer_id)
            else:
                row = await conn.fetchrow(
                    """INSERT INTO customers (company_id, name, phone, customer_type, vat_number, cr_number, address)
                       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id""",
                    company_id, name, phone,
                    "company" if ctype == "company" else "individual",
                    vat if ctype == "company" else None,
                    cr if ctype == "company" else None,
                    addr if ctype == "company" else None)
                customer_id = row["id"]

            # ── الجراج: حفظ/تحديث السيارة (اللوحة مفتاح دائم) ──
            await conn.execute(
                """INSERT INTO customer_vehicles
                     (company_id, customer_id, plate, plate_norm, brand, name, model_year,
                      car_category, cylinders, color, chassis_number, last_odometer, service_type)
                   VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
                   ON CONFLICT (company_id, plate_norm) DO UPDATE SET
                     customer_id=$2, brand=$5, name=$6, model_year=$7,
                     car_category=$8, cylinders=$9, color=$10, chassis_number=$11,
                     last_odometer=$12, service_type=$13""",
                company_id, customer_id, plate, plate_norm,
                v.get("brand"), v.get("carName"), v.get("modelYear"),
                v.get("carCategory"), v.get("cylinders"), v.get("color"), v.get("chassisNumber"),
                odometer, ctype)

    return await _book_from_data(branch_id, company_id, customer_id, name, phone,
                                 plate, plate_norm, v, odometer)


async def public_quick_book(branch_id: str, vehicle_id: str, odometer: int | None) -> dict:
    """حجز بضغطة من سيارة محفوظة في الجراج"""
    br = await fetchrow(
        "SELECT id, company_id, is_frozen FROM branches WHERE id=$1", branch_id)
    if not br or br["is_frozen"]:
        raise HTTPException(404, "الفرع غير متاح للحجز حالياً")
    veh = await fetchrow(
        """SELECT cv.*, c.name AS cust_name, c.phone AS cust_phone
           FROM customer_vehicles cv JOIN customers c ON c.id = cv.customer_id
           WHERE cv.id=$1 AND cv.company_id=$2""", vehicle_id, br["company_id"])
    if not veh:
        raise HTTPException(404, "السيارة غير موجودة")
    odo = int(odometer) if odometer is not None else veh["last_odometer"]
    if odo is not None:
        await execute("UPDATE customer_vehicles SET last_odometer=$1 WHERE id=$2", odo, vehicle_id)
    vdata = {"brand": veh["brand"], "carName": veh["name"], "modelYear": veh["model_year"],
             "carCategory": veh["car_category"], "cylinders": veh["cylinders"],
             "color": veh["color"], "chassisNumber": veh["chassis_number"]}
    return await _book_from_data(branch_id, br["company_id"], veh["customer_id"],
                                 veh["cust_name"], veh["cust_phone"],
                                 veh["plate"], veh["plate_norm"], vdata, odo)


async def _book_from_data(branch_id, company_id, customer_id, name, phone,
                          plate, plate_norm, v: dict, odometer: int | None) -> dict:
    # نفس اللوحة نشطة بالفعل؟ رجّع حجزها
    existing = await fetchrow(
        """SELECT id FROM cars
           WHERE branch_id=$1 AND is_deleted=FALSE AND exited_at IS NULL
             AND UPPER(REPLACE(COALESCE(plate,''),' ','')) = $2""",
        branch_id, plate_norm)
    if existing:
        return await public_booking_status(str(existing["id"]))

    prev = await fetchrow(
        """SELECT odometer_current FROM cars
           WHERE company_id=$1 AND UPPER(REPLACE(COALESCE(plate,''),' ','')) = $2
             AND odometer_current IS NOT NULL
           ORDER BY created_at DESC LIMIT 1""", company_id, plate_norm)

    row = await fetchrow(
        """INSERT INTO cars
             (company_id, branch_id, plate, plate_type, brand, name, model_year,
              car_category, cylinders, color, chassis_number,
              customer_name, customer_phone, customer_id,
              odometer_current, odometer_previous, registrar_name)
           VALUES ($1,$2,$3,'saudi',$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,'حجز أونلاين QR')
           RETURNING id""",
        company_id, branch_id, plate,
        v.get("brand"), v.get("carName"), v.get("modelYear"),
        v.get("carCategory"), v.get("cylinders"), v.get("color"), v.get("chassisNumber"),
        name, phone, customer_id,
        odometer, prev["odometer_current"] if prev else None)
    return await public_booking_status(str(row["id"]))


# ══════════════════ إسناد العمل: مين اشتغل على السيارة ══════════════════

async def log_work(company_id: str, car_id: str, employee_id: str | None,
                   employee_name: str) -> dict:
    car = await fetchrow(
        "SELECT id, station FROM cars WHERE id=$1 AND company_id=$2 AND is_deleted=FALSE",
        car_id, company_id)
    if not car:
        raise HTTPException(404, "السيارة غير موجودة")
    name = (employee_name or "").strip()
    if not name:
        raise HTTPException(422, "اختر الموظف")
    await execute(
        """INSERT INTO car_work_log (company_id, car_id, employee_id, employee_name, station)
           VALUES ($1,$2,$3,$4,$5)""",
        company_id, car_id, employee_id, name, car["station"])
    return await get_work_log(company_id, car_id)


async def get_work_log(company_id: str, car_id: str) -> dict:
    rows = await fetch(
        """SELECT employee_id, employee_name, station, created_at
           FROM car_work_log WHERE company_id=$1 AND car_id=$2
           ORDER BY created_at""", company_id, car_id)
    return {"items": [{"employee_id": str(r["employee_id"]) if r["employee_id"] else None,
                       "employee_name": r["employee_name"], "station": r["station"],
                       "at": r["created_at"].isoformat()} for r in rows]}


async def line_workers(company_id: str) -> list[dict]:
    """قائمة فنيي الخط للاختيار السريع في شاشة المحطة — من موديول الموارد البشرية"""
    try:
        rows = await fetch(
            """SELECT id, full_name FROM hr_employees
               WHERE company_id=$1 AND COALESCE(is_active, TRUE)=TRUE
               ORDER BY full_name LIMIT 40""", company_id)
        return [{"id": str(r["id"]), "name": r["full_name"]} for r in rows]
    except Exception as e:
        # قائمة الفنيين رفاهية مساعدة — فشلها ما يكسرش شاشة المحطة أبداً
        print(f"⚠ line_workers: {type(e).__name__}: {e}")
        return []


# ══════════════════ تنبيهات المشرف الآلي ══════════════════

async def list_alerts(company_id: str) -> list[dict]:
    rows = await fetch(
        """SELECT id, car_id, plate, station, message, created_at
           FROM car_alerts WHERE company_id=$1 AND seen=FALSE
           ORDER BY created_at DESC LIMIT 20""", company_id)
    return [{"id": str(r["id"]), "car_id": str(r["car_id"]), "plate": r["plate"],
             "station": r["station"], "message": r["message"],
             "at": r["created_at"].isoformat()} for r in rows]


async def mark_alert_seen(company_id: str, alert_id: str, is_false: bool = False) -> dict:
    await execute("UPDATE car_alerts SET seen=TRUE, is_false=$3 WHERE id=$1 AND company_id=$2",
                  alert_id, company_id, is_false)
    return {"ok": True}

# ══════════════════ فريق العمل — مراجعة من اشتغل على السيارة ══════════════════

async def car_team(company_id: str, car_id: str) -> dict:
    """بطاقة فريق العمل الكاملة لسيارة: الأدوار الأربعة المحفوظة لحظة اعتماد أمر العمل
    + سجل الإسناد اليدوي (car_work_log) + التوقيتات — أساس المساءلة بعد الحدث."""
    row = await fetchrow(
        """SELECT c.id, c.plate, c.customer_name, c.brand, c.name AS car_name,
                  c.prepared_by_name, c.prepared_at, c.entered_at, c.exited_at, c.station,
                  f.full_name  AS filler_name,
                  t1.full_name AS fitter1_name,
                  t2.full_name AS fitter2_name,
                  ch.full_name AS checker_name,
                  ap.full_name AS approver_name
           FROM cars c
           LEFT JOIN hr_employees f  ON f.id  = c.filler_id
           LEFT JOIN hr_employees t1 ON t1.id = c.fitter1_id
           LEFT JOIN hr_employees t2 ON t2.id = c.fitter2_id
           LEFT JOIN hr_employees ch ON ch.id = c.checker_id
           LEFT JOIN hr_employees ap ON ap.id = c.approved_by_employee_id
           WHERE c.id=$1::uuid AND c.company_id=$2 AND COALESCE(c.is_deleted, FALSE)=FALSE""",
        car_id, company_id)
    if not row:
        raise HTTPException(404, "السيارة غير موجودة")
    log = await get_work_log(company_id, car_id)
    return {
        "plate": row["plate"],
        "customerName": row["customer_name"],
        "car": " ".join(x for x in [row["brand"], row["car_name"]] if x),
        "station": row["station"],
        "filler": row["filler_name"],
        "fitter1": row["fitter1_name"],
        "fitter2": row["fitter2_name"],
        "checker": row["checker_name"],
        "preparedBy": row["approver_name"] or row["prepared_by_name"],
        "preparedAt": row["prepared_at"].isoformat() if row["prepared_at"] else None,
        "enteredAt": row["entered_at"].isoformat() if row["entered_at"] else None,
        "exitedAt": row["exited_at"].isoformat() if row["exited_at"] else None,
        "log": log["items"],
    }


async def tech_report(company_id: str, branch_scope: str | None, branch_id_param: str | None,
                      date_from: str, date_to: str) -> dict:
    """تقرير إنتاجية الفنيين: عدد السيارات لكل فني مقسمة بالدور خلال فترة.
    الفلترة على prepared_at (لحظة اعتماد أمر العمل — لحظة تسجيل الفريق نفسها)."""
    branch_id = branch_scope or branch_id_param
    rows = await fetch(
        """WITH assignments AS (
               SELECT filler_id AS emp_id, 'filling' AS role, id AS car_id FROM cars
                WHERE company_id=$1 AND COALESCE(is_deleted, FALSE)=FALSE
                  AND prepared_at >= $2::text::date AND prepared_at < ($3::text::date + 1)
                  AND ($4::uuid IS NULL OR branch_id=$4::uuid) AND filler_id IS NOT NULL
               UNION ALL
               SELECT fitter1_id, 'fitting', id FROM cars
                WHERE company_id=$1 AND COALESCE(is_deleted, FALSE)=FALSE
                  AND prepared_at >= $2::text::date AND prepared_at < ($3::text::date + 1)
                  AND ($4::uuid IS NULL OR branch_id=$4::uuid) AND fitter1_id IS NOT NULL
               UNION ALL
               SELECT fitter2_id, 'fitting', id FROM cars
                WHERE company_id=$1 AND COALESCE(is_deleted, FALSE)=FALSE
                  AND prepared_at >= $2::text::date AND prepared_at < ($3::text::date + 1)
                  AND ($4::uuid IS NULL OR branch_id=$4::uuid) AND fitter2_id IS NOT NULL
               UNION ALL
               SELECT checker_id, 'checking', id FROM cars
                WHERE company_id=$1 AND COALESCE(is_deleted, FALSE)=FALSE
                  AND prepared_at >= $2::text::date AND prepared_at < ($3::text::date + 1)
                  AND ($4::uuid IS NULL OR branch_id=$4::uuid) AND checker_id IS NOT NULL
           )
           SELECT e.id, e.full_name, e.tech_role, e.branch_id,
                  COUNT(*) FILTER (WHERE a.role='filling')  AS filling,
                  COUNT(*) FILTER (WHERE a.role='fitting')  AS fitting,
                  COUNT(*) FILTER (WHERE a.role='checking') AS checking,
                  COUNT(DISTINCT a.car_id) AS total_cars
           FROM assignments a
           JOIN hr_employees e ON e.id = a.emp_id
           GROUP BY e.id, e.full_name, e.tech_role, e.branch_id
           ORDER BY total_cars DESC, e.full_name""",
        company_id, date_from, date_to, branch_id)
    total = await fetchrow(
        """SELECT COUNT(*) AS n FROM cars
           WHERE company_id=$1 AND COALESCE(is_deleted, FALSE)=FALSE
             AND prepared_at >= $2::text::date AND prepared_at < ($3::text::date + 1)
             AND ($4::uuid IS NULL OR branch_id=$4::uuid)
             AND (filler_id IS NOT NULL OR fitter1_id IS NOT NULL
                  OR fitter2_id IS NOT NULL OR checker_id IS NOT NULL)""",
        company_id, date_from, date_to, branch_id)
    return {
        "from": date_from, "to": date_to,
        "totalCars": total["n"] if total else 0,
        "rows": [{
            "id": str(r["id"]), "name": r["full_name"], "role": r["tech_role"],
            "branchId": str(r["branch_id"]) if r["branch_id"] else None,
            "filling": r["filling"], "fitting": r["fitting"], "checking": r["checking"],
            "totalCars": r["total_cars"],
        } for r in rows],
    }
