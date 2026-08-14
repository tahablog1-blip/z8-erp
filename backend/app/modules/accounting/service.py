# modules/accounting/service.py — منطق الأعمال معزول عن طبقة الـ HTTP
# الاستعلامات منقولة من accounting.routes.js القديم بالحرف — نفس صيغة $1
from datetime import date
from decimal import Decimal

import asyncpg
from fastapi import HTTPException

from ...core.db import fetch, fetchrow


def _num(v) -> float:
    return float(v) if isinstance(v, Decimal) else (v or 0)


def _today() -> str:
    return date.today().isoformat()


# ══════════════════ شجرة الحسابات ══════════════════

async def list_accounts(company_id: str) -> list[dict]:
    rows = await fetch(
        "SELECT * FROM accounts WHERE company_id = $1 AND is_active = TRUE ORDER BY code",
        company_id,
    )
    out = []
    for r in rows:
        r = dict(r); r["id"] = str(r["id"])
        r["parent_id"] = str(r["parent_id"]) if r["parent_id"] else None
        out.append(r)
    return out


async def create_account(company_id: str, code: str, name: str, acc_type: str, parent_id: str | None) -> dict:
    try:
        row = await fetchrow(
            "INSERT INTO accounts (company_id, code, name, type, parent_id) VALUES ($1,$2,$3,$4,$5) RETURNING *",
            company_id, code, name, acc_type, parent_id,
        )
    except asyncpg.UniqueViolationError:
        raise HTTPException(409, "كود الحساب مستخدم بالفعل")
    r = dict(row); r["id"] = str(r["id"]); r["parent_id"] = str(r["parent_id"]) if r["parent_id"] else None
    return r


async def delete_account(company_id: str, account_id: str) -> None:
    row = await fetchrow(
        """UPDATE accounts SET is_active = FALSE
           WHERE id = $1 AND company_id = $2 AND is_system = FALSE RETURNING name""",
        account_id, company_id,
    )
    if not row:
        raise HTTPException(404, "الحساب غير موجود أو حساب أساسي لا يمكن حذفه")


# ══════════════════ سجل القيود ══════════════════

async def list_journal(company_id: str, date_from: str | None, date_to: str | None,
                       branch_id: str | None, source_type: str | None, limit: int) -> list[dict]:
    conditions = ["je.company_id = $1"]
    params: list = [company_id]
    if date_from:
        params.append(date_from); conditions.append(f"je.entry_date >= ${len(params)}::text::date")
    if date_to:
        params.append(date_to); conditions.append(f"je.entry_date <= ${len(params)}::text::date")
    if branch_id:
        params.append(branch_id); conditions.append(f"je.branch_id = ${len(params)}")
    if source_type:
        params.append(source_type); conditions.append(f"je.source_type = ${len(params)}")
    params.append(min(max(limit, 1), 300))

    entries = await fetch(
        f"""SELECT je.*, b.name AS branch_name
            FROM journal_entries je LEFT JOIN branches b ON b.id = je.branch_id
            WHERE {' AND '.join(conditions)}
            ORDER BY je.entry_date DESC, je.created_at DESC LIMIT ${len(params)}""",
        *params,
    )
    if not entries:
        return []

    entry_ids = [e["id"] for e in entries]
    lines = await fetch(
        """SELECT jl.*, a.code AS account_code, a.name AS account_name
           FROM journal_lines jl JOIN accounts a ON a.id = jl.account_id
           WHERE jl.entry_id = ANY($1::uuid[])""",
        entry_ids,
    )
    lines_by_entry: dict[str, list] = {}
    for l in lines:
        lines_by_entry.setdefault(str(l["entry_id"]), []).append({
            "id": str(l["id"]), "account_id": str(l["account_id"]),
            "account_code": l["account_code"], "account_name": l["account_name"],
            "debit": _num(l["debit"]), "credit": _num(l["credit"]), "description": l["description"],
        })

    out = []
    for e in entries:
        e = dict(e); e["id"] = str(e["id"])
        e["branch_id"] = str(e["branch_id"]) if e["branch_id"] else None
        e["lines"] = lines_by_entry.get(e["id"], [])
        out.append(e)
    return out


# ══════════════════ ميزان المراجعة ══════════════════

async def trial_balance(company_id: str, as_of: str | None) -> dict:
    as_of = as_of or _today()
    rows = await fetch(
        """SELECT a.code, a.name, a.type,
                  COALESCE(SUM(sub.debit),0)::numeric(12,2) AS total_debit,
                  COALESCE(SUM(sub.credit),0)::numeric(12,2) AS total_credit
           FROM accounts a
           LEFT JOIN (
             SELECT jl.account_id, jl.debit, jl.credit
             FROM journal_lines jl JOIN journal_entries je ON je.id = jl.entry_id
             WHERE je.company_id = $1 AND je.entry_date <= $2::text::date
           ) sub ON sub.account_id = a.id
           WHERE a.company_id = $1 AND a.is_active = TRUE
           GROUP BY a.id, a.code, a.name, a.type
           ORDER BY a.code""",
        company_id, as_of,
    )
    out_rows = []
    total_debit = Decimal("0.00")
    total_credit = Decimal("0.00")
    for r in rows:
        td, tc = _num(r["total_debit"]), _num(r["total_credit"])
        balance = (td - tc) if r["type"] in ("asset", "expense") else (tc - td)
        out_rows.append({"code": r["code"], "name": r["name"], "type": r["type"],
                         "total_debit": td, "total_credit": tc, "balance": balance})
        total_debit += Decimal(str(td)); total_credit += Decimal(str(tc))
    return {
        "asOf": as_of, "rows": out_rows,
        "totalDebit": float(total_debit), "totalCredit": float(total_credit),
        "balanced": abs(total_debit - total_credit) < Decimal("0.01"),
    }


# ══════════════════ قائمة الدخل ══════════════════

async def income_statement(company_id: str, date_from: str | None, date_to: str | None,
                           branch_id: str | None) -> dict:
    today = _today()
    date_from = date_from or (today[:8] + "01")
    date_to = date_to or today

    rows = await fetch(
        """SELECT a.code, a.name, a.type,
                  COALESCE(SUM(sub.debit),0)::numeric(12,2) AS total_debit,
                  COALESCE(SUM(sub.credit),0)::numeric(12,2) AS total_credit
           FROM accounts a
           LEFT JOIN (
             SELECT jl.account_id, jl.debit, jl.credit
             FROM journal_lines jl JOIN journal_entries je ON je.id = jl.entry_id
             WHERE je.company_id = $1 AND je.entry_date BETWEEN $2::text::date AND $3::text::date
               AND ($4::uuid IS NULL OR je.branch_id = $4)
           ) sub ON sub.account_id = a.id
           WHERE a.company_id = $1 AND a.is_active = TRUE AND a.type IN ('revenue','expense')
           GROUP BY a.id, a.code, a.name, a.type
           ORDER BY a.code""",
        company_id, date_from, date_to, branch_id,
    )
    revenue = [{"code": r["code"], "name": r["name"], "type": r["type"],
               "amount": _num(r["total_credit"]) - _num(r["total_debit"])}
              for r in rows if r["type"] == "revenue"]
    expense = [{"code": r["code"], "name": r["name"], "type": r["type"],
               "amount": _num(r["total_debit"]) - _num(r["total_credit"])}
              for r in rows if r["type"] == "expense"]
    total_revenue = sum(r["amount"] for r in revenue)
    total_expense = sum(r["amount"] for r in expense)
    return {
        "from": date_from, "to": date_to, "branchId": branch_id,
        "revenue": revenue, "expense": expense,
        "totalRevenue": total_revenue, "totalExpense": total_expense,
        "netIncome": total_revenue - total_expense,
    }


# ══════════════════ الميزانية العمومية ══════════════════

async def balance_sheet(company_id: str, as_of: str | None) -> dict:
    as_of = as_of or _today()
    rows = await fetch(
        """SELECT a.code, a.name, a.type,
                  COALESCE(SUM(sub.debit),0)::numeric(12,2) AS total_debit,
                  COALESCE(SUM(sub.credit),0)::numeric(12,2) AS total_credit
           FROM accounts a
           LEFT JOIN (
             SELECT jl.account_id, jl.debit, jl.credit
             FROM journal_lines jl JOIN journal_entries je ON je.id = jl.entry_id
             WHERE je.company_id = $1 AND je.entry_date <= $2::text::date
           ) sub ON sub.account_id = a.id
           WHERE a.company_id = $1 AND a.is_active = TRUE
           GROUP BY a.id, a.code, a.name, a.type
           ORDER BY a.code""",
        company_id, as_of,
    )

    def with_balance(rows_subset):
        out = []
        for r in rows_subset:
            td, tc = _num(r["total_debit"]), _num(r["total_credit"])
            balance = (td - tc) if r["type"] in ("asset", "expense") else (tc - td)
            out.append({"code": r["code"], "name": r["name"], "type": r["type"], "balance": balance})
        return out

    assets = with_balance([r for r in rows if r["type"] == "asset"])
    liabilities = with_balance([r for r in rows if r["type"] == "liability"])
    equity = with_balance([r for r in rows if r["type"] == "equity"])
    revenue = with_balance([r for r in rows if r["type"] == "revenue"])
    expense = with_balance([r for r in rows if r["type"] == "expense"])

    total_assets = sum(r["balance"] for r in assets)
    total_liabilities = sum(r["balance"] for r in liabilities)
    total_equity_base = sum(r["balance"] for r in equity)
    # صافي أرباح كل الفترات حتى الآن (لسه مفيش قيد إقفال رسمي) — بيتضاف لحقوق الملكية عشان الميزانية تتزن
    net_income_to_date = sum(r["balance"] for r in revenue) - sum(r["balance"] for r in expense)
    total_equity = total_equity_base + net_income_to_date

    return {
        "asOf": as_of, "assets": assets, "liabilities": liabilities, "equity": equity,
        "totalAssets": total_assets, "totalLiabilities": total_liabilities,
        "totalEquity": total_equity, "currentEarnings": net_income_to_date,
        "balanced": abs(total_assets - (total_liabilities + total_equity)) < 0.01,
    }
