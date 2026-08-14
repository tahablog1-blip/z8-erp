# modules/treasury/service.py — منطق الخزينة + القيود المحاسبية التلقائية
# سند القبض:  مدين النقد/الشبكة/التحويل — دائن (ذمم العميل | إيرادات أخرى)
# سند الصرف: مدين (حساب المصروف | ذمم الموردين) — دائن النقد/الشبكة/التحويل
import time
from decimal import Decimal

from fastapi import HTTPException

from ...core import accounting
from ...core.db import fetch, fetchrow, transaction

# بنود المصروفات المعتمدة — لكل بند حساب ثابت في شجرة الحسابات (يُنشأ تلقائياً عند أول استخدام)
EXPENSE_ACCOUNTS: dict[str, tuple[str, str]] = {
    "إيجار":            ("5210", "مصروفات الإيجار"),
    "كهرباء ومياه":     ("5220", "مصروفات الكهرباء والمياه"),
    "اتصالات وإنترنت":  ("5230", "مصروفات الاتصالات"),
    "صيانة":            ("5240", "مصروفات الصيانة"),
    "رواتب وأجور":      ("5250", "مصروفات الرواتب والأجور"),
    "تسويق وإعلان":     ("5260", "مصروفات التسويق"),
    "رسوم حكومية":      ("5270", "رسوم حكومية"),
    "نظافة وضيافة":     ("5280", "مصروفات النظافة والضيافة"),
    "مصروفات أخرى":     ("5290", "مصروفات أخرى"),
}
OTHER_INCOME = ("4020", "إيرادات أخرى")


async def _get_or_create_account(conn, company_id: str, code: str, name: str, acc_type: str) -> str:
    row = await conn.fetchrow(
        "SELECT id FROM accounts WHERE company_id=$1 AND code=$2", company_id, code)
    if row:
        return str(row["id"])
    row = await conn.fetchrow(
        "INSERT INTO accounts (company_id, code, name, type) VALUES ($1,$2,$3,$4) RETURNING id",
        company_id, code, name, acc_type)
    return str(row["id"])


async def _next_no(conn, company_id: str) -> str:
    row = await conn.fetchrow(
        """SELECT voucher_no FROM treasury_vouchers
           WHERE company_id=$1 ORDER BY created_at DESC LIMIT 1 FOR UPDATE""", company_id)
    n = 0
    if row and row["voucher_no"].startswith("TRV-"):
        try: n = int(row["voucher_no"].split("-")[1])
        except ValueError: n = 0
    return f"TRV-{n + 1:06d}"


def _row(r: dict) -> dict:
    r = dict(r)
    for k in ("id", "company_id", "branch_id", "customer_id", "created_by"):
        if r.get(k): r[k] = str(r[k])
    r["amount"] = float(r["amount"])
    return r


async def list_vouchers(company_id: str, date_from: str | None, date_to: str | None,
                        vtype: str | None) -> list[dict]:
    conditions, params = ["v.company_id=$1"], [company_id]
    if date_from:
        params.append(date_from); conditions.append(f"v.created_at >= ${len(params)}::text::timestamptz")
    if date_to:
        params.append(f"{date_to} 23:59:59"); conditions.append(f"v.created_at <= ${len(params)}::text::timestamptz")
    if vtype in ("receipt", "payment"):
        params.append(vtype); conditions.append(f"v.type = ${len(params)}")
    rows = await fetch(
        f"""SELECT v.*, c.name AS customer_name, b.name AS branch_name
            FROM treasury_vouchers v
            LEFT JOIN customers c ON c.id = v.customer_id
            LEFT JOIN branches b ON b.id = v.branch_id
            WHERE {' AND '.join(conditions)}
            ORDER BY v.created_at DESC LIMIT 200""", *params)
    return [_row(r) for r in rows]


async def today_summary(company_id: str) -> dict:
    row = await fetchrow(
        """SELECT
             COALESCE(SUM(amount) FILTER (WHERE type='receipt'),0) AS receipts,
             COALESCE(SUM(amount) FILTER (WHERE type='payment'),0) AS payments,
             COUNT(*) FILTER (WHERE type='receipt') AS receipt_count,
             COUNT(*) FILTER (WHERE type='payment') AS payment_count
           FROM treasury_vouchers
           WHERE company_id=$1 AND created_at::date = CURRENT_DATE""", company_id)
    return {
        "receipts": float(row["receipts"]), "payments": float(row["payments"]),
        "receiptCount": row["receipt_count"], "paymentCount": row["payment_count"],
        "net": float(row["receipts"]) - float(row["payments"]),
    }


async def create_voucher(company_id: str, user_id: str, d: dict) -> dict:
    amount = accounting.dec(d["amount"])
    vtype, method, party = d["type"], d["method"], d.get("partyType") or "other"

    async with transaction() as conn:
        async with conn.transaction():
            voucher_no = await _next_no(conn, company_id)

            customer_name = None
            if party == "customer":
                if not d.get("customerId"):
                    raise HTTPException(400, "اختر العميل لسند القبض من عميل")
                cust = await conn.fetchrow(
                    "SELECT name FROM customers WHERE id=$1 AND company_id=$2",
                    d["customerId"], company_id)
                if not cust:
                    raise HTTPException(404, "العميل غير موجود")
                customer_name = cust["name"]

            # ── حساب النقدية حسب طريقة الدفع ──
            cash_acc = await accounting.get_account_id(
                conn, company_id, accounting.PAYMENT_ACCOUNT_CODES[method])

            lines: list[dict] = []
            if vtype == "receipt":
                if party == "customer":
                    # تحصيل مديونية: يخفض ذمة العميل + قيد كشف حسابه
                    await conn.execute(
                        """INSERT INTO customer_ledger (company_id, customer_id, entry_type, amount, note, created_by)
                           VALUES ($1,$2,'payment',$3,$4,$5)""",
                        company_id, d["customerId"], -amount,
                        d.get("description") or f"سند قبض {voucher_no}", user_id)
                    credit_acc = await accounting.get_account_id(
                        conn, company_id, accounting.ACCOUNT_CODES["RECEIVABLES"])
                    credit_desc = f"تحصيل من العميل {customer_name}"
                else:
                    code, name = OTHER_INCOME
                    credit_acc = await _get_or_create_account(conn, company_id, code, name, "revenue")
                    credit_desc = d.get("category") or "إيرادات أخرى"
                lines = [
                    {"account_id": cash_acc, "debit": amount, "description": f"قبض ({method})"},
                    {"account_id": credit_acc, "credit": amount, "description": credit_desc},
                ]
            else:  # payment / مصروف
                if party == "supplier":
                    debit_acc = await accounting.get_account_id(
                        conn, company_id, accounting.ACCOUNT_CODES["PAYABLES"])
                    debit_desc = f"سداد للمورد {d.get('partyName') or ''}".strip()
                else:
                    cat = d.get("category") or "مصروفات أخرى"
                    code, name = EXPENSE_ACCOUNTS.get(cat, EXPENSE_ACCOUNTS["مصروفات أخرى"])
                    debit_acc = await _get_or_create_account(conn, company_id, code, name, "expense")
                    debit_desc = cat
                lines = [
                    {"account_id": debit_acc, "debit": amount, "description": debit_desc},
                    {"account_id": cash_acc, "credit": amount, "description": f"صرف ({method})"},
                ]

            row = await conn.fetchrow(
                """INSERT INTO treasury_vouchers
                     (company_id, branch_id, voucher_no, type, amount, method,
                      party_type, customer_id, party_name, category, description, created_by)
                   VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
                   RETURNING *""",
                company_id, d.get("branchId"), voucher_no, vtype, amount, method,
                party, d.get("customerId") if party == "customer" else None,
                d.get("partyName") or customer_name, d.get("category"),
                d.get("description"), user_id)

            await accounting.post_journal_entry(
                conn, company_id=company_id,
                source_type="treasury_voucher", source_id=str(row["id"]),
                branch_id=d.get("branchId"),
                description=f"{'سند قبض' if vtype == 'receipt' else 'سند صرف'} {voucher_no}",
                user_id=user_id, lines=lines)

    out = _row(row)
    out["customer_name"] = customer_name
    return out
