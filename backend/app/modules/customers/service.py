# modules/customers/service.py — منطق الأعمال معزول عن طبقة الـ HTTP
# الاستعلامات منقولة من customers.routes.js القديم بالحرف — نفس صيغة $1
import re
import time
from decimal import Decimal

import asyncpg
from fastapi import HTTPException

from ...core import accounting
from ...core.db import fetch, fetchrow, transaction
from ...core.plate_utils import DIGIT_MAP, plate_identity

# منظّف مدخل رقم اللوحة: حروف/أرقام عربي أو إنجليزي فقط — يمنع أي محارف
# LIKE خاصة زي % و _ من التسبب في مطابقات غريبة
_PLATE_CLEAN = re.compile(r"[^0-9A-Za-z\u0621-\u064A]")


def _clean_plate(s: str) -> str:
    return _PLATE_CLEAN.sub("", (s or "").upper())


def _customer_out(r: dict) -> dict:
    r = dict(r)
    r["id"] = str(r["id"])
    if r.get("price_list_id") is not None:
        r["price_list_id"] = str(r["price_list_id"])
    for k in ("balance", "credit_limit", "contract_discount_pct"):
        if isinstance(r.get(k), Decimal):
            r[k] = float(r[k])
    return r


_COL_MAP = {
    "name": "name", "customerType": "customer_type", "phone": "phone", "email": "email",
    "vatNumber": "vat_number", "crNumber": "cr_number", "address": "address",
    "buildingNo": "building_no", "street": "street", "district": "district",
    "city": "city", "postalCode": "postal_code", "additionalNo": "additional_no",
    "creditLimit": "credit_limit", "priceListId": "price_list_id",
    "contractDiscountPct": "contract_discount_pct", "contractValidFrom": "contract_valid_from",
    "contractValidUntil": "contract_valid_until", "contractNotes": "contract_notes",
}


# ══════════════════ قراءة ══════════════════

async def list_customers(company_id: str) -> list[dict]:
    # subqueries منفصلة بدل JOIN مزدوج مباشر مع customer_ledger و customer_vehicles معاً،
    # لأن الاتنين جداول "واحد لأكثر" والـ JOIN المباشر بينهم بيسبب fan-out
    # (تكرار كل حركة حساب بعدد سيارات العميل) فيطلع رصيد مضاعف غلط
    rows = await fetch(
        """SELECT c.*,
                  COALESCE((SELECT SUM(cl.amount) FROM customer_ledger cl WHERE cl.customer_id = c.id),0)::numeric(12,2) AS balance,
                  COALESCE((SELECT COUNT(*) FROM customer_vehicles cv WHERE cv.customer_id = c.id),0)::int AS vehicle_count
           FROM customers c
           WHERE c.company_id = $1 AND c.is_active = TRUE
           ORDER BY c.name""",
        company_id,
    )
    return [_customer_out(r) for r in rows]


async def get_customer(company_id: str, customer_id: str) -> dict:
    """عميل واحد ببياناته الكاملة — لصفحة ملف العميل (بديل سحب القائمة كلها والفلترة محليًا)"""
    row = await fetchrow(
        """SELECT c.*,
                  COALESCE((SELECT SUM(cl.amount) FROM customer_ledger cl WHERE cl.customer_id = c.id),0)::numeric(12,2) AS balance,
                  COALESCE((SELECT COUNT(*) FROM customer_vehicles cv WHERE cv.customer_id = c.id),0)::int AS vehicle_count
           FROM customers c
           WHERE c.id = $1 AND c.company_id = $2""",
        customer_id, company_id,
    )
    if not row:
        raise HTTPException(404, "العميل غير موجود")
    return _customer_out(row)


async def search_by_plate(company_id: str, plate: str) -> list[dict]:
    q = _clean_plate(plate)
    if len(q) < 2:
        return []
    rows = await fetch(
        """SELECT DISTINCT ON (c.id)
                  c.*, cv.plate AS matched_plate, cv.brand AS matched_brand,
                  cv.make_model AS matched_model, cv.model_year AS matched_year,
                  0::numeric(12,2) AS balance, 0::int AS vehicle_count
           FROM customers c
           JOIN customer_vehicles cv ON cv.customer_id = c.id AND cv.company_id = c.company_id
           WHERE c.company_id = $1 AND c.is_active = TRUE
             AND upper(replace(replace(cv.plate, ' ', ''), '-', '')) LIKE '%' || $2 || '%'
           ORDER BY c.id, cv.created_at
           LIMIT 20""",
        company_id, q,
    )
    return [_customer_out(r) for r in rows]


async def lookup_by_plate(company_id: str, plate: str) -> dict:
    plate = (plate or "").strip()
    if not plate:
        raise HTTPException(400, "أدخل رقم اللوحة")
    row = await fetchrow(
        """SELECT c.* FROM customers c
           JOIN customer_vehicles cv ON cv.customer_id = c.id
           WHERE cv.company_id = $1 AND cv.plate = $2 AND c.is_active = TRUE""",
        company_id, plate,
    )
    if not row:
        raise HTTPException(404, "لا يوجد عميل مسجّل بهذا الرقم")
    return _customer_out(row)


async def get_statement(company_id: str, customer_id: str) -> dict:
    customer = await fetchrow(
        """SELECT c.*, 0::numeric(12,2) AS balance,
                  COALESCE((SELECT COUNT(*) FROM customer_vehicles cv WHERE cv.customer_id = c.id),0)::int AS vehicle_count
           FROM customers c WHERE id=$1 AND company_id=$2""",
        customer_id, company_id,
    )
    if not customer:
        raise HTTPException(404, "العميل غير موجود")

    rows = await fetch(
        """SELECT cl.*, i.invoice_no
           FROM customer_ledger cl LEFT JOIN invoices i ON i.id = cl.invoice_id
           WHERE cl.company_id=$1 AND cl.customer_id=$2 ORDER BY cl.created_at""",
        company_id, customer_id,
    )
    running = Decimal("0.00")
    entries = []
    for r in rows:
        amount = accounting.dec(r["amount"])
        running += amount
        entries.append({
            "id": str(r["id"]), "entry_type": r["entry_type"],
            "invoice_id": str(r["invoice_id"]) if r["invoice_id"] else None,
            "invoice_no": r["invoice_no"], "amount": float(amount),
            "note": r["note"], "created_at": r["created_at"],
            "running_balance": float(running),
        })
    return {"customer": _customer_out(customer), "entries": entries, "balance": float(running)}


# ══════════════════ كتابة ══════════════════

async def create_customer(company_id: str, d: dict) -> dict:
    row = await fetchrow(
        """INSERT INTO customers
             (company_id, name, customer_type, phone, email, vat_number, cr_number, address,
              building_no, street, district, city, postal_code, additional_no, credit_limit,
              price_list_id, contract_discount_pct, contract_valid_from, contract_valid_until,
              contract_notes)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
           RETURNING *, 0::numeric(12,2) AS balance, 0::int AS vehicle_count""",
        company_id, d["name"], d.get("customerType", "individual"), d.get("phone"),
        d.get("email") or None, d.get("vatNumber"), d.get("crNumber"), d.get("address"),
        d.get("buildingNo"), d.get("street"), d.get("district"), d.get("city"),
        d.get("postalCode"), d.get("additionalNo"), d.get("creditLimit"), d.get("priceListId"),
        d.get("contractDiscountPct"), d.get("contractValidFrom"), d.get("contractValidUntil"),
        d.get("contractNotes"),
    )
    return _customer_out(row)


async def get_credit_status(company_id: str, customer_id: str) -> dict | None:
    """بيُستخدم من موديول الفواتير وقت البيع الآجل — None لو العميل غير موجود."""
    row = await fetchrow(
        """SELECT c.credit_limit,
                  COALESCE((SELECT SUM(cl.amount) FROM customer_ledger cl WHERE cl.customer_id=c.id),0)::numeric(12,2) AS balance
           FROM customers c WHERE c.id=$1 AND c.company_id=$2""",
        customer_id, company_id)
    if not row:
        return None
    return {"creditLimit": float(row["credit_limit"]) if row["credit_limit"] is not None else None,
            "balance": float(row["balance"])}


async def update_customer(company_id: str, customer_id: str, fields: dict) -> dict:
    keys = [k for k in fields if k in _COL_MAP]
    if not keys:
        raise HTTPException(400, "لا يوجد ما يُحدَّث")
    set_parts = [f"{_COL_MAP[k]} = ${i}" for i, k in enumerate(keys, start=3)]
    values = [fields[k] for k in keys]
    row = await fetchrow(
        f"""UPDATE customers SET {', '.join(set_parts)}, updated_at = now()
            WHERE id=$1 AND company_id=$2
            RETURNING *, 0::numeric(12,2) AS balance, 0::int AS vehicle_count""",
        customer_id, company_id, *values,
    )
    if not row:
        raise HTTPException(404, "العميل غير موجود")
    return _customer_out(row)


async def deactivate_customer(company_id: str, customer_id: str) -> None:
    row = await fetchrow(
        "UPDATE customers SET is_active=FALSE WHERE id=$1 AND company_id=$2 RETURNING id",
        customer_id, company_id,
    )
    if not row:
        raise HTTPException(404, "العميل غير موجود")


async def record_payment(company_id: str, user_id: str, customer_id: str,
                         amount: float, method: str, note: str | None) -> None:
    amount_dec = accounting.dec(amount)

    async with transaction() as conn:
        async with conn.transaction():
            customer = await conn.fetchrow(
                "SELECT name FROM customers WHERE id=$1 AND company_id=$2", customer_id, company_id
            )
            if not customer:
                raise HTTPException(404, "العميل غير موجود")

            # 1) قيد كشف الحساب (سالب = تخفيض المديونية)
            await conn.execute(
                """INSERT INTO customer_ledger (company_id, customer_id, entry_type, amount, note, created_by)
                   VALUES ($1,$2,'payment',$3,$4,$5)""",
                company_id, customer_id, -amount_dec, note or f"سداد ({method})", user_id,
            )

            # 2) القيد المحاسبي: مدين النقد/الشبكة/التحويل — دائن الذمم المدينة
            cash_acc = await accounting.get_account_id(
                conn, company_id, accounting.PAYMENT_ACCOUNT_CODES[method])
            recv_acc = await accounting.get_account_id(
                conn, company_id, accounting.ACCOUNT_CODES["RECEIVABLES"])
            await accounting.post_journal_entry(
                conn,
                company_id=company_id,
                source_type="customer_payment",
                source_id=f"{customer_id}:{int(time.time() * 1000)}",
                description=f"سداد من العميل {customer['name']}",
                user_id=user_id,
                lines=[
                    {"account_id": cash_acc, "debit": amount_dec, "description": f"تحصيل ({method})"},
                    {"account_id": recv_acc, "credit": amount_dec, "description": "تخفيض ذمة العميل"},
                ],
            )


# ══════════════════ سيارات العميل (الأسطول) ══════════════════

async def list_vehicles(company_id: str, customer_id: str) -> list[dict]:
    rows = await fetch(
        "SELECT * FROM customer_vehicles WHERE customer_id=$1 AND company_id=$2 ORDER BY created_at",
        customer_id, company_id,
    )
    out = []
    for r in rows:
        r = dict(r); r["id"] = str(r["id"]); r["customer_id"] = str(r["customer_id"])
        out.append(r)
    return out


async def add_vehicle(company_id: str, customer_id: str, d: dict) -> dict:
    # منع تكرار اللوحة بأي صيغة: حالة الأحرف/الترتيب/العربي-الإنجليزي/الأرقام الهندية/المسافات لا تصنع لوحة جديدة
    ptype = d.get("plateType", "saudi")
    key, display, valid = plate_identity(d.get("plate"), ptype)
    if ptype == "saudi" and sum(ch.isdigit() for ch in (d.get("plate") or "").translate(DIGIT_MAP)) > 4:
        valid = False        # normalize_plate يقصّ الزائد بصمت — هنا نرفضه بدل ما نسجّل لوحة غير التي كتبها المستخدم
    if not valid:
        raise HTTPException(422, "اللوحة السعودية = 3 حروف + من 1 إلى 4 أرقام" if ptype == "saudi" else "أدخل رقم لوحة صحيح")
    digits = "".join(ch for ch in key if ch.isdigit()) if ptype == "saudi" else ""
    cand = await fetch(
        """SELECT cv.plate, cv.plate_type, cv.customer_id, c.name AS customer_name
           FROM customer_vehicles cv LEFT JOIN customers c ON c.id = cv.customer_id
           WHERE cv.company_id = $1 AND ($2 = '' OR
                 regexp_replace(translate(cv.plate, '٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹', '01234567890123456789'), '\\D', '', 'g') LIKE $2 || '%'
                 OR regexp_replace(translate(cv.plate, '٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹', '01234567890123456789'), '\\D', '', 'g') = $2)""",
        company_id, digits)
    for r in cand:
        k2, _, _ = plate_identity(r["plate"], r["plate_type"] or "saudi")
        if k2 and k2 == key:
            own = str(r["customer_id"]) == str(customer_id)
            raise HTTPException(409, "هذه اللوحة مسجّلة بالفعل لهذا العميل" if own
                                else f"هذه اللوحة مسجّلة بالفعل لعميل آخر ({r['customer_name'] or '—'})")
    d = {**d, "plate": display}
    try:
        row = await fetchrow(
            """INSERT INTO customer_vehicles
                 (company_id, customer_id, plate, plate_type, brand, make_model, model_year,
                  car_category, cylinders, engine_size, color, chassis_number, notes)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *""",
            # ⚠ ملاحظة إصلاح: كان فيه d.get("fuelType") إضافي هنا قبل cylinders —
            # عمود fuel_type مش موجود أصلاً في customer_vehicles (ولا في VehicleOut)،
            # فكان عدد الـ arguments (13) أكتر من عدد الـ $n في الاستعلام (12) وكان
            # هذا الإدراج يفشل بخطأ من asyncpg في كل مرة. اتشال هنا.
            company_id, customer_id, d["plate"], d.get("plateType", "saudi"),
            d.get("brand"), d.get("makeModel"), d.get("modelYear"), d.get("carCategory"),
            d.get("cylinders"), (d.get("engineSize") or "").strip() or None,
            d.get("color"), d.get("chassisNumber"), d.get("notes"),
        )
    except asyncpg.UniqueViolationError:
        raise HTTPException(409, "رقم اللوحة ده مسجّل بالفعل لعميل آخر")
    r = dict(row); r["id"] = str(r["id"]); r["customer_id"] = str(r["customer_id"])
    return r


async def delete_vehicle(company_id: str, vehicle_id: str) -> None:
    row = await fetchrow(
        "DELETE FROM customer_vehicles WHERE id=$1 AND company_id=$2 RETURNING id",
        vehicle_id, company_id,
    )
    if not row:
        raise HTTPException(404, "السيارة غير موجودة")


# ══════════════════ نقاط الولاء ══════════════════
# برنامج مستقل عن كشف الحساب والقيود المحاسبية عمداً — نقاط اكتساب/استبدال
# فقط، بلا أي قيد يومية (محتاج حساب "مصروفات تخفيضات الولاء" في شجرة حسابات
# كل شركة أولاً، وده خارج نطاق هذه الدفعة). صفر معدّل اكتساب = البرنامج معطّل.

async def accrue_points(company_id: str, customer_id: str, total_inc: float) -> None:
    row = await fetchrow(
        "SELECT value FROM company_settings WHERE company_id=$1 AND key='loyalty.earnPerSar'",
        company_id,
    )
    rate = float(row["value"]) if row and row["value"] else 0.0
    if rate <= 0:
        return
    points = int(float(total_inc or 0) * rate)   # تقريب لأسفل دايماً — ما ينفعش نكسب العميل نقطة أكتر من حقه
    if points <= 0:
        return
    async with transaction() as conn:
        async with conn.transaction():
            updated = await conn.fetchrow(
                "UPDATE customers SET loyalty_points = loyalty_points + $1 WHERE id=$2 AND company_id=$3 RETURNING id",
                points, customer_id, company_id,
            )
            if not updated:
                return
            await conn.execute(
                """INSERT INTO loyalty_ledger (company_id, customer_id, points, kind, note)
                   VALUES ($1,$2,$3,'earn',$4)""",
                company_id, customer_id, points,
                f"اكتساب من فاتورة بإجمالي {float(total_inc or 0):.2f} ر.س",
            )


async def redeem_points(company_id: str, customer_id: str, points: int) -> dict:
    if points <= 0:
        raise HTTPException(422, "أدخل عدد نقاط صحيح أكبر من صفر")
    row = await fetchrow(
        "SELECT value FROM company_settings WHERE company_id=$1 AND key='loyalty.redeemValue'",
        company_id,
    )
    redeem_value = float(row["value"]) if row and row["value"] else 0.0
    if redeem_value <= 0:
        raise HTTPException(422, "استبدال النقاط غير مفعّل — حدد قيمة النقطة من الإعدادات أولاً")

    async with transaction() as conn:
        async with conn.transaction():
            cust = await conn.fetchrow(
                "SELECT loyalty_points FROM customers WHERE id=$1 AND company_id=$2 FOR UPDATE",
                customer_id, company_id,
            )
            if not cust:
                raise HTTPException(404, "العميل غير موجود")
            if cust["loyalty_points"] < points:
                raise HTTPException(422, f"رصيد العميل {cust['loyalty_points']} نقطة فقط")
            amount = round(points * redeem_value, 2)
            await conn.execute(
                "UPDATE customers SET loyalty_points = loyalty_points - $1 WHERE id=$2", points, customer_id,
            )
            await conn.execute(
                """INSERT INTO loyalty_ledger (company_id, customer_id, points, kind, note)
                   VALUES ($1,$2,$3,'redeem',$4)""",
                company_id, customer_id, -points, f"استبدال {points} نقطة بقيمة {amount:.2f} ر.س",
            )
            remaining = cust["loyalty_points"] - points
    return {"ok": True, "points": points, "amount": amount, "remaining": remaining}


async def list_loyalty_ledger(company_id: str, customer_id: str) -> list[dict]:
    rows = await fetch(
        """SELECT id, points, kind, note, invoice_id, created_at
           FROM loyalty_ledger WHERE company_id=$1 AND customer_id=$2
           ORDER BY created_at DESC LIMIT 100""",
        company_id, customer_id,
    )
    return [{**r, "id": str(r["id"]), "invoice_id": str(r["invoice_id"]) if r["invoice_id"] else None} for r in rows]
