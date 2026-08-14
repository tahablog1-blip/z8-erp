# modules/customers/service.py — منطق الأعمال معزول عن طبقة الـ HTTP
# الاستعلامات منقولة من customers.routes.js القديم بالحرف — نفس صيغة $1
import re
import time
from decimal import Decimal

import asyncpg
from fastapi import HTTPException

from ...core import accounting
from ...core.db import fetch, fetchrow, transaction

# منظّف مدخل رقم اللوحة: حروف/أرقام عربي أو إنجليزي فقط — يمنع أي محارف
# LIKE خاصة زي % و _ من التسبب في مطابقات غريبة
_PLATE_CLEAN = re.compile(r"[^0-9A-Za-z\u0621-\u064A]")


def _clean_plate(s: str) -> str:
    return _PLATE_CLEAN.sub("", (s or "").upper())


def _customer_out(r: dict) -> dict:
    r = dict(r)
    r["id"] = str(r["id"])
    for k in ("balance",):
        if isinstance(r.get(k), Decimal):
            r[k] = float(r[k])
    return r


_COL_MAP = {
    "name": "name", "customerType": "customer_type", "phone": "phone", "email": "email",
    "vatNumber": "vat_number", "crNumber": "cr_number", "address": "address",
    "buildingNo": "building_no", "street": "street", "district": "district",
    "city": "city", "postalCode": "postal_code", "additionalNo": "additional_no",
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
              building_no, street, district, city, postal_code, additional_no)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
           RETURNING *, 0::numeric(12,2) AS balance, 0::int AS vehicle_count""",
        company_id, d["name"], d.get("customerType", "individual"), d.get("phone"),
        d.get("email") or None, d.get("vatNumber"), d.get("crNumber"), d.get("address"),
        d.get("buildingNo"), d.get("street"), d.get("district"), d.get("city"),
        d.get("postalCode"), d.get("additionalNo"),
    )
    return _customer_out(row)


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
    try:
        row = await fetchrow(
            """INSERT INTO customer_vehicles
                 (company_id, customer_id, plate, plate_type, brand, make_model, model_year,
                  car_category, cylinders, color, chassis_number, notes)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *""",
            company_id, customer_id, d["plate"], d.get("plateType", "saudi"),
            d.get("brand"), d.get("makeModel"), d.get("modelYear"), d.get("carCategory"),
            d.get("cylinders"), d.get("color"), d.get("chassisNumber"), d.get("notes"),
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
