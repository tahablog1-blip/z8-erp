# modules/suppliers/service.py — منطق الأعمال معزول عن طبقة الـ HTTP
# الاستعلامات منقولة من suppliers.routes.js القديم بالحرف — نفس صيغة $1
import time
from decimal import Decimal

from fastapi import HTTPException

from ...core import accounting
from ...core.db import fetch, fetchrow, transaction


def _out(r: dict) -> dict:
    r = dict(r)
    r["id"] = str(r["id"])
    if isinstance(r.get("balance"), Decimal):
        r["balance"] = float(r["balance"])
    return r


_COL_MAP = {
    "name": "name", "phone": "phone", "vatNumber": "vat_number",
    "address": "address", "paymentTermsDays": "payment_terms_days",
}


async def list_suppliers(company_id: str) -> list[dict]:
    rows = await fetch(
        """SELECT s.*,
                  COALESCE((SELECT SUM(sl.amount) FROM supplier_ledger sl WHERE sl.supplier_id = s.id),0)::numeric(12,2) AS balance
           FROM suppliers s
           WHERE s.company_id = $1 AND s.is_active = TRUE
           ORDER BY s.name""",
        company_id,
    )
    return [_out(r) for r in rows]


async def create_supplier(company_id: str, d: dict) -> dict:
    row = await fetchrow(
        """INSERT INTO suppliers (company_id, name, phone, vat_number, address, payment_terms_days)
           VALUES ($1,$2,$3,$4,$5,$6) RETURNING *, 0::numeric(12,2) AS balance""",
        company_id, d["name"], d.get("phone"), d.get("vatNumber"),
        d.get("address"), d.get("paymentTermsDays", 0),
    )
    return _out(row)


async def update_supplier(company_id: str, supplier_id: str, fields: dict) -> dict:
    keys = [k for k in fields if k in _COL_MAP]
    if not keys:
        raise HTTPException(400, "لا يوجد ما يُحدَّث")
    set_parts = [f"{_COL_MAP[k]} = ${i}" for i, k in enumerate(keys, start=3)]
    values = [fields[k] for k in keys]
    row = await fetchrow(
        f"""UPDATE suppliers SET {', '.join(set_parts)}, updated_at = now()
            WHERE id=$1 AND company_id=$2
            RETURNING *, 0::numeric(12,2) AS balance""",
        supplier_id, company_id, *values,
    )
    if not row:
        raise HTTPException(404, "المورد غير موجود")
    return _out(row)


async def deactivate_supplier(company_id: str, supplier_id: str) -> None:
    row = await fetchrow(
        "UPDATE suppliers SET is_active=FALSE WHERE id=$1 AND company_id=$2 RETURNING id",
        supplier_id, company_id,
    )
    if not row:
        raise HTTPException(404, "المورد غير موجود")


async def get_statement(company_id: str, supplier_id: str) -> dict:
    supplier = await fetchrow(
        "SELECT *, 0::numeric(12,2) AS balance FROM suppliers WHERE id=$1 AND company_id=$2",
        supplier_id, company_id,
    )
    if not supplier:
        raise HTTPException(404, "المورد غير موجود")

    rows = await fetch(
        """SELECT sl.*, pi.invoice_no, pi.due_date, pi.payment_terms
           FROM supplier_ledger sl LEFT JOIN purchase_invoices pi ON pi.id = sl.invoice_id
           WHERE sl.company_id=$1 AND sl.supplier_id=$2 ORDER BY sl.created_at""",
        company_id, supplier_id,
    )
    running = Decimal("0.00")
    entries = []
    for r in rows:
        amount = accounting.dec(r["amount"])
        running += amount
        entries.append({
            "id": str(r["id"]), "entry_type": r["entry_type"],
            "invoice_id": str(r["invoice_id"]) if r["invoice_id"] else None,
            "invoice_no": r["invoice_no"], "due_date": r["due_date"], "payment_terms": r["payment_terms"],
            "amount": float(amount), "note": r["note"], "created_at": r["created_at"],
            "running_balance": float(running),
        })

    due_rows = await fetch(
        """SELECT id, invoice_no, invoice_date, due_date, total, paid_total, status
           FROM purchase_invoices
           WHERE company_id=$1 AND supplier_id=$2 AND status != 'paid' AND payment_terms='credit'
           ORDER BY due_date ASC NULLS LAST""",
        company_id, supplier_id,
    )
    due = [{**dict(r), "id": str(r["id"]), "total": float(r["total"]), "paid_total": float(r["paid_total"])} for r in due_rows]

    return {"supplier": _out(supplier), "entries": entries, "balance": float(running), "dueInvoices": due}


async def record_payment(company_id: str, user_id: str, supplier_id: str,
                         amount: float, method: str, invoice_id: str | None, note: str | None) -> None:
    amount_dec = accounting.dec(amount)

    async with transaction() as conn:
        async with conn.transaction():
            supplier = await conn.fetchrow(
                "SELECT name FROM suppliers WHERE id=$1 AND company_id=$2", supplier_id, company_id
            )
            if not supplier:
                raise HTTPException(404, "المورد غير موجود")

            await conn.execute(
                """INSERT INTO supplier_payments (company_id, supplier_id, invoice_id, method, amount, note, created_by)
                   VALUES ($1,$2,$3,$4,$5,$6,$7)""",
                company_id, supplier_id, invoice_id, method, amount_dec, note, user_id,
            )
            await conn.execute(
                """INSERT INTO supplier_ledger (company_id, supplier_id, entry_type, invoice_id, amount, note, created_by)
                   VALUES ($1,$2,'payment',$3,$4,$5,$6)""",
                company_id, supplier_id, invoice_id, -amount_dec, note or f"سداد ({method})", user_id,
            )

            # تحديث حالة الفاتورة المحددة لو السداد مرتبط بفاتورة معينة
            if invoice_id:
                inv = await conn.fetchrow(
                    "SELECT total, paid_total FROM purchase_invoices WHERE id=$1 AND company_id=$2",
                    invoice_id, company_id,
                )
                if inv:
                    new_paid = accounting.dec(inv["paid_total"]) + amount_dec
                    status = "paid" if new_paid >= accounting.dec(inv["total"]) - Decimal("0.01") else "partially_paid"
                    await conn.execute(
                        "UPDATE purchase_invoices SET paid_total=$1, status=$2 WHERE id=$3",
                        new_paid, status, invoice_id,
                    )

            # القيد المحاسبي: مدين الذمم الدائنة (تخفيض) — دائن حساب الدفع
            pay_acc = await accounting.get_account_id(conn, company_id, accounting.ACCOUNT_CODES["PAYABLES"])
            cash_acc = await accounting.get_account_id(conn, company_id, accounting.PAYMENT_ACCOUNT_CODES[method])
            await accounting.post_journal_entry(
                conn, company_id=company_id,
                source_type="supplier_payment", source_id=f"{supplier_id}:{int(time.time() * 1000)}",
                description=f"سند صرف للمورد {supplier['name']}", user_id=user_id,
                lines=[
                    {"account_id": pay_acc, "debit": amount_dec, "description": "تخفيض الذمة الدائنة"},
                    {"account_id": cash_acc, "credit": amount_dec, "description": f"صرف ({method})"},
                ],
            )
