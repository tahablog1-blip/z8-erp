# modules/suppliers/overview.py — مركز قيادة الموردين: قراءة فقط (لا كتابة في الأرصدة ولا دفتر المورد ولا القيود).
#
# تعريفات (مطابقة للنظام القائم):
#   • الرصيد المستحق للمورد = SUM(supplier_ledger.amount) (موجب = ذمة دائنة). الفاتورة الآجلة تُسجَّل بموجب، وسند الصرف بسالب.
#     الفواتير النقدية تُدفع فوراً ولا تدخل الدفتر. هذا هو نفس رصيد suppliers.service.list_suppliers وكشف الحساب.
#   • إجمالي المشتريات = SUM(purchase_invoices.total) حسب invoice_date (شامل الضريبة).
#   • المدفوعات = سندات الصرف (supplier_payments) + إجمالي المشتريات النقدية (دُفعت لحظة الشراء).
#   • المتأخر/المستحق قريباً/الأعمار: من الفواتير الآجلة غير المسددة (total − paid_total) حسب due_date؛ فاتورة بلا due_date تُعد «حالي».
#     ملاحظة: سند صرف غير مرتبط بفاتورة يخفّض الرصيد (الدفتر) دون تخفيض paid_total للفاتورة؛ الفرق يظهر كـ «دفعات غير مخصصة».
#   • لا يوجد نظام مرتجعات مشتريات ولا فرع على المورد/الفاتورة ولا مستندات/ملاحظات/IBAN، فلا تُعرض.
import datetime as dt
from decimal import Decimal

from fastapi import HTTPException

from ...core import accounting
from ...core.db import fetch, fetchrow


def f2(v) -> float:
    return round(float(v or 0), 2)


def _date(s):
    try:
        return dt.date.fromisoformat(s) if s else None
    except ValueError:
        return None


def _int(v, d):
    try:
        return int(v)
    except (TypeError, ValueError):
        return d


def _mk(company_id):
    args: list = [company_id]

    def arg(v) -> str:
        args.append(v)
        return f"${len(args)}"
    return args, arg


SORTS = {
    "name": "s.name", "balance": "COALESCE(bal.balance,0)", "purchases": "COALESCE(pu.purchases,0)", "paid": "COALESCE(pa.paid,0) + COALESCE(pu.cash,0)",
    "overdue": "COALESCE(od.overdue,0)", "last": "pu.last_purchase", "invoices": "COALESCE(pu.cnt,0)",
}
BUCKETS = [("current", "حالي"), ("d1_30", "1–30"), ("d31_60", "31–60"), ("d61_90", "61–90"), ("d90p", "+90")]


def _bucket_sql(today_arg: str) -> str:
    """فئات العمر حسب أيام التأخر عن due_date."""
    late = f"({today_arg}::date - pi.due_date)"
    return f"""CASE WHEN pi.due_date IS NULL OR pi.due_date >= {today_arg}::date THEN 'current'
                    WHEN {late} <= 30 THEN 'd1_30' WHEN {late} <= 60 THEN 'd31_60' WHEN {late} <= 90 THEN 'd61_90' ELSE 'd90p' END"""


async def overview(company_id: str, user, p: dict) -> dict:
    today = dt.date.today()
    d_from = _date(p.get("from")) or today.replace(day=1)
    d_to = _date(p.get("to")) or today
    page = max(1, min(_int(p.get("page"), 1), 100000))
    size = min(100, max(5, _int(p.get("pageSize"), 25)))

    args, arg = _mk(company_id)
    pf, pt, td = arg(d_from), arg(d_to), arg(today)
    ctes = f"""WITH bal AS (SELECT supplier_id, SUM(amount) AS balance FROM supplier_ledger WHERE company_id = $1 GROUP BY supplier_id),
        pu AS (SELECT supplier_id,
                      SUM(total) FILTER (WHERE invoice_date BETWEEN {pf} AND {pt}) AS purchases,
                      SUM(total) FILTER (WHERE invoice_date BETWEEN {pf} AND {pt} AND payment_terms = 'cash') AS cash,
                      COUNT(*) FILTER (WHERE invoice_date BETWEEN {pf} AND {pt}) AS cnt,
                      COUNT(*) AS cnt_all, MAX(invoice_date) AS last_purchase
               FROM purchase_invoices WHERE company_id = $1 GROUP BY supplier_id),
        pa AS (SELECT supplier_id, SUM(amount) FILTER (WHERE (created_at AT TIME ZONE 'Asia/Riyadh')::date BETWEEN {pf} AND {pt}) AS paid,
                      MAX(created_at) AS last_payment
               FROM supplier_payments WHERE company_id = $1 GROUP BY supplier_id),
        od AS (SELECT supplier_id, SUM(total - paid_total) AS overdue, COUNT(*) AS od_cnt, MIN(due_date) AS first_due
               FROM purchase_invoices WHERE company_id = $1 AND payment_terms = 'credit' AND status <> 'paid' AND total > paid_total
                 AND due_date IS NOT NULL AND due_date < {td}::date GROUP BY supplier_id),
        op AS (SELECT supplier_id, COUNT(*) AS open_cnt, MIN(due_date) AS next_due
               FROM purchase_invoices WHERE company_id = $1 AND payment_terms = 'credit' AND status <> 'paid' AND total > paid_total GROUP BY supplier_id)"""
    frm = """FROM suppliers s LEFT JOIN bal ON bal.supplier_id = s.id LEFT JOIN pu ON pu.supplier_id = s.id
             LEFT JOIN pa ON pa.supplier_id = s.id LEFT JOIN od ON od.supplier_id = s.id LEFT JOIN op ON op.supplier_id = s.id"""

    where = ["s.company_id = $1"]
    status = p.get("status") or "active"
    if status == "active":
        where.append("s.is_active = TRUE")
    elif status == "inactive":
        where.append("s.is_active = FALSE")
    if p.get("category"):
        where.append(f"s.category = {arg(p['category'])}")
    q = (p.get("q") or "").strip()
    if q:
        like = arg(f"%{q}%")
        where.append(f"(s.name ILIKE {like} OR s.phone ILIKE {like} OR s.vat_number ILIKE {like} OR s.address ILIKE {like} OR s.category ILIKE {like})")
    f = p.get("filter")
    if f == "payable":
        where.append("COALESCE(bal.balance,0) > 0.005")
    elif f == "overdue":
        where.append("COALESCE(od.overdue,0) > 0.005")
    elif f == "zero":
        where.append("ABS(COALESCE(bal.balance,0)) <= 0.005")
    elif f == "advance":
        where.append("COALESCE(bal.balance,0) < -0.005")
    for key, col, op in (("purchasesMin", "COALESCE(pu.purchases,0)", ">="), ("purchasesMax", "COALESCE(pu.purchases,0)", "<=")):
        try:
            if p.get(key) not in (None, ""):
                where.append(f"{col} {op} {arg(float(p[key]))}")
        except (TypeError, ValueError):
            pass
    sort = SORTS.get(p.get("sort") or "name", "s.name")
    direction = "DESC" if p.get("dir") == "desc" else "ASC"
    off = (page - 1) * size

    rows = await fetch(
        f"""{ctes}
            SELECT s.id, s.name, s.phone, s.vat_number, s.category, s.payment_terms_days, s.is_active, s.rating, s.created_at,
                   COALESCE(bal.balance,0) AS balance, COALESCE(pu.purchases,0) AS purchases, COALESCE(pu.cash,0) AS cash,
                   COALESCE(pu.cnt,0) AS cnt, COALESCE(pu.cnt_all,0) AS cnt_all, pu.last_purchase,
                   COALESCE(pa.paid,0) AS paid, pa.last_payment,
                   COALESCE(od.overdue,0) AS overdue, COALESCE(od.od_cnt,0) AS od_cnt, COALESCE(op.open_cnt,0) AS open_cnt, op.next_due,
                   COUNT(*) OVER() AS total_rows
            {frm} WHERE {' AND '.join(where)}
            ORDER BY {sort} {direction} NULLS LAST, s.name ASC LIMIT {size} OFFSET {off}""", *args)

    items = [{
        "id": str(r["id"]), "name": r["name"], "phone": r["phone"], "vatNumber": r["vat_number"], "category": r["category"],
        "termsDays": r["payment_terms_days"], "active": r["is_active"], "rating": float(r["rating"]) if r["rating"] is not None else None,
        "balance": f2(r["balance"]), "purchases": f2(r["purchases"]), "paid": f2(r["paid"] + r["cash"]),
        "overdue": f2(r["overdue"]), "overdueCount": r["od_cnt"], "openInvoices": r["open_cnt"], "invoiceCount": r["cnt"],
        "invoiceCountAll": r["cnt_all"], "lastPurchase": r["last_purchase"].isoformat() if r["last_purchase"] else None,
        "lastPayment": r["last_payment"].isoformat() if r["last_payment"] else None,
        "nextDue": r["next_due"].isoformat() if r["next_due"] else None,
    } for r in rows]
    total = int(rows[0]["total_rows"]) if rows else 0

    # ── مؤشرات عامة: على كل الموردين (لا تتأثر ببحث الجدول) ──
    a2, arg2 = _mk(company_id)
    pf2, pt2 = arg2(d_from), arg2(d_to)
    k = await fetchrow(
        f"""SELECT (SELECT COUNT(*) FROM suppliers WHERE company_id=$1)::int AS total,
                   (SELECT COUNT(*) FROM suppliers WHERE company_id=$1 AND is_active)::int AS active,
                   COALESCE((SELECT SUM(total) FROM purchase_invoices WHERE company_id=$1 AND invoice_date BETWEEN {pf2} AND {pt2}),0) AS purchases,
                   COALESCE((SELECT SUM(total) FROM purchase_invoices WHERE company_id=$1 AND invoice_date BETWEEN {pf2} AND {pt2} AND payment_terms='cash'),0) AS cash,
                   COALESCE((SELECT SUM(amount) FROM supplier_payments WHERE company_id=$1 AND (created_at AT TIME ZONE 'Asia/Riyadh')::date BETWEEN {pf2} AND {pt2}),0) AS paid,
                   COALESCE((SELECT SUM(b) FROM (SELECT SUM(amount) AS b FROM supplier_ledger WHERE company_id=$1 GROUP BY supplier_id) x WHERE b > 0),0) AS payable,
                   COALESCE((SELECT -SUM(b) FROM (SELECT SUM(amount) AS b FROM supplier_ledger WHERE company_id=$1 GROUP BY supplier_id) x WHERE b < 0),0) AS advances""", *a2)
    a3, arg3 = _mk(company_id)
    td3 = arg3(today)
    bk = _bucket_sql(td3)
    ag = await fetch(
        f"""SELECT {bk} AS bucket, COALESCE(SUM(pi.total - pi.paid_total),0) AS amt, COUNT(*)::int AS cnt
            FROM purchase_invoices pi
            WHERE pi.company_id = $1 AND pi.payment_terms = 'credit' AND pi.status <> 'paid' AND pi.total > pi.paid_total GROUP BY 1""", *a3)
    aging = {k_: {"amount": 0.0, "count": 0} for k_, _ in BUCKETS}
    for r in ag:
        aging[r["bucket"]] = {"amount": f2(r["amt"]), "count": r["cnt"]}
    a4, arg4 = _mk(company_id)
    t4 = arg4(today); t7 = arg4(today + dt.timedelta(days=7))
    ap = await fetchrow(
        f"""SELECT COALESCE(SUM(total - paid_total) FILTER (WHERE due_date < {t4}::date),0) AS overdue,
                   COUNT(*) FILTER (WHERE due_date < {t4}::date)::int AS overdue_cnt,
                   COALESCE(SUM(total - paid_total) FILTER (WHERE due_date >= {t4}::date AND due_date <= {t7}::date),0) AS soon,
                   COUNT(*) FILTER (WHERE due_date >= {t4}::date AND due_date <= {t7}::date)::int AS soon_cnt,
                   COALESCE(SUM(total - paid_total),0) AS outstanding, COUNT(*)::int AS open_cnt
            FROM purchase_invoices WHERE company_id=$1 AND payment_terms='credit' AND status <> 'paid' AND total > paid_total""", *a4)
    outstanding = f2(ap["outstanding"])
    return {
        "period": {"from": d_from.isoformat(), "to": d_to.isoformat()},
        "kpis": {
            "total": k["total"], "active": k["active"], "purchases": f2(k["purchases"]), "paid": f2(k["paid"] + k["cash"]),
            "payable": f2(k["payable"]), "advances": f2(k["advances"]),
            "overdue": f2(ap["overdue"]), "overdueCount": ap["overdue_cnt"], "dueSoon": f2(ap["soon"]), "dueSoonCount": ap["soon_cnt"],
            "openInvoices": ap["open_cnt"], "invoiceOutstanding": outstanding,
            "unallocated": f2(outstanding - float(k["payable"]) + float(k["advances"])),
        },
        "aging": [{"key": key, "label": lbl, **aging[key]} for key, lbl in BUCKETS],
        "items": items, "total": total, "page": page, "pageSize": size,
    }


async def categories(company_id: str) -> list[str]:
    rows = await fetch("SELECT DISTINCT category FROM suppliers WHERE company_id=$1 AND category IS NOT NULL AND category <> '' ORDER BY 1", company_id)
    return [r["category"] for r in rows]


async def payables(company_id: str, p: dict) -> list[dict]:
    """مركز الحسابات المستحقة: الفواتير الآجلة غير المسددة مع فئة العمر، مرتبة بالأقدم استحقاقاً."""
    today = dt.date.today()
    args, arg = _mk(company_id)
    td = arg(today)
    where = ["pi.company_id = $1", "pi.payment_terms = 'credit'", "pi.status <> 'paid'", "pi.total > pi.paid_total"]
    if p.get("supplier"):
        where.append(f"pi.supplier_id = {arg(p['supplier'])}::uuid")
    if p.get("bucket") in dict(BUCKETS):
        where.append(f"({_bucket_sql(td)}) = {arg(p['bucket'])}")
    elif p.get("overdue"):
        where.append(f"pi.due_date < {td}::date")
    rows = await fetch(
        f"""SELECT pi.id, pi.invoice_no, pi.supplier_invoice_ref, pi.invoice_date, pi.due_date, pi.total, pi.paid_total, pi.status,
                   s.id AS supplier_id, s.name AS supplier_name, ({_bucket_sql(td)}) AS bucket
            FROM purchase_invoices pi JOIN suppliers s ON s.id = pi.supplier_id
            WHERE {' AND '.join(where)} ORDER BY pi.due_date ASC NULLS LAST, pi.invoice_date LIMIT 300""", *args)
    return [{
        "id": str(r["id"]), "invoiceNo": r["invoice_no"], "supplierRef": r["supplier_invoice_ref"], "supplierId": str(r["supplier_id"]),
        "supplier": r["supplier_name"], "date": r["invoice_date"].isoformat(), "dueDate": r["due_date"].isoformat() if r["due_date"] else None,
        "total": f2(r["total"]), "paid": f2(r["paid_total"]), "outstanding": f2(r["total"] - r["paid_total"]), "status": r["status"], "bucket": r["bucket"],
        "daysLate": (today - r["due_date"]).days if r["due_date"] and r["due_date"] < today else 0,
    } for r in rows]


async def supplier_360(company_id: str, supplier_id: str, p: dict) -> dict:
    try:
        s = await fetchrow("SELECT * FROM suppliers WHERE id=$1::uuid AND company_id=$2", supplier_id, company_id)
    except Exception as e:
        raise HTTPException(404, "المورد غير موجود") from e
    if not s:
        raise HTTPException(404, "المورد غير موجود")
    today = dt.date.today()
    d_from, d_to = _date(p.get("from")), _date(p.get("to"))

    bal = await fetchrow("SELECT COALESCE(SUM(amount),0) AS b FROM supplier_ledger WHERE company_id=$1 AND supplier_id=$2::uuid", company_id, supplier_id)
    inv = await fetch(
        """SELECT id, invoice_no, supplier_invoice_ref, invoice_date, due_date, payment_terms, subtotal, vat_total, total, paid_total, status, created_at, created_by
           FROM purchase_invoices WHERE company_id=$1 AND supplier_id=$2::uuid ORDER BY invoice_date DESC, created_at DESC LIMIT 500""", company_id, supplier_id)
    pays = await fetch(
        """SELECT sp.id, sp.created_at, sp.method, sp.amount, sp.note, sp.invoice_id, pi.invoice_no, u.full_name AS user_name
           FROM supplier_payments sp LEFT JOIN purchase_invoices pi ON pi.id = sp.invoice_id LEFT JOIN users u ON u.id = sp.created_by
           WHERE sp.company_id=$1 AND sp.supplier_id=$2::uuid ORDER BY sp.created_at DESC LIMIT 500""", company_id, supplier_id)

    # المؤشرات بتجميع SQL على كل السجلات (القوائم أدناه مقيّدة بآخر 500 فقط للعرض)
    ag = await fetchrow(
        """SELECT COALESCE(SUM(total),0) AS total_p, COALESCE(SUM(total) FILTER (WHERE payment_terms='cash'),0) AS cash_p, COUNT(*)::int AS cnt,
                  MAX(invoice_date) AS last_inv,
                  COALESCE(SUM(total-paid_total) FILTER (WHERE payment_terms='credit' AND status<>'paid' AND total>paid_total AND due_date < $3),0) AS od_amt,
                  COUNT(*) FILTER (WHERE payment_terms='credit' AND status<>'paid' AND total>paid_total AND due_date < $3)::int AS od_cnt,
                  COALESCE(SUM(total-paid_total) FILTER (WHERE payment_terms='credit' AND status<>'paid' AND total>paid_total AND due_date >= $3 AND due_date <= $4),0) AS soon_amt,
                  COUNT(*) FILTER (WHERE payment_terms='credit' AND status<>'paid' AND total>paid_total AND due_date >= $3 AND due_date <= $4)::int AS soon_cnt,
                  COUNT(*) FILTER (WHERE payment_terms='credit' AND status<>'paid' AND total>paid_total)::int AS open_cnt
           FROM purchase_invoices WHERE company_id=$1 AND supplier_id=$2::uuid""", company_id, supplier_id, today, today + dt.timedelta(days=7))
    pg = await fetchrow("SELECT COALESCE(SUM(amount),0) AS s, MAX(created_at) AS last FROM supplier_payments WHERE company_id=$1 AND supplier_id=$2::uuid", company_id, supplier_id)
    total_p, cash_p, paid_pays = float(ag["total_p"]), float(ag["cash_p"]), float(pg["s"])
    last_inv, last_pay = ag["last_inv"], pg["last"]

    # ── كشف الحساب من دفتر المورد القائم؛ الرصيد الافتتاحي = مجموع ما قبل بداية الفترة ──
    ledger_rows = await fetch(
        """SELECT sl.id, sl.created_at, sl.entry_type, sl.amount, sl.note, sl.invoice_id, pi.invoice_no, pi.due_date,
                  je.id AS journal_id, je.entry_date AS journal_date
           FROM supplier_ledger sl LEFT JOIN purchase_invoices pi ON pi.id = sl.invoice_id
           LEFT JOIN journal_entries je ON je.company_id = sl.company_id AND je.source_type = 'purchase_invoice' AND je.source_id = sl.invoice_id::text AND sl.entry_type = 'invoice'
           WHERE sl.company_id=$1 AND sl.supplier_id=$2::uuid ORDER BY sl.created_at, sl.id""", company_id, supplier_id)
    opening = Decimal("0")
    running = Decimal("0")
    entries = []
    tot_debit = tot_credit = Decimal("0")
    for r in ledger_rows:
        amt = accounting.dec(r["amount"])
        day = r["created_at"].astimezone(dt.timezone(dt.timedelta(hours=3))).date()
        if d_from and day < d_from:
            opening += amt; running += amt
            continue
        if d_to and day > d_to:
            continue
        running += amt
        debit, credit = (-amt, Decimal("0")) if amt < 0 else (Decimal("0"), amt)   # دفتر الذمم: الفاتورة دائن، السداد مدين
        tot_debit += debit; tot_credit += credit
        entries.append({
            "id": str(r["id"]), "date": r["created_at"].isoformat(), "type": r["entry_type"], "ref": r["invoice_no"], "invoiceId": str(r["invoice_id"]) if r["invoice_id"] else None,
            "note": r["note"], "debit": f2(debit), "credit": f2(credit), "balance": f2(running), "dueDate": r["due_date"].isoformat() if r["due_date"] else None,
            "journalId": str(r["journal_id"]) if r["journal_id"] else None,
        })
    closing = opening + tot_credit - tot_debit

    # ── المنتجات المشتراة (آخر سعر شراء = unit_cost آخر فاتورة؛ ليس بالضرورة تكلفة الصنف الحالية) ──
    prods = await fetch(
        """SELECT COALESCE(it.product_id::text, it.product_label) AS k, MAX(it.product_label) AS label, it.product_id, SUM(it.qty)::bigint AS qty,
                  SUM(it.line_total) AS spend, COUNT(DISTINCT pi.id)::int AS invoices, MAX(pi.invoice_date) AS last_date,
                  (ARRAY_AGG(it.unit_cost ORDER BY pi.invoice_date DESC, pi.created_at DESC))[1] AS last_price, MAX(p.sku) AS sku, MAX(p.barcode) AS barcode
           FROM purchase_invoice_items it JOIN purchase_invoices pi ON pi.id = it.invoice_id LEFT JOIN products p ON p.id = it.product_id
           WHERE pi.company_id=$1 AND pi.supplier_id=$2::uuid GROUP BY 1, it.product_id ORDER BY spend DESC LIMIT 100""", company_id, supplier_id)

    # ── اتجاه شهري (آخر 12 شهراً) ──
    start = (today.replace(day=1) - dt.timedelta(days=330)).replace(day=1)
    trend_p = await fetch(
        """SELECT to_char(date_trunc('month', invoice_date), 'YYYY-MM') AS m, SUM(total) AS t FROM purchase_invoices
           WHERE company_id=$1 AND supplier_id=$2::uuid AND invoice_date >= $3 GROUP BY 1""", company_id, supplier_id, start)
    trend_s = await fetch(
        """SELECT to_char(date_trunc('month', created_at AT TIME ZONE 'Asia/Riyadh'), 'YYYY-MM') AS m, SUM(amount) AS t FROM supplier_payments
           WHERE company_id=$1 AND supplier_id=$2::uuid AND created_at >= $3 GROUP BY 1""", company_id, supplier_id, start)
    months, y, m = [], start.year, start.month
    while (y, m) <= (today.year, today.month):
        months.append(f"{y}-{m:02d}")
        m += 1
        if m == 13:
            y, m = y + 1, 1
    tp, ts = {r["m"]: f2(r["t"]) for r in trend_p}, {r["m"]: f2(r["t"]) for r in trend_s}

    names = {}
    uid = {str(r["created_by"]) for r in inv if r["created_by"]}
    if uid:
        for r in await fetch("SELECT id, full_name FROM users WHERE id = ANY($1::uuid[])", list(uid)):
            names[str(r["id"])] = r["full_name"]

    # ── نشاط حقيقي من السجلات: فواتير وسندات صرف ──
    activity = sorted(
        [{"at": r["created_at"].isoformat(), "kind": "invoice", "text": f"فاتورة شراء {r['invoice_no']} ({'نقداً' if r['payment_terms'] == 'cash' else 'آجل'})", "amount": f2(r["total"]),
          "user": names.get(str(r["created_by"]))} for r in inv[:30]]
        + [{"at": r["created_at"].isoformat(), "kind": "payment", "text": f"سند صرف ({_METHOD.get(r['method'], r['method'])})" + (f" — {r['invoice_no']}" if r["invoice_no"] else ""),
            "amount": f2(r["amount"]), "user": r["user_name"]} for r in pays[:30]],
        key=lambda x: x["at"], reverse=True)[:40]

    inv_out = [{
        "id": str(r["id"]), "invoiceNo": r["invoice_no"], "supplierRef": r["supplier_invoice_ref"], "date": r["invoice_date"].isoformat(),
        "dueDate": r["due_date"].isoformat() if r["due_date"] else None, "terms": r["payment_terms"], "subtotal": f2(r["subtotal"]), "vat": f2(r["vat_total"]),
        "total": f2(r["total"]), "paid": f2(r["paid_total"]), "outstanding": f2(r["total"] - r["paid_total"]), "status": r["status"],
        "overdue": bool(r["payment_terms"] == "credit" and r["status"] != "paid" and r["total"] > r["paid_total"] and r["due_date"] and r["due_date"] < today),
    } for r in inv]
    return {
        "supplier": {"id": str(s["id"]), "name": s["name"], "phone": s["phone"], "vatNumber": s["vat_number"], "address": s["address"], "termsDays": s["payment_terms_days"],
                     "category": s["category"], "rating": float(s["rating"]) if s["rating"] is not None else None, "ratingNote": s["rating_note"], "active": s["is_active"],
                     "createdAt": s["created_at"].isoformat() if s["created_at"] else None},
        "kpis": {
            "purchases": f2(total_p), "paid": f2(paid_pays + cash_p), "balance": f2(bal["b"]), "overdue": f2(ag["od_amt"]),
            "overdueCount": ag["od_cnt"], "dueSoon": f2(ag["soon_amt"]), "dueSoonCount": ag["soon_cnt"],
            "invoiceCount": ag["cnt"], "avgInvoice": f2(total_p / ag["cnt"]) if ag["cnt"] else 0, "lastInvoice": last_inv.isoformat() if last_inv else None,
            "lastPayment": last_pay.isoformat() if last_pay else None, "daysInactive": (today - last_inv).days if last_inv else None,
            "openInvoices": ag["open_cnt"],
        },
        "invoices": inv_out,
        "payments": [{"id": str(r["id"]), "at": r["created_at"].isoformat(), "method": r["method"], "methodLabel": _METHOD.get(r["method"], r["method"]), "amount": f2(r["amount"]),
                      "invoiceNo": r["invoice_no"], "note": r["note"], "user": r["user_name"]} for r in pays],
        "ledger": {"opening": f2(opening), "debit": f2(tot_debit), "credit": f2(tot_credit), "closing": f2(closing), "entries": entries,
                   "from": d_from.isoformat() if d_from else None, "to": d_to.isoformat() if d_to else None},
        "products": [{"key": r["k"], "productId": str(r["product_id"]) if r["product_id"] else None, "label": r["label"], "sku": r["sku"], "barcode": r["barcode"],
                      "qty": int(r["qty"]), "spend": f2(r["spend"]), "invoices": r["invoices"], "lastDate": r["last_date"].isoformat() if r["last_date"] else None,
                      "lastPrice": f2(r["last_price"])} for r in prods],
        "trend": [{"month": mo, "purchases": tp.get(mo, 0.0), "payments": ts.get(mo, 0.0)} for mo in months],
        "activity": activity,
    }


_METHOD = {"cash": "نقدي", "card": "بطاقة", "transfer": "تحويل"}


async def activate(company_id: str, supplier_id: str) -> None:
    try:
        row = await fetchrow("UPDATE suppliers SET is_active=TRUE WHERE id=$1::uuid AND company_id=$2 RETURNING id", supplier_id, company_id)
    except Exception as e:
        raise HTTPException(404, "المورد غير موجود") from e
    if not row:
        raise HTTPException(404, "المورد غير موجود")
