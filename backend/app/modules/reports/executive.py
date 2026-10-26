# modules/reports/executive.py — لوحة القيادة التنفيذية: ملخص واحد بفترة وفرع وصلاحيات
#
# مبادئ:
#   - مفيش قاعدة محاسبية جديدة: الأرباح والمصروفات والنقدية من القيود (journal) زي التقارير المحاسبية،
#     والمؤشرات التشغيلية (عدد الفواتير، طرق الدفع، الخصومات...) من جدول الفواتير زي لوحة القيادة القديمة،
#     والأعمار والمخزون بإعادة استخدام دوال التقارير الموجودة (ar_aging / inventory_valuation / low_stock_alerts).
#   - كل قسم مقيّد بصلاحيته على السيرفر (الواجهة بتعرض بس اللي يرجع)، وفشل قسم واحد ما بيوقعش الباقي.
#   - مقارنة بالفترة السابقة المساوية في الطول مباشرة قبل الفترة الحالية.
import asyncio
import datetime as dt

from ...core.db import fetch, fetchrow

CASH_PREFIX = "101"           # 1011 صندوق · 1012 شبكة · 1013 تحويلات · 1015-xxx حسابات بنكية
COGS_CODE = "5010"
SALES_PERMS = ("reports.sales", "reports.view", "accounting.view_reports", "invoices.view_all")
FINANCE_PERMS = ("accounting.view_reports",)
INVENTORY_PERMS = ("products.view_stock", "accounting.view_reports")
BRANCH_PERMS = ("reports.view", "accounting.view_reports")
OPS_PERMS = ("cars.view", "cars.create", "invoices.prepare", "reports.view", "invoices.view_all", "invoices.view_today")


def f2(v) -> float:
    return round(float(v or 0), 2)


def _date(s: str | None) -> dt.date | None:
    try:
        return dt.date.fromisoformat(s) if s else None
    except ValueError:
        return None


def _branch_cond(col: str, branch_id: str | None, params: list) -> str:
    if not branch_id:
        return ""
    params.append(branch_id)
    return f" AND {col} = ${len(params)}::uuid"


# ───────────────────────────── المبيعات التشغيلية (من الفواتير) ─────────────────────────────

async def _sales(cid: str, f: dt.date, t: dt.date, branch: str | None) -> dict:
    params: list = [cid, f, t]
    bc = _branch_cond("i.branch_id", branch, params)
    day = "(i.issued_at AT TIME ZONE 'Asia/Riyadh')::date"
    base = f"i.company_id = $1 AND {day} BETWEEN $2 AND $3{bc}"
    tot, methods, daily = await asyncio.gather(
        fetchrow(
            f"""SELECT
                  COUNT(*) FILTER (WHERE NOT i.is_returned)::int AS cnt,
                  COALESCE(SUM(i.total_inc) FILTER (WHERE NOT i.is_returned),0) AS total_inc,
                  COALESCE(SUM(i.total_ex)  FILTER (WHERE NOT i.is_returned),0) AS total_ex,
                  COALESCE(SUM(i.total_vat) FILTER (WHERE NOT i.is_returned),0) AS vat,
                  COALESCE(SUM(i.discount_total) FILTER (WHERE NOT i.is_returned),0) AS discounts,
                  COALESCE(SUM(i.credit_total) FILTER (WHERE NOT i.is_returned),0) AS credit,
                  COALESCE(SUM(i.total_ex - COALESCE(i.cogs_total,0)) FILTER (WHERE NOT i.is_returned),0) AS gross_profit,
                  COUNT(*) FILTER (WHERE i.is_returned)::int AS refund_cnt,
                  COALESCE(SUM(i.total_inc) FILTER (WHERE i.is_returned),0) AS refunds
                FROM invoices i WHERE {base}""", *params),
        fetch(
            f"""SELECT ip.method, COALESCE(SUM(ip.amount),0) AS total
                FROM invoice_payments ip JOIN invoices i ON i.id = ip.invoice_id
                WHERE {base} AND NOT i.is_returned GROUP BY ip.method""", *params),
        fetch(
            f"""SELECT {day} AS d, COUNT(*)::int AS cnt,
                       COALESCE(SUM(i.total_inc),0) AS total_inc,
                       COALESCE(SUM(i.total_ex - COALESCE(i.cogs_total,0)),0) AS gross_profit
                FROM invoices i WHERE {base} AND NOT i.is_returned
                GROUP BY 1 ORDER BY 1""", *params),
    )
    cnt = tot["cnt"]
    return {
        "invoiceCount": cnt, "totalInc": f2(tot["total_inc"]), "totalEx": f2(tot["total_ex"]),
        "vat": f2(tot["vat"]), "discounts": f2(tot["discounts"]), "credit": f2(tot["credit"]),
        "grossProfit": f2(tot["gross_profit"]),
        "avgInvoice": f2(tot["total_inc"] / cnt) if cnt else 0,
        "refundCount": tot["refund_cnt"], "refunds": f2(tot["refunds"]),
        "methods": [{"method": r["method"], "total": f2(r["total"])} for r in methods],
        "daily": [{"date": r["d"].isoformat(), "count": r["cnt"], "total": f2(r["total_inc"]),
                   "profit": f2(r["gross_profit"])} for r in daily],
    }


# ───────────────────────────── القيود: الإيرادات والتكلفة والمصروفات والنقدية ─────────────────────────────

async def _journal(cid: str, f: dt.date, t: dt.date, branch: str | None) -> dict:
    params: list = [cid, f, t]
    bc = _branch_cond("je.branch_id", branch, params)
    rows = await fetch(
        f"""SELECT je.entry_date AS d, a.code, a.name, a.type,
                   COALESCE(SUM(jl.credit - jl.debit),0) AS net
            FROM journal_lines jl
            JOIN journal_entries je ON je.id = jl.entry_id
            JOIN accounts a ON a.id = jl.account_id
            WHERE je.company_id = $1 AND je.entry_date BETWEEN $2 AND $3
              AND a.type IN ('revenue','expense'){bc}
            GROUP BY je.entry_date, a.code, a.name, a.type""", *params)
    revenue = cogs = opex = 0.0
    daily: dict[str, dict] = {}
    expense_by_acc: dict[str, dict] = {}
    for r in rows:
        net = float(r["net"]); key = r["d"].isoformat()
        d = daily.setdefault(key, {"date": key, "revenue": 0.0, "cogs": 0.0, "opex": 0.0})
        if r["type"] == "revenue":
            revenue += net; d["revenue"] += net
        elif r["code"] == COGS_CODE:
            cogs += -net; d["cogs"] += -net
        else:
            opex += -net; d["opex"] += -net
            e = expense_by_acc.setdefault(r["code"], {"code": r["code"], "name": r["name"], "amount": 0.0})
            e["amount"] += -net
    gross = revenue - cogs
    return {
        "revenue": f2(revenue), "cogs": f2(cogs), "grossProfit": f2(gross),
        "opex": f2(opex), "netProfit": f2(gross - opex),
        "expenses": sorted(({**e, "amount": f2(e["amount"])} for e in expense_by_acc.values()),
                           key=lambda e: -e["amount"]),
        "daily": [{**d, "revenue": f2(d["revenue"]), "cogs": f2(d["cogs"]), "opex": f2(d["opex"])}
                  for _, d in sorted(daily.items())],
    }


async def _cash(cid: str, f: dt.date, t: dt.date, branch: str | None) -> dict:
    params_b: list = [cid, t]
    bcb = _branch_cond("je.branch_id", branch, params_b)
    params_f: list = [cid, f, t]
    bcf = _branch_cond("je.branch_id", branch, params_f)
    bal, flow = await asyncio.gather(
        fetch(
            f"""SELECT a.code, a.name, COALESCE(SUM(jl.debit - jl.credit),0) AS bal
                FROM journal_lines jl JOIN journal_entries je ON je.id = jl.entry_id
                JOIN accounts a ON a.id = jl.account_id
                WHERE je.company_id = $1 AND je.entry_date <= $2 AND a.code LIKE '{CASH_PREFIX}%'{bcb}
                GROUP BY a.code, a.name ORDER BY a.code""", *params_b),
        fetch(
            f"""SELECT je.entry_date AS d, COALESCE(SUM(jl.debit),0) AS cash_in, COALESCE(SUM(jl.credit),0) AS cash_out
                FROM journal_lines jl JOIN journal_entries je ON je.id = jl.entry_id
                JOIN accounts a ON a.id = jl.account_id
                WHERE je.company_id = $1 AND je.entry_date BETWEEN $2 AND $3
                  AND a.code LIKE '{CASH_PREFIX}%'{bcf}
                GROUP BY je.entry_date ORDER BY je.entry_date""", *params_f))
    accounts = [{"code": r["code"], "name": r["name"], "balance": f2(r["bal"])} for r in bal]
    cash_in = sum(float(r["cash_in"]) for r in flow); cash_out = sum(float(r["cash_out"]) for r in flow)
    return {
        "balance": f2(sum(a["balance"] for a in accounts)), "accounts": accounts,
        "cashIn": f2(cash_in), "cashOut": f2(cash_out), "net": f2(cash_in - cash_out),
        "daily": [{"date": r["d"].isoformat(), "in": f2(r["cash_in"]), "out": f2(r["cash_out"])} for r in flow],
    }


# ───────────────────────────── الذمم: مدينة (إعادة استخدام ar_aging) ودائنة ─────────────────────────────

async def _receivables(cid: str) -> dict:
    from .service import ar_aging
    data = await ar_aging(cid)
    tot = data["totals"]
    return {
        "total": tot["total"], "current": tot["current"], "d31_60": tot["d31_60"],
        "d61_90": tot["d61_90"], "d90plus": tot["d90plus"],
        "overdue": round(tot["d31_60"] + tot["d61_90"] + tot["d90plus"], 2),
        "customers": len(data["rows"]),
        "top": [{"customerId": r["customerId"], "name": r["name"], "total": r["total"]} for r in data["rows"][:5]],
        "byCustomer": {r["customerId"]: r["total"] for r in data["rows"]},
    }


async def _payables(cid: str) -> dict:
    rows = await fetch(
        """SELECT s.id AS supplier_id, s.name AS supplier, pi.due_date, pi.invoice_date,
                  (pi.total - COALESCE(pi.paid_total,0)) AS remaining
           FROM purchase_invoices pi JOIN suppliers s ON s.id = pi.supplier_id
           WHERE pi.company_id = $1 AND pi.status != 'paid' AND pi.payment_terms = 'credit'
             AND (pi.total - COALESCE(pi.paid_total,0)) > 0""", cid)
    today = dt.date.today()
    b = {"current": 0.0, "d1_30": 0.0, "d31_60": 0.0, "d61_90": 0.0, "d90plus": 0.0}
    by_sup: dict[str, dict] = {}
    for r in rows:
        rem = float(r["remaining"])
        due = r["due_date"] or r["invoice_date"]
        late = (today - (due.date() if hasattr(due, "date") else due)).days if due else 0
        key = "current" if late <= 0 else "d1_30" if late <= 30 else "d31_60" if late <= 60 else "d61_90" if late <= 90 else "d90plus"
        b[key] += rem
        s = by_sup.setdefault(str(r["supplier_id"]), {"supplierId": str(r["supplier_id"]), "name": r["supplier"], "total": 0.0})
        s["total"] += rem
    total = sum(b.values())
    return {
        "total": f2(total), **{k: f2(v) for k, v in b.items()},
        "overdue": f2(total - b["current"]), "invoices": len(rows),
        "top": sorted(({**s, "total": f2(s["total"])} for s in by_sup.values()), key=lambda s: -s["total"])[:5],
    }


# ───────────────────────────── المخزون (إعادة استخدام inventory_valuation + low_stock_alerts) ─────────────────────────────

async def _inventory(cid: str, cogs_for_turnover: float | None) -> dict:
    from ..inventory.service import low_stock_alerts
    from .service import inventory_valuation
    val, low = await asyncio.gather(inventory_valuation(cid), low_stock_alerts(cid))
    total = val["totalValue"]
    return {
        "totalValue": total, "items": len(val["byProduct"]),
        "lowStock": len(low), "outOfStock": sum(1 for x in low if x["outOfStock"]),
        "lowItems": [{"name": x["name"], "locName": x["locName"], "qty": x["qty"], "minQty": x["minQty"],
                      "outOfStock": x["outOfStock"]} for x in low[:6]],
        "byCategory": val["byCategory"][:6],
        "aging": val["agingBuckets"],
        "deadStockValue": val["agingBuckets"].get("d90", 0),
        "turnover": round(cogs_for_turnover / total, 2) if (cogs_for_turnover and total > 0) else None,
    }


# ───────────────────────────── الفروع / المنتجات / العملاء / آخر الحركات ─────────────────────────────

async def _branches(cid: str, f: dt.date, t: dt.date, pf: dt.date, pt: dt.date, can_finance: bool) -> list[dict]:
    day = "(i.issued_at AT TIME ZONE 'Asia/Riyadh')::date"
    cur, prev = await asyncio.gather(
        fetch(
            f"""SELECT b.id, b.name, COUNT(i.id)::int AS cnt,
                       COALESCE(SUM(i.total_inc),0) AS total_inc,
                       COALESCE(SUM(i.total_ex - COALESCE(i.cogs_total,0)),0) AS gross_profit
                FROM branches b LEFT JOIN invoices i ON i.branch_id = b.id AND NOT i.is_returned
                     AND {day} BETWEEN $2 AND $3
                WHERE b.company_id = $1 GROUP BY b.id, b.name""", cid, f, t),
        fetch(
            f"""SELECT i.branch_id AS id, COALESCE(SUM(i.total_inc),0) AS total_inc
                FROM invoices i WHERE i.company_id = $1 AND NOT i.is_returned AND {day} BETWEEN $2 AND $3
                GROUP BY i.branch_id""", cid, pf, pt))
    opex: dict[str, float] = {}
    if can_finance:
        rows = await fetch(
            """SELECT je.branch_id AS id, COALESCE(SUM(jl.debit - jl.credit),0) AS amount
               FROM journal_lines jl JOIN journal_entries je ON je.id = jl.entry_id
               JOIN accounts a ON a.id = jl.account_id
               WHERE je.company_id = $1 AND je.entry_date BETWEEN $2 AND $3
                 AND a.type = 'expense' AND a.code <> $4 GROUP BY je.branch_id""", cid, f, t, COGS_CODE)
        opex = {str(r["id"]): float(r["amount"]) for r in rows if r["id"]}
    pmap = {str(r["id"]): float(r["total_inc"]) for r in prev}
    out = []
    for r in cur:
        bid = str(r["id"]); sales = float(r["total_inc"]); gp = float(r["gross_profit"])
        ex = opex.get(bid, 0.0)
        p = pmap.get(bid, 0.0)
        out.append({
            "id": bid, "name": r["name"], "sales": f2(sales), "transactions": r["cnt"],
            "grossProfit": f2(gp), "expenses": f2(ex) if can_finance else None,
            "netProfit": f2(gp - ex) if can_finance else None,
            "margin": round(gp / float(r["total_inc"]) * 100, 1) if sales > 0 else 0,
            "growth": round((sales - p) / p * 100, 1) if p > 0 else None,
        })
    return sorted(out, key=lambda b: -b["sales"])


async def _top_products(cid: str, f: dt.date, t: dt.date, branch: str | None) -> list[dict]:
    params: list = [cid, f, t]
    bc = _branch_cond("i.branch_id", branch, params)
    rows = await fetch(
        f"""SELECT ii.label, SUM(ii.qty)::numeric(12,2) AS qty,
                   COALESCE(SUM(ii.line_ex),0) AS revenue,
                   COALESCE(SUM(ii.qty * COALESCE(p.cost_price,0)),0) AS cogs
            FROM invoice_items ii JOIN invoices i ON i.id = ii.invoice_id
            LEFT JOIN products p ON p.id = ii.product_id
            WHERE i.company_id = $1 AND NOT i.is_returned
              AND (i.issued_at AT TIME ZONE 'Asia/Riyadh')::date BETWEEN $2 AND $3{bc}
            GROUP BY ii.label ORDER BY revenue DESC LIMIT 8""", *params)
    out = []
    for r in rows:
        rev = float(r["revenue"]); cogs = float(r["cogs"])
        out.append({"label": r["label"], "qty": f2(r["qty"]), "revenue": f2(rev), "cogs": f2(cogs),
                    "profit": f2(rev - cogs), "margin": round((rev - cogs) / rev * 100, 1) if rev > 0 else 0})
    return out


async def _top_customers(cid: str, f: dt.date, t: dt.date, branch: str | None, owed: dict[str, float]) -> list[dict]:
    params: list = [cid, f, t]
    bc = _branch_cond("i.branch_id", branch, params)
    rows = await fetch(
        f"""SELECT i.customer_id, COALESCE(c.name, MAX(i.customer_name), '—') AS name,
                   COUNT(*)::int AS cnt, COALESCE(SUM(i.total_inc),0) AS total, MAX(i.issued_at) AS last_at
            FROM invoices i LEFT JOIN customers c ON c.id = i.customer_id
            WHERE i.company_id = $1 AND NOT i.is_returned AND i.customer_id IS NOT NULL
              AND (i.issued_at AT TIME ZONE 'Asia/Riyadh')::date BETWEEN $2 AND $3{bc}
            GROUP BY i.customer_id, c.name ORDER BY total DESC LIMIT 6""", *params)
    return [{"customerId": str(r["customer_id"]), "name": r["name"], "invoices": r["cnt"],
             "total": f2(r["total"]), "outstanding": f2(owed.get(str(r["customer_id"]), 0)),
             "lastAt": r["last_at"].isoformat() if r["last_at"] else None} for r in rows]


async def _recent(cid: str, branch: str | None) -> list[dict]:
    params: list = [cid]
    bc = _branch_cond("i.branch_id", branch, params)
    rows = await fetch(
        f"""SELECT i.id, i.invoice_no, i.customer_name, i.source, i.total_inc, i.paid_total, i.credit_total,
                   i.is_returned, i.issued_at, b.name AS branch_name, u.full_name AS user_name,
                   (SELECT string_agg(DISTINCT ip.method, ',') FROM invoice_payments ip WHERE ip.invoice_id = i.id) AS methods
            FROM invoices i JOIN branches b ON b.id = i.branch_id LEFT JOIN users u ON u.id = i.created_by
            WHERE i.company_id = $1{bc} ORDER BY i.issued_at DESC LIMIT 10""", *params)
    out = []
    for r in rows:
        credit = float(r["credit_total"] or 0); paid = float(r["paid_total"] or 0)
        status = "refunded" if r["is_returned"] else ("credit" if credit > 0 and paid <= 0 else "partial" if credit > 0 else "paid")
        out.append({"id": str(r["id"]), "invoiceNo": r["invoice_no"], "customer": r["customer_name"], "source": r["source"],
                    "total": f2(r["total_inc"]), "status": status, "branch": r["branch_name"], "user": r["user_name"],
                    "methods": (r["methods"] or "").split(",") if r["methods"] else [],
                    "at": r["issued_at"].isoformat()})
    return out


async def _ops(cid: str, branch: str | None) -> dict:
    params: list = [cid]
    bc = _branch_cond("branch_id", branch, params)
    r = await fetchrow(
        f"""SELECT COUNT(*) FILTER (WHERE entered_at IS NULL AND exited_at IS NULL)::int AS queued,
                   COUNT(*) FILTER (WHERE entered_at IS NOT NULL AND exited_at IS NULL)::int AS in_service,
                   COUNT(*) FILTER (WHERE exited_at::date = CURRENT_DATE)::int AS done_today
            FROM cars WHERE company_id = $1 AND is_deleted = FALSE{bc}""", *params)
    return {"queued": r["queued"], "inService": r["in_service"], "doneToday": r["done_today"]}


# ───────────────────────────── التجميع ─────────────────────────────

async def build(user, date_from: str | None, date_to: str | None, branch_id: str | None) -> dict:
    today = dt.date.today()
    f = _date(date_from) or today.replace(day=1)
    t = _date(date_to) or today
    if t < f:
        f, t = t, f
    span = (t - f).days + 1
    pt = f - dt.timedelta(days=1)
    pf = pt - dt.timedelta(days=span - 1)
    cid = user.company_id
    branch = user.branch_scope or branch_id or None

    can_sales = user.has(*SALES_PERMS)
    can_fin = user.has(*FINANCE_PERMS)
    can_inv = user.has(*INVENTORY_PERMS)
    can_branches = user.has(*BRANCH_PERMS) and not user.branch_scope
    can_ops = user.has(*OPS_PERMS)

    errors: list[str] = []

    async def safe(name: str, coro, default=None):
        try:
            return await coro
        except Exception as e:                       # قسم واحد يفشل ما بيوقعش الباقي
            print(f"⚠ executive.{name}: {type(e).__name__}: {e}")
            errors.append(name)
            return default

    async def nothing():
        return None

    sales_c, sales_p, jr_c, jr_p, cash, ar, ap, branches, tops, custs, recent, ops = await asyncio.gather(
        safe("sales", _sales(cid, f, t, branch)) if can_sales else nothing(),
        safe("salesPrev", _sales(cid, pf, pt, branch)) if can_sales else nothing(),
        safe("pnl", _journal(cid, f, t, branch)) if can_fin else nothing(),
        safe("pnlPrev", _journal(cid, pf, pt, branch)) if can_fin else nothing(),
        safe("cash", _cash(cid, f, t, branch)) if can_fin else nothing(),
        safe("receivables", _receivables(cid)) if can_fin else nothing(),
        safe("payables", _payables(cid)) if can_fin else nothing(),
        safe("branches", _branches(cid, f, t, pf, pt, can_fin), []) if can_branches else nothing(),
        safe("topProducts", _top_products(cid, f, t, branch), []) if can_sales else nothing(),
        nothing(),  # العملاء بعد معرفة أرصدة الذمم
        safe("recent", _recent(cid, branch), []) if can_sales else nothing(),
        safe("ops", _ops(cid, branch)) if can_ops else nothing(),
    )
    inv = await safe("inventory", _inventory(cid, jr_c["cogs"] if jr_c else None)) if can_inv else None
    top_customers = await safe("topCustomers", _top_customers(cid, f, t, branch, (ar or {}).get("byCustomer", {})), []) if can_sales else None
    if ar:
        ar = {k: v for k, v in ar.items() if k != "byCustomer"}

    # ── تنبيهات ذكية: من البيانات اللي رجعت فقط (مفيش تنبيه من غير رقم حقيقي وراه) ──
    alerts: list[dict] = []
    if inv and inv["outOfStock"]:
        alerts.append({"key": "out_of_stock", "tone": "danger", "count": inv["outOfStock"], "href": "/inventory"})
    if inv and inv["lowStock"] - inv["outOfStock"] > 0:
        alerts.append({"key": "low_stock", "tone": "warning", "count": inv["lowStock"] - inv["outOfStock"], "href": "/inventory"})
    if ar and ar["overdue"] > 0:
        alerts.append({"key": "overdue_receivables", "tone": "warning", "amount": ar["overdue"], "href": "/customers"})
    if ap and ap["overdue"] > 0:
        alerts.append({"key": "overdue_payables", "tone": "danger", "amount": ap["overdue"], "href": "/suppliers"})
    if cash and cash["balance"] < 0:
        alerts.append({"key": "negative_cash", "tone": "danger", "amount": cash["balance"], "href": "/treasury"})
    if sales_c and sales_c["credit"] > 0:
        alerts.append({"key": "credit_invoices", "tone": "info", "amount": sales_c["credit"], "href": "/sales/history"})

    return {
        "period": {"from": f.isoformat(), "to": t.isoformat(), "days": span},
        "prev": {"from": pf.isoformat(), "to": pt.isoformat()},
        "branchId": branch,
        "access": {"sales": can_sales, "finance": can_fin, "inventory": can_inv, "branches": can_branches, "ops": can_ops},
        "sales": sales_c, "salesPrev": sales_p,
        "pnl": jr_c, "pnlPrev": jr_p,
        "cash": cash, "receivables": ar, "payables": ap,
        "inventory": inv, "branches": branches,
        "topProducts": tops, "topCustomers": top_customers,
        "recent": recent, "ops": ops,
        "alerts": alerts,
        "errors": sorted(set(errors)),
    }
