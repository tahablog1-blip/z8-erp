# modules/customers/overview.py — مركز قيادة العملاء: قائمة مُصفّحة من السيرفر + مؤشرات + ملف العميل 360 + ملاحظات
#
# مبادئ:
#   • كل القيم المحاسبية من الباك اند: الرصيد = مجموع customer_ledger (نفس مصدر كشف الحساب)،
#     والمتأخر = أعمار الذمم الموجودة (reports.service.ar_aging) — لا إعادة حساب في الواجهة.
#   • التصفية/الفرز/الترقيم كلها في SQL (لا تحميل كل العملاء في المتصفح).
#   • الأرقام المالية لا تُرجَع إلا لمن يملك customers.view_statement (أو ما يعادله) — غير ذلك None.
#   • الشرائح (VIP/جديد/معرّض للفقد/خامل) عرض فقط محسوب وقت الطلب — لا يُخزَّن ولا يؤثر على الحسابات.
import datetime as dt
import re
import time
from decimal import Decimal

from fastapi import HTTPException

from ...core.db import execute, fetch, fetchrow

FINANCE_PERMS = ("customers.view_statement", "customers.record_payment", "accounting.view_reports")
INVOICE_PERMS = ("customers.view_statement", "invoices.view_all")

_aging_cache: dict[str, tuple[float, dict]] = {}


def f2(v) -> float:
    return round(float(v or 0), 2)


def _date(s: str | None) -> dt.date | None:
    try:
        return dt.date.fromisoformat(s) if s else None
    except ValueError:
        return None


def _num(s) -> float | None:
    try:
        return float(s) if s not in (None, "") else None
    except (TypeError, ValueError):
        return None


async def _overdue_map(company_id: str) -> dict[str, float]:
    """customer_id → المتأخر (أكثر من 30 يوم من تاريخ الفاتورة) — من أعمار الذمم، مع كاش 30 ثانية"""
    hit = _aging_cache.get(company_id)
    if hit and time.time() - hit[0] < 30:
        return hit[1]
    from ..reports.service import ar_aging
    data = await ar_aging(company_id)
    m = {r["customerId"]: round(r["d31_60"] + r["d61_90"] + r["d90plus"], 2) for r in data["rows"]}
    m = {k: v for k, v in m.items() if v > 0}
    _aging_cache[company_id] = (time.time(), m)
    return m


def customer_no(n) -> str:
    return f"CUS-{int(n):06d}" if n is not None else ""


SORTS = {
    "name": "c.name", "sales": "COALESCE(s.total,0)", "balance": "COALESCE(b.balance,0)",
    "last": "s.last_at", "created": "c.created_at", "invoices": "COALESCE(s.cnt,0)",
}

# شريحة العميل (عرض فقط) — الترتيب = الأولوية
SEGMENT_SQL = """CASE
    WHEN COALESCE(s.cnt,0) > 0 AND s.last_at < now() - interval '90 days' THEN 'inactive'
    WHEN COALESCE(s.cnt,0) > 0 AND s.last_at < now() - interval '60 days' THEN 'at_risk'
    WHEN c.created_at >= now() - interval '30 days' THEN 'new'
    WHEN $VIP$ > 0 AND COALESCE(s.total,0) >= $VIP$ THEN 'vip'
    WHEN COALESCE(s.cnt,0) = 0 THEN 'no_activity'
    ELSE 'regular' END"""


async def _vip_threshold(company_id: str) -> float:
    """أعلى 10% من العملاء مبيعاتٍ (بحد أدنى 3 عملاء لهم مشتريات) — VIP"""
    row = await fetchrow(
        """SELECT COUNT(*)::int AS n, percentile_cont(0.9) WITHIN GROUP (ORDER BY t) AS p90
           FROM (SELECT SUM(total_inc) AS t FROM invoices
                 WHERE company_id=$1 AND customer_id IS NOT NULL AND NOT is_returned
                 GROUP BY customer_id) x""", company_id)
    return f2(row["p90"]) if row and row["n"] >= 3 else 0.0


async def list_overview(company_id: str, user, p: dict) -> dict:
    can_fin = user.has(*FINANCE_PERMS)
    scope = user.branch_scope
    d_from = _date(p.get("from")) or dt.date.today().replace(day=1)
    d_to = _date(p.get("to")) or dt.date.today()
    def _int(v, d):
        try:
            return int(v)
        except (TypeError, ValueError):
            return d
    page = max(1, min(_int(p.get("page"), 1), 100000))
    size = min(100, max(5, _int(p.get("pageSize"), 25)))

    vip = await _vip_threshold(company_id)
    overdue = await _overdue_map(company_id) if can_fin else {}

    args: list = [company_id]

    def arg(v) -> str:
        args.append(v)
        return f"${len(args)}"

    br_sql = f" AND branch_id = {arg(scope)}::uuid" if scope else ""
    vip_ph = arg(vip)
    seg_sql = SEGMENT_SQL.replace("$VIP$", f"{vip_ph}::numeric")

    where = ["c.company_id = $1"]
    status = p.get("status") or "active"
    if status == "active":
        where.append("c.is_active = TRUE")
    elif status == "inactive":
        where.append("c.is_active = FALSE")
    if p.get("type") in ("individual", "company"):
        where.append(f"c.customer_type = {arg(p['type'])}")
    q = (p.get("q") or "").strip()
    if q:
        like = arg(f"%{q}%")
        m = re.fullmatch(r"(?:CUS-?|#)?0*(\d{1,9})", q, re.I)
        no_cond = f" OR c.customer_no = {arg(int(m.group(1)))}" if m else ""
        where.append(
            f"""(c.name ILIKE {like} OR c.phone ILIKE {like} OR c.email ILIKE {like}
                 OR c.vat_number ILIKE {like} OR c.cr_number ILIKE {like}{no_cond}
                 OR EXISTS (SELECT 1 FROM invoices i WHERE i.customer_id = c.id AND i.invoice_no ILIKE {like})
                 OR EXISTS (SELECT 1 FROM customer_vehicles v WHERE v.customer_id = c.id
                            AND (v.plate ILIKE {like} OR v.chassis_number ILIKE {like})))""")
    seg = p.get("segment")
    if seg in ("vip", "new", "at_risk", "inactive", "regular", "no_activity"):
        where.append(f"({seg_sql}) = {arg(seg)}")
    if p.get("hasBalance") in ("1", 1, True, "true"):
        where.append("COALESCE(b.balance,0) > 0.005")
    if p.get("overdue") in ("1", 1, True, "true"):
        where.append(f"c.id::text = ANY({arg(list(overdue.keys()))}::text[])")
    if p.get("noActivity") in ("1", 1, True, "true"):
        where.append("COALESCE(s.cnt,0) = 0")
    if p.get("pay") == "credit":
        where.append("COALESCE(s.credit_cnt,0) > 0")
    elif p.get("pay") == "cash":
        where.append("COALESCE(s.credit_cnt,0) = 0")
    for key, col, op in (("regFrom", "c.created_at::date", ">="), ("regTo", "c.created_at::date", "<="),
                         ("lastFrom", "s.last_at::date", ">="), ("lastTo", "s.last_at::date", "<=")):
        d = _date(p.get(key))
        if d:
            where.append(f"{col} {op} {arg(d)}")
    for key, col, op in (("salesMin", "COALESCE(s.total,0)", ">="), ("salesMax", "COALESCE(s.total,0)", "<="),
                         ("balMin", "COALESCE(b.balance,0)", ">="), ("balMax", "COALESCE(b.balance,0)", "<=")):
        n = _num(p.get(key))
        if n is not None:
            where.append(f"{col} {op} {arg(n)}")

    sort_col = SORTS.get(p.get("sort") or "name", "c.name")
    direction = "DESC" if p.get("dir") == "desc" else "ASC"
    nulls = "NULLS LAST"
    off = (page - 1) * size

    rows = await fetch(
        f"""WITH s AS (
              SELECT customer_id, COUNT(*) FILTER (WHERE NOT is_returned) AS cnt,
                     COALESCE(SUM(total_inc) FILTER (WHERE NOT is_returned),0) AS total,
                     COALESCE(SUM(paid_total) FILTER (WHERE NOT is_returned),0) AS paid_at_sale,
                     COUNT(*) FILTER (WHERE NOT is_returned AND credit_total > 0) AS credit_cnt,
                     MAX(issued_at) FILTER (WHERE NOT is_returned) AS last_at
              FROM invoices WHERE company_id = $1 AND customer_id IS NOT NULL{br_sql} GROUP BY customer_id),
            b AS (SELECT customer_id, SUM(amount) AS balance,
                         COALESCE(SUM(-amount) FILTER (WHERE entry_type = 'payment'),0) AS settled
                  FROM customer_ledger WHERE company_id = $1 GROUP BY customer_id)
            SELECT c.id, c.customer_no, c.name, c.customer_type, c.phone, c.email, c.vat_number, c.is_active,
                   c.credit_limit, c.created_at, c.loyalty_points,
                   COALESCE(s.cnt,0)::int AS inv_count, COALESCE(s.total,0) AS total_sales,
                   COALESCE(s.paid_at_sale,0) + COALESCE(b.settled,0) AS paid,
                   COALESCE(b.balance,0) AS balance, s.last_at,
                   (SELECT COUNT(*) FROM customer_vehicles v WHERE v.customer_id = c.id)::int AS vehicles,
                   ({seg_sql}) AS segment, COALESCE(s.credit_cnt,0)::int AS credit_cnt,
                   COUNT(*) OVER() AS total_rows
            FROM customers c LEFT JOIN s ON s.customer_id = c.id LEFT JOIN b ON b.customer_id = c.id
            WHERE {' AND '.join(where)}
            ORDER BY {sort_col} {direction} {nulls}, c.name ASC
            LIMIT {size} OFFSET {off}""", *args)

    total_rows = rows[0]["total_rows"] if rows else 0
    items = []
    for r in rows:
        cid = str(r["id"])
        od = overdue.get(cid, 0.0) if can_fin else None
        items.append({
            "id": cid, "no": customer_no(r["customer_no"]), "name": r["name"], "type": r["customer_type"],
            "phone": r["phone"], "email": r["email"], "vat": r["vat_number"], "isActive": r["is_active"],
            "createdAt": r["created_at"].isoformat() if r["created_at"] else None,
            "lastAt": r["last_at"].isoformat() if r["last_at"] else None,
            "invoiceCount": r["inv_count"], "vehicles": r["vehicles"], "loyaltyPoints": r["loyalty_points"],
            "segment": r["segment"], "isCredit": r["credit_cnt"] > 0,
            "sales": f2(r["total_sales"]) if can_fin else None,
            "paid": f2(r["paid"]) if can_fin else None,
            "balance": f2(r["balance"]) if can_fin else None,
            "overdue": od,
            "creditLimit": float(r["credit_limit"]) if (can_fin and r["credit_limit"] is not None) else None,
        })

    kpis = await _kpis(company_id, d_from, d_to, scope, can_fin, overdue)
    return {"items": items, "total": total_rows, "page": page, "pageSize": size,
            "kpis": kpis, "canFinance": can_fin, "period": {"from": d_from.isoformat(), "to": d_to.isoformat()},
            "vipThreshold": vip}


async def _kpis(company_id: str, f: dt.date, t: dt.date, scope: str | None, can_fin: bool, overdue: dict) -> dict:
    args: list = [company_id, f, t]
    br = ""
    if scope:
        args.append(scope)
        br = " AND branch_id = $4::uuid"
    day = "(issued_at AT TIME ZONE 'Asia/Riyadh')::date"
    row = await fetchrow(
        f"""SELECT
              (SELECT COUNT(*) FROM customers WHERE company_id=$1 AND is_active)::int AS total,
              (SELECT COUNT(*) FROM customers WHERE company_id=$1 AND is_active
                  AND (created_at AT TIME ZONE 'Asia/Riyadh')::date BETWEEN $2 AND $3)::int AS new_cnt,
              (SELECT COUNT(DISTINCT customer_id) FROM invoices
                  WHERE company_id=$1 AND customer_id IS NOT NULL AND NOT is_returned
                    AND {day} BETWEEN $2 AND $3{br})::int AS active_cnt,
              (SELECT COALESCE(SUM(total_inc),0) FROM invoices
                  WHERE company_id=$1 AND customer_id IS NOT NULL AND NOT is_returned
                    AND {day} BETWEEN $2 AND $3{br}) AS sales""", *args)
    out = {"total": row["total"], "newInPeriod": row["new_cnt"], "activeInPeriod": row["active_cnt"],
           "sales": None, "receivables": None, "overdue": None, "avgValue": None, "debtors": None}
    if can_fin:
        rec = await fetchrow(
            """SELECT COALESCE(SUM(bal) FILTER (WHERE bal > 0),0) AS rec, COUNT(*) FILTER (WHERE bal > 0.005)::int AS debtors
               FROM (SELECT SUM(cl.amount) AS bal FROM customer_ledger cl
                     JOIN customers c ON c.id = cl.customer_id AND c.is_active
                     WHERE cl.company_id = $1 GROUP BY cl.customer_id) x""", company_id)
        sales = f2(row["sales"])
        out.update({"sales": sales, "receivables": f2(rec["rec"]), "debtors": rec["debtors"],
                    "overdue": round(sum(overdue.values()), 2),
                    "avgValue": round(sales / row["active_cnt"], 2) if row["active_cnt"] else 0.0})
    return out


# ══════════════════ كشف التكرار ══════════════════

async def check_duplicate(company_id: str, phone: str | None, email: str | None, vat: str | None,
                          name: str | None, exclude_id: str | None) -> list[dict]:
    conds, args = [], [company_id]

    def arg(v):
        args.append(v)
        return f"${len(args)}"

    ph = "".join(ch for ch in (phone or "") if ch.isdigit())
    if len(ph) >= 9:
        tail = ph[-9:]
        conds.append(f"(right(regexp_replace(COALESCE(phone,''), '\\D', '', 'g'), 9) = {arg(tail)})")
    if email and "@" in email:
        conds.append(f"(lower(COALESCE(email,'')) = {arg(email.strip().lower())})")
    if vat and len(vat.strip()) >= 5:
        conds.append(f"(COALESCE(vat_number,'') = {arg(vat.strip())})")
    if name and len(name.strip()) >= 3:
        conds.append(f"(lower(name) = {arg(name.strip().lower())})")
    if not conds:
        return []
    ex = f" AND id <> {arg(exclude_id)}::uuid" if exclude_id else ""
    rows = await fetch(
        f"""SELECT id, name, phone, email, vat_number, is_active, customer_no FROM customers
            WHERE company_id = $1{ex} AND ({' OR '.join(conds)}) ORDER BY is_active DESC, name LIMIT 5""", *args)
    out = []
    for r in rows:
        reasons = []
        if ph and len(ph) >= 9 and "".join(ch for ch in (r["phone"] or "") if ch.isdigit())[-9:] == ph[-9:]:
            reasons.append("phone")
        if email and (r["email"] or "").lower() == email.strip().lower():
            reasons.append("email")
        if vat and (r["vat_number"] or "") == vat.strip():
            reasons.append("vat")
        if name and r["name"].lower() == name.strip().lower():
            reasons.append("name")
        out.append({"id": str(r["id"]), "no": customer_no(r["customer_no"]), "name": r["name"], "phone": r["phone"],
                    "email": r["email"], "isActive": r["is_active"], "reasons": reasons})
    return out


# ══════════════════ الإجراءات الجماعية ══════════════════

async def bulk_status(company_id: str, ids: list[str], activate: bool) -> dict:
    if not ids:
        raise HTTPException(400, "لم يتم اختيار عملاء")
    ids = ids[:500]
    skipped = []
    ok_ids = []
    if activate:
        ok_ids = ids
    else:
        rows = await fetch(
            """SELECT c.id, c.name, COALESCE((SELECT SUM(amount) FROM customer_ledger cl WHERE cl.customer_id=c.id),0) AS bal
               FROM customers c WHERE c.company_id=$1 AND c.id = ANY($2::uuid[])""", company_id, ids)
        for r in rows:
            if float(r["bal"]) > 0.005:       # عميل عليه رصيد مستحق ما يتعطّلش — حماية الذمم
                skipped.append({"id": str(r["id"]), "name": r["name"], "reason": "عليه رصيد مستحق"})
            else:
                ok_ids.append(str(r["id"]))
    if ok_ids:
        await execute("UPDATE customers SET is_active=$3, updated_at=now() WHERE company_id=$1 AND id = ANY($2::uuid[])",
                      company_id, ok_ids, activate)
    return {"updated": len(ok_ids), "skipped": skipped}


# ══════════════════ الملاحظات ══════════════════

async def list_notes(company_id: str, customer_id: str) -> list[dict]:
    rows = await fetch(
        """SELECT n.id, n.note, n.created_at, u.full_name AS user_name
           FROM customer_notes n LEFT JOIN users u ON u.id = n.created_by
           WHERE n.company_id=$1 AND n.customer_id=$2 ORDER BY n.created_at DESC LIMIT 200""",
        company_id, customer_id)
    return [{"id": str(r["id"]), "note": r["note"], "createdAt": r["created_at"].isoformat(), "user": r["user_name"]} for r in rows]


async def add_note(company_id: str, user_id: str, customer_id: str, note: str) -> dict:
    note = (note or "").strip()
    if not note:
        raise HTTPException(422, "اكتب الملاحظة أولاً")
    if len(note) > 2000:
        raise HTTPException(422, "الملاحظة طويلة جداً (الحد 2000 حرف)")
    if not await fetchrow("SELECT 1 FROM customers WHERE id=$1 AND company_id=$2", customer_id, company_id):
        raise HTTPException(404, "العميل غير موجود")
    await execute("INSERT INTO customer_notes (company_id, customer_id, note, created_by) VALUES ($1,$2,$3,$4)",
                  company_id, customer_id, note, user_id)
    return (await list_notes(company_id, customer_id))[0]


# ══════════════════ ملف العميل 360 ══════════════════

async def profile(company_id: str, user, customer_id: str) -> dict:
    c = await fetchrow(
        """SELECT c.id, c.customer_no, c.is_active, c.created_at, c.loyalty_points FROM customers c
           WHERE c.id=$1 AND c.company_id=$2""", customer_id, company_id)
    if not c:
        raise HTTPException(404, "العميل غير موجود")
    can_fin = user.has(*FINANCE_PERMS)
    can_inv = user.has(*INVOICE_PERMS)
    scope = user.branch_scope
    br = " AND i.branch_id = $3::uuid" if scope else ""
    base_args = [company_id, customer_id] + ([scope] if scope else [])

    out: dict = {"id": str(c["id"]), "no": customer_no(c["customer_no"]), "isActive": c["is_active"],
                 "createdAt": c["created_at"].isoformat() if c["created_at"] else None,
                 "loyaltyPoints": c["loyalty_points"], "canFinance": can_fin, "canInvoices": can_inv,
                 "kpis": None, "financial": None, "insights": None, "invoices": None, "payments": None,
                 "purchases": None, "topProducts": None, "timeline": []}

    notes = await list_notes(company_id, customer_id)
    out["notes"] = notes
    events: list[dict] = [{"type": "note", "at": n["createdAt"], "title": n["note"], "user": n["user"]} for n in notes[:30]]

    veh = await fetch(
        "SELECT plate, brand, make_model, created_at FROM customer_vehicles WHERE company_id=$1 AND customer_id=$2 ORDER BY created_at DESC LIMIT 20",
        company_id, customer_id)
    for v in veh:
        events.append({"type": "vehicle", "at": v["created_at"].isoformat(),
                       "title": " ".join(x for x in (v["plate"], v["brand"], v["make_model"]) if x)})

    if can_inv:
        inv_rows = await fetch(
            f"""SELECT i.id, i.invoice_no, i.issued_at, i.total_inc, i.paid_total, i.credit_total, i.is_returned,
                       b.name AS branch, u.full_name AS user_name, i.source,
                       (SELECT string_agg(DISTINCT ip.method, ',') FROM invoice_payments ip WHERE ip.invoice_id = i.id) AS methods
                FROM invoices i LEFT JOIN branches b ON b.id = i.branch_id LEFT JOIN users u ON u.id = i.created_by
                WHERE i.company_id=$1 AND i.customer_id=$2{br} ORDER BY i.issued_at DESC LIMIT 300""", *base_args)
        invoices = []
        valid = [r for r in inv_rows if not r["is_returned"]]
        for r in inv_rows:
            invoices.append({
                "id": str(r["id"]), "invoiceNo": r["invoice_no"], "at": r["issued_at"].isoformat(),
                "total": f2(r["total_inc"]), "paid": f2(r["paid_total"]), "due": f2(r["credit_total"]),
                "isReturned": r["is_returned"], "branch": r["branch"], "user": r["user_name"], "source": r["source"],
                "methods": (r["methods"] or "").split(",") if r["methods"] else [],
            })
            events.append({"type": "refund" if r["is_returned"] else "invoice", "at": r["issued_at"].isoformat(),
                           "title": r["invoice_no"], "amount": f2(r["total_inc"]), "user": r["user_name"]})
        out["invoices"] = invoices

        total = sum(float(r["total_inc"]) for r in valid)
        ref = [r for r in inv_rows if r["is_returned"]]
        dates = sorted(r["issued_at"] for r in valid)
        gaps = [(b - a).days for a, b in zip(dates, dates[1:])]
        by_branch: dict[str, int] = {}
        for r in valid:
            if r["branch"]:
                by_branch[r["branch"]] = by_branch.get(r["branch"], 0) + 1
        now = dt.datetime.now(dt.timezone.utc)
        out["insights"] = {
            "visits": len(valid), "avgInvoice": f2(total / len(valid)) if valid else 0.0, "totalSpent": f2(total),
            "avgDaysBetween": round(sum(gaps) / len(gaps), 1) if gaps else None,
            "daysSinceLast": (now - dates[-1]).days if dates else None,
            "firstAt": dates[0].isoformat() if dates else None, "lastAt": dates[-1].isoformat() if dates else None,
            "favoriteBranch": max(by_branch, key=by_branch.get) if by_branch else None,
        }
        out["_inv"] = {"total": total, "count": len(valid), "refunds": sum(float(r["total_inc"]) for r in ref), "refundCount": len(ref),
                       "paid_at_sale": sum(float(r["paid_total"]) for r in valid)}

        items = await fetch(
            f"""SELECT it.label, it.qty, it.unit_price_vat, it.discount_amount, it.line_inc, i.invoice_no, i.issued_at
                FROM invoice_items it JOIN invoices i ON i.id = it.invoice_id
                WHERE i.company_id=$1 AND i.customer_id=$2 AND NOT i.is_returned{br}
                ORDER BY i.issued_at DESC LIMIT 400""", *base_args)
        out["purchases"] = [{"label": r["label"], "qty": float(r["qty"]), "price": f2(r["unit_price_vat"]),
                             "discount": f2(r["discount_amount"]), "total": f2(r["line_inc"]),
                             "invoiceNo": r["invoice_no"], "at": r["issued_at"].isoformat()} for r in items]
        top = await fetch(
            f"""SELECT it.label, SUM(it.qty) AS qty, SUM(it.line_inc) AS total, COUNT(DISTINCT i.id)::int AS inv
                FROM invoice_items it JOIN invoices i ON i.id = it.invoice_id
                WHERE i.company_id=$1 AND i.customer_id=$2 AND NOT i.is_returned{br}
                GROUP BY it.label ORDER BY total DESC LIMIT 5""", *base_args)
        out["topProducts"] = [{"label": r["label"], "qty": float(r["qty"]), "total": f2(r["total"]), "invoices": r["inv"]} for r in top]

        pays = await fetch(
            f"""SELECT ip.method, ip.amount, ip.created_at, i.invoice_no, u.full_name AS user_name, b.name AS branch
                FROM invoice_payments ip JOIN invoices i ON i.id = ip.invoice_id
                LEFT JOIN users u ON u.id = i.created_by LEFT JOIN branches b ON b.id = i.branch_id
                WHERE i.company_id=$1 AND i.customer_id=$2 AND NOT i.is_returned AND ip.method <> 'credit'{br}
                ORDER BY ip.created_at DESC LIMIT 200""", *base_args)
        payments = [{"kind": "sale", "at": r["created_at"].isoformat(), "amount": f2(r["amount"]), "method": r["method"],
                     "reference": r["invoice_no"], "user": r["user_name"], "branch": r["branch"]} for r in pays]
    else:
        payments = []

    if can_fin:
        led = await fetch(
            """SELECT cl.entry_type, cl.amount, cl.note, cl.created_at, u.full_name AS user_name, i.invoice_no
               FROM customer_ledger cl LEFT JOIN users u ON u.id = cl.created_by LEFT JOIN invoices i ON i.id = cl.invoice_id
               WHERE cl.company_id=$1 AND cl.customer_id=$2 ORDER BY cl.created_at DESC""", company_id, customer_id)
        credit_sales = sum(float(r["amount"]) for r in led if r["entry_type"] == "invoice" and float(r["amount"]) > 0)
        settled = sum(-float(r["amount"]) for r in led if r["entry_type"] == "payment")
        returns = sum(-float(r["amount"]) for r in led if r["entry_type"] == "return")
        balance = sum(float(r["amount"]) for r in led)
        for r in led:
            if r["entry_type"] == "payment":
                payments.append({"kind": "settlement", "at": r["created_at"].isoformat(), "amount": f2(-float(r["amount"])),
                                 "method": None, "reference": r["note"], "user": r["user_name"], "branch": None})
                events.append({"type": "payment", "at": r["created_at"].isoformat(), "title": r["note"] or "سداد",
                               "amount": f2(-float(r["amount"])), "user": r["user_name"]})
        overdue = (await _overdue_map(company_id)).get(customer_id, 0.0)
        inv = out.pop("_inv", None)
        out["financial"] = {"creditSales": f2(credit_sales), "payments": f2(settled), "returns": f2(returns), "balance": f2(balance)}
        out["kpis"] = {
            "totalSales": f2(inv["total"]) if inv else None, "invoiceCount": inv["count"] if inv else None,
            "paid": f2(inv["paid_at_sale"] + settled) if inv else f2(settled), "due": f2(balance), "overdue": overdue,
            "refunds": f2(inv["refunds"]) if inv else None, "refundCount": inv["refundCount"] if inv else None,
            "avgInvoice": out["insights"]["avgInvoice"] if out["insights"] else None,
            "lastAt": out["insights"]["lastAt"] if out["insights"] else None,
        }
    out.pop("_inv", None)
    payments.sort(key=lambda p: p["at"], reverse=True)
    out["payments"] = payments if (can_inv or can_fin) else None
    events.sort(key=lambda e: e["at"], reverse=True)
    out["timeline"] = events[:60]
    return out
