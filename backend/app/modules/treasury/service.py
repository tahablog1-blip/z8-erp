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

# ── حسابات قيد الرواتب الشامل (راجع hr/service.py finalize_payroll_run) ──
GOSI_PAYABLE_ACCOUNT = ("2030", "التأمينات الاجتماعية (GOSI) مستحقة")
GOSI_EXPENSE_ACCOUNT = ("5255", "اشتراكات التأمينات الاجتماعية — حصة الشركة")
NET_SALARIES_PAYABLE_ACCOUNT = ("2040", "رواتب مستحقة الدفع")

# ── حسابات دورة الشراء الرسمية (راجع purchases/service.py — استلام مقابل أمر شراء
# ثم مطابقة فاتورة المورد): الاستلام يسجّل الالتزام هنا قبل وصول الفاتورة، والفاتورة
# تُصفّي هذا الحساب + تسجّل أي فرق سعر بين أمر الشراء والفاتورة الفعلية ──
GRIR_CLEARING_ACCOUNT = ("2050", "بضاعة مستلمة غير مفوترة (GR/IR)")
PURCHASE_VARIANCE_ACCOUNT = ("5295", "فروق أسعار الشراء")

# عمولات المبيعات المستحقة للموظفين (تُدمَج في قيد الرواتب الشامل كبند منفصل عن الأساسي)
COMMISSION_EXPENSE_ACCOUNT = ("5265", "عمولات المبيعات")


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
    for k in ("id", "company_id", "branch_id", "customer_id", "employee_id", "created_by"):
        if r.get(k): r[k] = str(r[k])
    r["amount"] = float(r["amount"])
    return r


async def list_vouchers(company_id: str, date_from: str | None, date_to: str | None,
                        vtype: str | None, include_cancelled: bool = False) -> list[dict]:
    conditions, params = ["v.company_id=$1"], [company_id]
    if date_from:
        params.append(date_from); conditions.append(f"v.voucher_date >= ${len(params)}::text::date")
    if date_to:
        params.append(date_to); conditions.append(f"v.voucher_date <= ${len(params)}::text::date")
    if vtype in ("receipt", "payment"):
        params.append(vtype); conditions.append(f"v.type = ${len(params)}")
    if not include_cancelled:
        conditions.append("v.status = 'active'")
    rows = await fetch(
        f"""SELECT v.*, c.name AS customer_name, b.name AS branch_name, e.full_name AS employee_name
            FROM treasury_vouchers v
            LEFT JOIN customers c ON c.id = v.customer_id
            LEFT JOIN hr_employees e ON e.id = v.employee_id
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
           WHERE company_id=$1 AND status='active'
             AND voucher_date = (now() AT TIME ZONE 'Asia/Riyadh')::date""", company_id)
    return {
        "receipts": float(row["receipts"]), "payments": float(row["payments"]),
        "receiptCount": row["receipt_count"], "paymentCount": row["payment_count"],
        "net": float(row["receipts"]) - float(row["payments"]),
    }


async def cancel_voucher(company_id: str, user_id: str, voucher_id: str, reason: str) -> dict:
    reason = (reason or "").strip()
    if not reason:
        raise HTTPException(422, "اكتب سبب الإلغاء")
    async with transaction() as conn:
        async with conn.transaction():
            v = await conn.fetchrow(
                "SELECT * FROM treasury_vouchers WHERE id=$1 AND company_id=$2 FOR UPDATE",
                voucher_id, company_id)
            if not v:
                raise HTTPException(404, "السند غير موجود")
            if v["status"] == "cancelled":
                raise HTTPException(409, "السند ملغي بالفعل")

            if v["party_type"] == "employee":
                if v["type"] == "payment" and v["reason"] == "advance":
                    adv = await conn.fetchrow(
                        "SELECT id FROM employee_advances WHERE voucher_id=$1 AND status='active'", v["id"])
                    if adv:
                        paid = await conn.fetchval(
                            "SELECT COALESCE(SUM(amount),0) FROM advance_repayments WHERE advance_id=$1", adv["id"])
                        if paid > 0:
                            raise HTTPException(409, "تم سداد جزء من السلفة — ألغِ سندات السداد أولاً")
                        await conn.execute("UPDATE employee_advances SET status='cancelled' WHERE id=$1", adv["id"])
                elif v["type"] == "receipt":
                    await conn.execute("DELETE FROM advance_repayments WHERE voucher_id=$1", v["id"])

            # قيد عكسي: نفس السطور بمدين ودائن مقلوبين
            entry = await conn.fetchrow(
                """SELECT id, branch_id FROM journal_entries
                   WHERE company_id=$1 AND source_type='treasury_voucher' AND source_id=$2""",
                company_id, str(v["id"]))
            if entry:
                lines = await conn.fetch(
                    "SELECT account_id, debit, credit, description FROM journal_lines WHERE entry_id=$1",
                    entry["id"])
                rev = [{"account_id": str(l["account_id"]), "debit": l["credit"], "credit": l["debit"],
                        "description": f"عكس: {l['description'] or ''}".strip()} for l in lines]
                await accounting.post_journal_entry(
                    conn, company_id=company_id,
                    source_type="treasury_voucher_cancel", source_id=str(v["id"]),
                    branch_id=str(entry["branch_id"]) if entry["branch_id"] else None,
                    description=f"إلغاء سند {v['voucher_no']} — {reason}",
                    user_id=user_id, lines=rev)

            # سند قبض من عميل: نرجّع الذمة (كان -amount فنضيف +amount)
            if v["type"] == "receipt" and v["party_type"] == "customer" and v["customer_id"]:
                await conn.execute(
                    """INSERT INTO customer_ledger (company_id, customer_id, entry_type, amount, note, created_by)
                       VALUES ($1,$2,'payment',$3,$4,$5)""",
                    company_id, v["customer_id"], v["amount"],
                    f"إلغاء سند قبض {v['voucher_no']}", user_id)

            row = await conn.fetchrow(
                """UPDATE treasury_vouchers
                   SET status='cancelled', cancelled_at=now(), cancelled_by=$3, cancel_reason=$4
                   WHERE id=$1 AND company_id=$2 RETURNING *""",
                voucher_id, company_id, user_id, reason)
    return _row(row)


async def create_voucher(company_id: str, user_id: str, d: dict) -> dict:
    amount = accounting.dec(d["amount"])
    vtype, method, party = d["type"], d["method"], d.get("partyType") or "other"
    if (party == "other" or d.get("category") == "مصروفات أخرى") and not (d.get("description") or "").strip():
        raise HTTPException(422, "اكتب البيان — إجباري للمصروفات الأخرى والجهات غير المحددة")

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

            employee_id = employee_name = advance_installment = None
            reason = d.get("reason")
            category_out = d.get("category")
            if party == "employee":
                if not d.get("employeeId"):
                    raise HTTPException(400, "اختر الموظف")
                emp = await conn.fetchrow(
                    "SELECT id, full_name, basic_salary FROM hr_employees "
                    "WHERE id=$1 AND company_id=$2 AND is_active=TRUE",
                    d["employeeId"], company_id)
                if not emp:
                    raise HTTPException(404, "الموظف غير موجود أو غير فعّال")
                employee_id, employee_name = str(emp["id"]), emp["full_name"]
                open_bal = sum((a["balance"] for a in await _advance_balances(conn, company_id, employee_id)),
                               Decimal("0"))
                if vtype == "receipt":
                    reason, category_out = "advance_repay", "سداد سلفة"
                    if amount > open_bal:
                        raise HTTPException(422, f"المبلغ أكبر من رصيد سلف الموظف ({open_bal})")
                elif reason == "advance":
                    category_out = "سلفة موظف"
                    advance_installment = accounting.dec(d.get("installment"))
                    if advance_installment <= 0:
                        raise HTTPException(422, "حدد القسط الشهري للسلفة")
                    advance_installment = min(advance_installment, amount)
                    basic = emp["basic_salary"]
                    if basic > 0 and amount > basic:
                        raise HTTPException(422, "السلفة تتجاوز الراتب الأساسي للموظف")
                    if basic > 0 and open_bal + amount > basic * 2:
                        raise HTTPException(422, "إجمالي السلف المفتوحة سيتجاوز راتبين")
                else:
                    reason, category_out = "salary", "رواتب وأجور"

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
                elif party == "employee":
                    credit_acc = await _get_or_create_account(
                        conn, company_id, ADVANCE_ACCOUNT[0], ADVANCE_ACCOUNT[1], "asset")
                    credit_desc = f"سداد سلفة من الموظف {employee_name}"
                else:
                    code, name = OTHER_INCOME
                    credit_acc = await _get_or_create_account(conn, company_id, code, name, "revenue")
                    credit_desc = d.get("category") or "إيرادات أخرى"
                lines = [
                    {"account_id": cash_acc, "debit": amount, "description": f"قبض ({method})"},
                    {"account_id": credit_acc, "credit": amount, "description": credit_desc},
                ]
            else:  # payment / مصروف
                if party == "employee" and reason == "advance":
                    debit_acc = await _get_or_create_account(
                        conn, company_id, ADVANCE_ACCOUNT[0], ADVANCE_ACCOUNT[1], "asset")
                    debit_desc = f"سلفة للموظف {employee_name}"
                elif party == "employee":
                    code, name = EXPENSE_ACCOUNTS["رواتب وأجور"]
                    debit_acc = await _get_or_create_account(conn, company_id, code, name, "expense")
                    debit_desc = f"راتب/أجر {employee_name}"
                elif party == "supplier":
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
                      party_type, customer_id, party_name, category, description, created_by, voucher_date,
                      employee_id, reason, reference_no)
                   VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,
                           COALESCE($13::text::date, (now() AT TIME ZONE 'Asia/Riyadh')::date),
                           $14,$15,$16)
                   RETURNING *""",
                company_id, d.get("branchId"), voucher_no, vtype, amount, method,
                party, d.get("customerId") if party == "customer" else None,
                d.get("partyName") or customer_name or employee_name, category_out,
                d.get("description"), user_id, d.get("voucherDate"),
                employee_id, reason, d.get("referenceNo"))

            if party == "employee":
                if vtype == "payment" and reason == "advance":
                    await conn.execute(
                        """INSERT INTO employee_advances
                             (company_id, employee_id, amount, installment, voucher_id, note, created_by)
                           VALUES ($1,$2,$3,$4,$5,$6,$7)""",
                        company_id, employee_id, amount, advance_installment,
                        row["id"], d.get("description"), user_id)
                elif vtype == "receipt":
                    await apply_repayment(conn, company_id, employee_id, amount, "voucher", voucher_id=row["id"])

            await accounting.post_journal_entry(
                conn, company_id=company_id,
                source_type="treasury_voucher", source_id=str(row["id"]),
                branch_id=d.get("branchId"),
                description=f"{'سند قبض' if vtype == 'receipt' else 'سند صرف'} {voucher_no}",
                user_id=user_id, lines=lines)

    out = _row(row)
    out["customer_name"] = customer_name
    out["employee_name"] = employee_name
    return out


# ══════════════════ السلف ══════════════════
ADVANCE_ACCOUNT = ("1050", "سلف الموظفين")


async def _advance_balances(conn, company_id: str, employee_id: str | None = None):
    """السلف النشطة اللي لسه عليها رصيد (الأقدم أولاً) — الرصيد = المبلغ − مجموع السداد"""
    rows = await conn.fetch(
        """SELECT a.id, a.employee_id, a.amount, a.installment, a.created_at,
                  a.amount - COALESCE((SELECT SUM(r.amount) FROM advance_repayments r
                                       WHERE r.advance_id = a.id), 0) AS balance
           FROM employee_advances a
           WHERE a.company_id=$1 AND a.status='active'
             AND ($2::uuid IS NULL OR a.employee_id=$2)
           ORDER BY a.created_at""", company_id, employee_id)
    return [r for r in rows if r["balance"] > 0]


async def apply_repayment(conn, company_id: str, employee_id: str, amount, source: str,
                          voucher_id=None, run_id=None, strict: bool = True) -> Decimal:
    total = Decimal(str(amount))
    left = total
    for a in await _advance_balances(conn, company_id, employee_id):
        if left <= 0:
            break
        part = min(left, a["balance"])
        await conn.execute(
            """INSERT INTO advance_repayments (advance_id, amount, source, voucher_id, payroll_run_id)
               VALUES ($1,$2,$3,$4,$5)""", a["id"], part, source, voucher_id, run_id)
        left -= part
    if left > 0 and strict:
        raise HTTPException(422, "مبلغ السداد أكبر من رصيد سلف الموظف")
    return total - left


async def payroll_advance_deductions(conn, company_id: str) -> dict[str, Decimal]:
    """القسط الشهري المستحق لكل موظف (آخر قسط ياخد الباقي بس)"""
    out: dict[str, Decimal] = {}
    for a in await _advance_balances(conn, company_id):
        k = str(a["employee_id"])
        out[k] = out.get(k, Decimal("0")) + min(a["installment"], a["balance"])
    return out


async def list_employees(company_id: str) -> list[dict]:
    rows = await fetch(
        """SELECT e.id, e.full_name, COALESCE(adv.bal, 0) AS advance_balance
           FROM hr_employees e
           LEFT JOIN (
             SELECT a.employee_id, SUM(a.amount - COALESCE(r.paid, 0)) AS bal
             FROM employee_advances a
             LEFT JOIN (SELECT advance_id, SUM(amount) AS paid FROM advance_repayments GROUP BY advance_id) r
                    ON r.advance_id = a.id
             WHERE a.company_id=$1 AND a.status='active'
             GROUP BY a.employee_id
           ) adv ON adv.employee_id = e.id
           WHERE e.company_id=$1 AND e.is_active=TRUE
           ORDER BY e.full_name""", company_id)
    return [{"id": str(r["id"]), "name": r["full_name"],
             "advanceBalance": float(r["advance_balance"])} for r in rows]


async def list_advances(company_id: str, employee_id: str | None = None) -> list[dict]:
    rows = await fetch(
        """SELECT a.id, a.employee_id, e.full_name AS employee_name, a.amount, a.installment,
                  a.status, a.created_at,
                  a.amount - COALESCE((SELECT SUM(r.amount) FROM advance_repayments r
                                       WHERE r.advance_id = a.id), 0) AS balance
           FROM employee_advances a JOIN hr_employees e ON e.id = a.employee_id
           WHERE a.company_id=$1 AND ($2::uuid IS NULL OR a.employee_id=$2)
           ORDER BY a.created_at DESC LIMIT 200""", company_id, employee_id)
    return [{"id": str(r["id"]), "employeeId": str(r["employee_id"]), "employeeName": r["employee_name"],
             "amount": float(r["amount"]), "installment": float(r["installment"]),
             "balance": float(r["balance"]), "status": r["status"], "createdAt": r["created_at"]}
            for r in rows]


# ══════════════════ الحسابات البنكية الحقيقية + الإيداع/السحب + التسوية ══════════════════
# كل حساب بنكي بياخد كود حساب مستقل في شجرة الحسابات (مش حساب التحويلات العام 1013
# المستخدم في سندات القبض/الصرف القديمة بطريقة "transfer" — ده بيفضل كما هو
# بالضبط عشان التوافق الرجعي، والحسابات البنكية الحقيقية دي ميزة إضافية فوقه)
BANK_ACCOUNT_CODE_PREFIX = "1015"


def _bank_row(r: dict) -> dict:
    r = dict(r)
    r["id"] = str(r["id"])
    if r.get("bank_account_id"):
        r["bank_account_id"] = str(r["bank_account_id"])
    for k in ("opening_balance", "balance", "amount"):
        if isinstance(r.get(k), Decimal):
            r[k] = float(r[k])
    if r.get("matched_txn_id"):
        r["matched_txn_id"] = str(r["matched_txn_id"])
    return r


async def _next_bank_account_code(conn, company_id: str) -> str:
    """كود حساب فريد لكل حساب بنكي (1015-001، 1015-002، ...) — مش رقم حساب بنكي
    حقيقي، ده مرجع شجرة الحسابات الداخلي فقط."""
    row = await conn.fetchrow(
        """INSERT INTO document_counters (company_id, doc_type, last_number) VALUES ($1,'bank_account_code',1)
           ON CONFLICT (company_id, doc_type) DO UPDATE SET last_number = document_counters.last_number + 1
           RETURNING last_number""",
        company_id)
    return f"{BANK_ACCOUNT_CODE_PREFIX}{row['last_number']:03d}"


async def list_bank_accounts(company_id: str) -> list[dict]:
    rows = await fetch(
        """SELECT ba.*,
                  ba.opening_balance
                  + COALESCE((SELECT SUM(amount) FROM bank_transactions
                               WHERE bank_account_id = ba.id AND txn_type = 'deposit'), 0)
                  - COALESCE((SELECT SUM(amount) FROM bank_transactions
                               WHERE bank_account_id = ba.id AND txn_type = 'withdrawal'), 0) AS balance
           FROM bank_accounts ba
           WHERE ba.company_id = $1 AND ba.is_active = TRUE
           ORDER BY ba.name""",
        company_id)
    return [_bank_row(r) for r in rows]


async def create_bank_account(company_id: str, d: dict) -> dict:
    async with transaction() as conn:
        async with conn.transaction():
            code = await _next_bank_account_code(conn, company_id)
            await _get_or_create_account(conn, company_id, code, f"بنك — {d['name']}", "asset")
            row = await conn.fetchrow(
                """INSERT INTO bank_accounts
                     (company_id, name, bank_name, account_number, iban, account_code, opening_balance)
                   VALUES ($1,$2,$3,$4,$5,$6,$7)
                   RETURNING *, opening_balance AS balance""",
                company_id, d["name"], d.get("bankName"), d.get("accountNumber"), d.get("iban"),
                code, accounting.dec(d.get("openingBalance", 0)))
    return _bank_row(row)


async def _get_bank_account(conn, company_id: str, bank_account_id: str) -> dict:
    row = await conn.fetchrow(
        "SELECT * FROM bank_accounts WHERE id=$1 AND company_id=$2 AND is_active=TRUE",
        bank_account_id, company_id)
    if not row:
        raise HTTPException(404, "الحساب البنكي غير موجود")
    return row


async def deactivate_bank_account(company_id: str, bank_account_id: str) -> None:
    row = await fetchrow(
        "UPDATE bank_accounts SET is_active=FALSE WHERE id=$1 AND company_id=$2 AND is_active=TRUE RETURNING id",
        bank_account_id, company_id)
    if not row:
        raise HTTPException(404, "الحساب البنكي غير موجود")


async def create_bank_txn(company_id: str, user_id: str, txn_type: str, d: dict) -> dict:
    """إيداع: الصندوق → البنك (مدين حساب البنك، دائن النقدية). سحب: عكسه بالضبط."""
    amount = accounting.dec(d["amount"])
    async with transaction() as conn:
        async with conn.transaction():
            bank = await _get_bank_account(conn, company_id, d["bankAccountId"])
            cash_acc = await accounting.get_account_id(
                conn, company_id, accounting.PAYMENT_ACCOUNT_CODES[d.get("method", "cash")])
            bank_gl_acc = await _get_or_create_account(
                conn, company_id, bank["account_code"], f"بنك — {bank['name']}", "asset")
            label = f"{'إيداع إلى' if txn_type == 'deposit' else 'سحب من'} {bank['name']}"
            if txn_type == "deposit":
                lines = [
                    {"account_id": bank_gl_acc, "debit": amount, "description": label},
                    {"account_id": cash_acc, "credit": amount, "description": f"{label} (نقدية)"},
                ]
            else:
                lines = [
                    {"account_id": cash_acc, "debit": amount, "description": label},
                    {"account_id": bank_gl_acc, "credit": amount, "description": f"{label} (نقدية)"},
                ]
            row = await conn.fetchrow(
                """INSERT INTO bank_transactions
                     (company_id, bank_account_id, txn_type, amount, description, created_by, created_at)
                   VALUES ($1,$2,$3,$4,$5,$6,
                           COALESCE($7::text::date, now())::timestamptz)
                   RETURNING *""",
                company_id, bank["id"], txn_type, amount, d.get("description"), user_id, d.get("txnDate"))
            await accounting.post_journal_entry(
                conn, company_id=company_id,
                source_type="bank_txn", source_id=str(row["id"]),
                description=f"{label} — {amount}", user_id=user_id, lines=lines)
    return _bank_row(row)


async def list_bank_txns(company_id: str, bank_account_id: str, only_unreconciled: bool = False) -> list[dict]:
    conditions = ["company_id=$1", "bank_account_id=$2"]
    if only_unreconciled:
        conditions.append("reconciled = FALSE")
    rows = await fetch(
        f"""SELECT * FROM bank_transactions WHERE {' AND '.join(conditions)}
           ORDER BY created_at DESC LIMIT 300""",
        company_id, bank_account_id)
    return [_bank_row(r) for r in rows]


# ── التسوية البنكية ──

async def add_statement_line(company_id: str, d: dict) -> dict:
    bank = await fetchrow(
        "SELECT id FROM bank_accounts WHERE id=$1 AND company_id=$2 AND is_active=TRUE",
        d["bankAccountId"], company_id)
    if not bank:
        raise HTTPException(404, "الحساب البنكي غير موجود")
    row = await fetchrow(
        """INSERT INTO bank_statement_lines (company_id, bank_account_id, stmt_date, amount, description)
           VALUES ($1,$2,$3::date,$4,$5) RETURNING *""",
        company_id, d["bankAccountId"], d["stmtDate"], accounting.dec(d["amount"]), d.get("description"))
    return _bank_row(row)


async def list_statement_lines(company_id: str, bank_account_id: str, only_unmatched: bool = False) -> list[dict]:
    conditions = ["company_id=$1", "bank_account_id=$2"]
    if only_unmatched:
        conditions.append("matched_txn_id IS NULL")
    rows = await fetch(
        f"""SELECT * FROM bank_statement_lines WHERE {' AND '.join(conditions)}
           ORDER BY stmt_date DESC, created_at DESC LIMIT 300""",
        company_id, bank_account_id)
    return [_bank_row(r) for r in rows]


async def match_statement_line(company_id: str, line_id: str, txn_id: str) -> dict:
    async with transaction() as conn:
        async with conn.transaction():
            line = await conn.fetchrow(
                "SELECT * FROM bank_statement_lines WHERE id=$1 AND company_id=$2 FOR UPDATE",
                line_id, company_id)
            if not line:
                raise HTTPException(404, "سطر الكشف غير موجود")
            txn = await conn.fetchrow(
                "SELECT * FROM bank_transactions WHERE id=$1 AND company_id=$2 AND bank_account_id=$3 FOR UPDATE",
                txn_id, company_id, line["bank_account_id"])
            if not txn:
                raise HTTPException(404, "حركة النظام غير موجودة لنفس الحساب البنكي")
            await conn.execute(
                "UPDATE bank_statement_lines SET matched_txn_id=$1 WHERE id=$2", txn_id, line_id)
            row = await conn.fetchrow(
                """UPDATE bank_transactions SET reconciled=TRUE, reconciled_at=now()
                   WHERE id=$1 RETURNING *""", txn_id)
    return _bank_row(row)


async def unmatch_statement_line(company_id: str, line_id: str) -> None:
    async with transaction() as conn:
        async with conn.transaction():
            line = await conn.fetchrow(
                "SELECT * FROM bank_statement_lines WHERE id=$1 AND company_id=$2 FOR UPDATE",
                line_id, company_id)
            if not line:
                raise HTTPException(404, "سطر الكشف غير موجود")
            if line["matched_txn_id"]:
                await conn.execute(
                    "UPDATE bank_transactions SET reconciled=FALSE, reconciled_at=NULL WHERE id=$1",
                    line["matched_txn_id"])
            await conn.execute(
                "UPDATE bank_statement_lines SET matched_txn_id=NULL WHERE id=$1", line_id)


async def reconciliation_summary(company_id: str, bank_account_id: str) -> dict:
    bank = await fetchrow(
        """SELECT *, opening_balance
                  + COALESCE((SELECT SUM(amount) FROM bank_transactions
                               WHERE bank_account_id = bank_accounts.id AND txn_type = 'deposit'), 0)
                  - COALESCE((SELECT SUM(amount) FROM bank_transactions
                               WHERE bank_account_id = bank_accounts.id AND txn_type = 'withdrawal'), 0) AS balance
           FROM bank_accounts WHERE id=$1 AND company_id=$2""",
        bank_account_id, company_id)
    if not bank:
        raise HTTPException(404, "الحساب البنكي غير موجود")
    unreconciled_count = await fetchrow(
        "SELECT COUNT(*)::int AS n FROM bank_transactions WHERE bank_account_id=$1 AND reconciled=FALSE",
        bank_account_id)
    unmatched_stmt = await fetchrow(
        """SELECT COUNT(*)::int AS n, COALESCE(SUM(amount),0)::numeric(14,2) AS total
           FROM bank_statement_lines WHERE bank_account_id=$1 AND matched_txn_id IS NULL""",
        bank_account_id)
    return {
        "bookBalance": float(bank["balance"]),
        "unreconciledSystemTxns": unreconciled_count["n"],
        "unmatchedStatementLines": unmatched_stmt["n"],
        "unmatchedStatementTotal": float(unmatched_stmt["total"]),
    }
