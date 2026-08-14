# modules/purchases/service.py — منطق الأعمال معزول عن طبقة الـ HTTP
# منقول من فرع "الشراء المباشر بدون أمر شراء" في purchases.routes.js
import time
from decimal import Decimal

from fastapi import HTTPException

from ...core import accounting
from ...core.db import fetch, fetchrow, transaction

WAREHOUSE_LOC_ID = "main"
_B36 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ"


def _base36(n: int) -> str:
    s = ""
    while n:
        n, r = divmod(n, 36)
        s = _B36[r] + s
    return s or "0"


def _num(v) -> float:
    return float(v) if isinstance(v, Decimal) else (v or 0)


def _out(r: dict) -> dict:
    r = dict(r)
    r["id"] = str(r["id"]); r["supplier_id"] = str(r["supplier_id"])
    for k in ("subtotal", "vat_total", "total", "paid_total"):
        r[k] = _num(r.get(k))
    return r


async def _next_doc_no(conn, company_id: str, doc_type: str, prefix: str) -> str:
    """رقم مستند متسلسل ذرياً — نفس منطق nextDocNo في numbering.service.js"""
    row = await conn.fetchrow(
        """INSERT INTO document_counters (company_id, doc_type, last_number) VALUES ($1,$2,1)
           ON CONFLICT (company_id, doc_type) DO UPDATE SET last_number = document_counters.last_number + 1
           RETURNING last_number""",
        company_id, doc_type,
    )
    return f"{prefix}-{row['last_number']:06d}"


async def create_purchase_invoice(company_id: str, user_id: str, d: dict) -> dict:
    async with transaction() as conn:
        async with conn.transaction():
            for it in d["items"]:
                await conn.execute(
                    "UPDATE products SET cost_price=$1 WHERE id=$2 AND company_id=$3",
                    accounting.dec(it["unitCost"]), it["productId"], company_id,
                )

            subtotal = sum(accounting.dec(it["unitCost"]) * it["qty"] for it in d["items"])
            company = await conn.fetchrow("SELECT vat_percent FROM companies WHERE id=$1", company_id)
            vat_percent = accounting.dec((company and company["vat_percent"]) or 15)
            vat_total = (subtotal * vat_percent / 100).quantize(Decimal("0.01"))
            total = subtotal + vat_total
            is_cash = d["paymentTerms"] == "cash"

            invoice_no = await _next_doc_no(conn, company_id, "purchase_invoice", "PINV")

            invoice = await conn.fetchrow(
                """INSERT INTO purchase_invoices
                     (company_id, supplier_id, invoice_no, supplier_invoice_ref, invoice_date,
                      payment_terms, due_date, subtotal, vat_total, total, paid_total, status, created_by)
                   VALUES ($1,$2,$3,$4,COALESCE($5::text::date,CURRENT_DATE),$6,$7::text::date,$8,$9,$10,$11,$12,$13)
                   RETURNING *""",
                company_id, d["supplierId"], invoice_no, d.get("supplierInvoiceRef"), d.get("invoiceDate"),
                d["paymentTerms"], d.get("dueDate"), subtotal, vat_total, total,
                total if is_cash else Decimal("0.00"), "paid" if is_cash else "unpaid", user_id,
            )

            for it in d["items"]:
                line_total = accounting.dec(it["unitCost"]) * it["qty"]
                await conn.execute(
                    """INSERT INTO purchase_invoice_items
                         (invoice_id, product_id, product_label, qty, unit_cost, line_total)
                       VALUES ($1,$2,$3,$4,$5,$6)""",
                    invoice["id"], it["productId"], it["productLabel"], it["qty"],
                    accounting.dec(it["unitCost"]), line_total,
                )

            # شراء مباشر: يزوّد مخزون المستودع فوراً، ويربط الحركة بمعرّف الفاتورة
            move_no = f"R-{_base36(int(time.time() * 1000))}"
            supplier = await conn.fetchrow("SELECT name FROM suppliers WHERE id=$1", d["supplierId"])
            for it in d["items"]:
                await conn.execute(
                    """INSERT INTO inventory (company_id, loc_type, loc_id, product_id, qty)
                       VALUES ($1,'warehouse',$2,$3,$4)
                       ON CONFLICT (loc_type, loc_id, product_id)
                       DO UPDATE SET qty = inventory.qty + EXCLUDED.qty, updated_at = now()""",
                    company_id, WAREHOUSE_LOC_ID, it["productId"], it["qty"],
                )
                await conn.execute(
                    """INSERT INTO stock_moves
                         (company_id, move_type, from_loc_type, from_loc_id, to_loc_type, to_loc_id,
                          product_id, product_label, qty, move_no, supplier_name, created_by,
                          unit_cost, purchase_invoice_id)
                       VALUES ($1,'receive',NULL,NULL,'warehouse',$2,$3,$4,$5,$6,$7,$8,$9,$10)""",
                    company_id, WAREHOUSE_LOC_ID, it["productId"], it["productLabel"], it["qty"],
                    move_no, (supplier and supplier["name"]), user_id,
                    accounting.dec(it["unitCost"]), invoice["id"],
                )

            # القيد المحاسبي: مدين المخزون + مدين ضريبة المدخلات — دائن (نقد أو الذمم الدائنة)
            inv_acc = await accounting.get_account_id(conn, company_id, accounting.ACCOUNT_CODES["INVENTORY"])
            vat_acc = await accounting.get_account_id(conn, company_id, accounting.ACCOUNT_CODES["INPUT_VAT"])
            credit_acc = await accounting.get_account_id(
                conn, company_id,
                accounting.PAYMENT_ACCOUNT_CODES[d["paymentMethod"]] if is_cash
                else accounting.ACCOUNT_CODES["PAYABLES"],
            )
            ref_note = f" (مرجع المورد: {d['supplierInvoiceRef']})" if d.get("supplierInvoiceRef") else ""
            await accounting.post_journal_entry(
                conn, company_id=company_id,
                source_type="purchase_invoice", source_id=invoice["id"],
                description=f"فاتورة مشتريات {invoice_no}{ref_note}", user_id=user_id,
                lines=[
                    {"account_id": inv_acc, "debit": subtotal, "description": "زيادة قيمة المخزون"},
                    {"account_id": vat_acc, "debit": vat_total, "description": "ضريبة مدخلات قابلة للخصم"},
                    {"account_id": credit_acc, "credit": total,
                     "description": f"دفع فوري ({d['paymentMethod']})" if is_cash else "مستحق للمورد"},
                ],
            )

            if not is_cash:
                await conn.execute(
                    """INSERT INTO supplier_ledger (company_id, supplier_id, entry_type, invoice_id, amount, note, created_by)
                       VALUES ($1,$2,'invoice',$3,$4,$5,$6)""",
                    company_id, d["supplierId"], invoice["id"], total, f"فاتورة مشتريات {invoice_no}", user_id,
                )

    return _out(invoice)


async def list_purchase_invoices(company_id: str, supplier_id: str | None, status: str | None) -> list[dict]:
    conditions = ["pi.company_id = $1"]
    params: list = [company_id]
    if supplier_id:
        params.append(supplier_id); conditions.append(f"pi.supplier_id = ${len(params)}")
    if status:
        params.append(status); conditions.append(f"pi.status = ${len(params)}")
    rows = await fetch(
        f"""SELECT pi.*, s.name AS supplier_name
            FROM purchase_invoices pi JOIN suppliers s ON s.id = pi.supplier_id
            WHERE {' AND '.join(conditions)}
            ORDER BY pi.invoice_date DESC, pi.created_at DESC""",
        *params,
    )
    return [_out(r) for r in rows]


async def get_purchase_invoice(company_id: str, invoice_id: str) -> dict:
    invoice = await fetchrow(
        """SELECT pi.*, s.name AS supplier_name FROM purchase_invoices pi
           JOIN suppliers s ON s.id=pi.supplier_id WHERE pi.id=$1 AND pi.company_id=$2""",
        invoice_id, company_id,
    )
    if not invoice:
        raise HTTPException(404, "الفاتورة غير موجودة")
    items = await fetch("SELECT * FROM purchase_invoice_items WHERE invoice_id=$1", invoice_id)
    out = _out(invoice)
    out["items"] = [{
        "id": str(it["id"]), "product_id": str(it["product_id"]) if it["product_id"] else None,
        "product_label": it["product_label"], "qty": it["qty"],
        "unit_cost": _num(it["unit_cost"]), "line_total": _num(it["line_total"]),
    } for it in items]
    return out
