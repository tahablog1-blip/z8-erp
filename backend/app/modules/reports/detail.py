# modules/reports/detail.py — تقارير تفصيلية (قراءة فقط): تحليل المبيعات بأي بُعد، المرتجعات، حركة المخزون، الموارد البشرية، وفحص التسوية.
# الحساب كله هنا (الخادم): المقارنة بالفترة السابقة، الربح والهامش، الفروقات. لا يُكتب شيء في أي جدول.
import datetime as dt

from fastapi import HTTPException

from ...core.accounting import ACCOUNT_CODES, PAYMENT_ACCOUNT_CODES
from ...core.db import fetch, fetchrow
from .center import RIYADH_DAY, _branch, _meta, _num, parse_range

# ══════════════════ مقارنة بفترة أخرى ══════════════════

def compare_range(f: dt.date, t: dt.date, mode: str | None) -> tuple[dt.date, dt.date] | None:
    """prev = فترة سابقة بنفس الطول مباشرة قبل البداية؛ yoy = نفس التواريخ قبل سنة"""
    if mode == "prev":
        n = (t - f).days + 1
        return f - dt.timedelta(days=n), f - dt.timedelta(days=1)
    if mode == "yoy":
        try:
            return f.replace(year=f.year - 1), t.replace(year=t.year - 1)
        except ValueError:     # 29 فبراير
            return f.replace(year=f.year - 1, day=28), t.replace(year=t.year - 1, day=28)
    return None


def delta(cur: float, prev: float | None) -> dict:
    """نسبة التغيّر لا تُعرض إلا لو يوجد أساس مقارنة صحيح (القيمة السابقة > 0)"""
    if prev is None or prev <= 0:
        return {"prev": prev, "pct": None}
    return {"prev": round(prev, 2), "pct": round((cur - prev) / prev * 100, 1)}


# ══════════════════ تحليل المبيعات بأي بُعد ══════════════════

DIMS = {
    # key: (تعبير المفتاح، تعبير الاسم، joins إضافية)
    "product": ("ii.product_id::text", "COALESCE(p.name, ii.label)", ""),
    "category": ("COALESCE(NULLIF(p.category,''),'غير مصنّف')", "COALESCE(NULLIF(p.category,''),'غير مصنّف')", ""),
    "brand": ("COALESCE(NULLIF(p.oil_brand,''),'غير محدد')", "COALESCE(NULLIF(p.oil_brand,''),'غير محدد')", ""),
    "branch": ("i.branch_id::text", "COALESCE(b.name,'بلا فرع')", ""),
    "employee": ("i.created_by::text", "COALESCE(u.full_name,'غير معروف')", ""),
    "customer": ("i.customer_id::text", "COALESCE(c.name, NULLIF(i.customer_name,''), 'عميل نقدي')", ""),
    "car_brand": ("COALESCE(NULLIF(car.brand,''),'بدون سيارة')", "COALESCE(NULLIF(car.brand,''),'بدون سيارة')", ""),
    "car_model": ("COALESCE(NULLIF(car.brand,''),'—') || ' ' || COALESCE(NULLIF(car.name,''),'')", "COALESCE(NULLIF(car.brand,''),'بدون سيارة') || ' ' || COALESCE(NULLIF(car.name,''),'')", ""),
    "day": (RIYADH_DAY + "::text", RIYADH_DAY + "::text", ""),
    "month": ("to_char(" + RIYADH_DAY + ",'YYYY-MM')", "to_char(" + RIYADH_DAY + ",'YYYY-MM')", ""),
}
_FROM = """FROM invoice_items ii
           JOIN invoices i ON i.id = ii.invoice_id
           LEFT JOIN products p ON p.id = ii.product_id
           LEFT JOIN branches b ON b.id = i.branch_id
           LEFT JOIN users u ON u.id = i.created_by
           LEFT JOIN customers c ON c.id = i.customer_id
           LEFT JOIN cars car ON car.id = i.car_id"""


async def _sales_totals(cid, f, t, branch) -> dict:
    p: list = [cid, f, t]
    bc = ""
    if branch:
        p.append(branch); bc = f" AND i.branch_id = ${len(p)}::uuid"
    r = await fetchrow(
        f"""SELECT COALESCE(SUM(ii.line_ex),0) AS rev, COALESCE(SUM(ii.qty),0) AS qty, COUNT(DISTINCT i.id)::int AS inv
            {_FROM} WHERE i.company_id=$1 AND NOT i.is_returned AND {RIYADH_DAY} BETWEEN $2 AND $3{bc}""", *p)
    ret = await fetchrow(
        f"""SELECT COALESCE(SUM(r.total_ex),0) AS ex FROM invoice_returns r
            WHERE r.company_id=$1 AND (r.created_at AT TIME ZONE 'Asia/Riyadh')::date BETWEEN $2 AND $3
            {bc.replace('i.branch_id', 'r.branch_id')}""", *p)
    return {"revenue": _num(r["rev"]), "qty": _num(r["qty"]), "invoices": r["inv"], "returnsEx": _num(ret["ex"])}


async def sales_breakdown(user, date_from, date_to, branch_id, dim: str, compare: str | None) -> dict:
    if dim not in DIMS:
        raise HTTPException(422, "بُعد غير مدعوم")
    f, t = parse_range(date_from, date_to)
    branch = _branch(user, branch_id)
    can_cost = user.has("accounting.view_reports")
    key_e, label_e, _ = DIMS[dim]
    p: list = [user.company_id, f, t]
    bc = ""
    if branch:
        p.append(branch); bc = f" AND i.branch_id = ${len(p)}::uuid"
    rows = await fetch(
        f"""SELECT {key_e} AS k, {label_e} AS label,
                   COALESCE(SUM(ii.line_ex),0) AS rev, COALESCE(SUM(ii.line_vat),0) AS vat, COALESCE(SUM(ii.qty),0) AS qty,
                   COUNT(DISTINCT i.id)::int AS inv,
                   COALESCE(SUM(ii.qty * COALESCE(p.cost_price,0)),0) AS cogs
            {_FROM}
            WHERE i.company_id=$1 AND NOT i.is_returned AND {RIYADH_DAY} BETWEEN $2 AND $3{bc}
            GROUP BY 1, 2 ORDER BY rev DESC LIMIT 500""", *p)
    out = []
    for r in rows:
        rev, cogs = _num(r["rev"]), _num(r["cogs"])
        row = {"key": r["k"], "label": (r["label"] or "—").strip() or "—", "revenue": round(rev, 2), "vat": round(_num(r["vat"]), 2),
               "qty": _num(r["qty"]), "invoices": r["inv"], "avgInvoice": round(rev / r["inv"], 2) if r["inv"] else 0}
        if can_cost:
            row.update({"cogs": round(cogs, 2), "grossProfit": round(rev - cogs, 2), "marginPct": round((rev - cogs) / rev * 100, 1) if rev > 0 else None})
        out.append(row)
    tot = await _sales_totals(user.company_id, f, t, branch)
    tot["netRevenue"] = round(tot["revenue"] - tot["returnsEx"], 2)
    if can_cost:
        c = sum(r["cogs"] for r in out)
        tot["cogs"] = round(c, 2); tot["grossProfit"] = round(tot["revenue"] - c, 2)
    res = {"meta": _meta(user, f, t, branch), "dim": dim, "rows": out, "totals": tot, "canCost": can_cost,
           "truncated": len(out) >= 500,
           "note": "المبيعات قبل الضريبة من فواتير غير مرتجعة بالكامل، والتكلفة من تكلفة الصنف الحالية في بطاقة الصنف. المرتجعات الجزئية تُخصم في «صافي المبيعات»."}
    cr = compare_range(f, t, compare)
    if cr:
        pt = await _sales_totals(user.company_id, cr[0], cr[1], branch)
        res["compare"] = {"mode": compare, "from": cr[0].isoformat(), "to": cr[1].isoformat(), "totals": pt,
                          "revenue": delta(tot["revenue"], pt["revenue"]), "invoices": delta(tot["invoices"], pt["invoices"]),
                          "qty": delta(tot["qty"], pt["qty"])}
    return res


# ══════════════════ المرتجعات ══════════════════

async def returns_report(user, date_from, date_to, branch_id) -> dict:
    f, t = parse_range(date_from, date_to)
    branch = _branch(user, branch_id)
    p: list = [user.company_id, f, t]
    bc_r = bc_i = ""
    if branch:
        p.append(branch); bc_r = f" AND r.branch_id = ${len(p)}::uuid"; bc_i = f" AND i.branch_id = ${len(p)}::uuid"
    partial = await fetch(
        f"""SELECT r.id, r.return_no, i.invoice_no, r.created_at AS at, COALESCE(b.name,'—') AS branch, r.total_ex, r.total_vat, r.total_inc, r.note
            FROM invoice_returns r JOIN invoices i ON i.id = r.invoice_id LEFT JOIN branches b ON b.id = r.branch_id
            WHERE r.company_id=$1 AND (r.created_at AT TIME ZONE 'Asia/Riyadh')::date BETWEEN $2 AND $3{bc_r}
            ORDER BY r.created_at DESC LIMIT 300""", *p)
    full = await fetch(
        f"""SELECT i.id, i.invoice_no, i.issued_at AS at, COALESCE(b.name,'—') AS branch, i.total_ex, i.total_vat, i.total_inc
            FROM invoices i LEFT JOIN branches b ON b.id = i.branch_id
            WHERE i.company_id=$1 AND i.is_returned AND {RIYADH_DAY} BETWEEN $2 AND $3{bc_i}
            ORDER BY i.issued_at DESC LIMIT 300""", *p)
    rows = [{"kind": "partial", "no": r["return_no"], "invoiceNo": r["invoice_no"], "at": r["at"], "branch": r["branch"],
             "totalEx": _num(r["total_ex"]), "vat": _num(r["total_vat"]), "totalInc": _num(r["total_inc"]), "note": r["note"]} for r in partial]
    rows += [{"kind": "full", "no": None, "invoiceNo": r["invoice_no"], "at": r["at"], "branch": r["branch"],
              "totalEx": _num(r["total_ex"]), "vat": _num(r["total_vat"]), "totalInc": _num(r["total_inc"]), "note": None} for r in full]
    s = lambda k, key: round(sum(x[key] for x in rows if x["kind"] == k), 2)
    return {"meta": _meta(user, f, t, branch), "rows": rows,
            "totals": {"partialCount": len(partial), "partialInc": s("partial", "totalInc"), "fullCount": len(full), "fullInc": s("full", "totalInc"),
                       "totalInc": round(s("partial", "totalInc") + s("full", "totalInc"), 2)},
            "note": "المرتجع الجزئي بتاريخ تسجيله، والمرتجع الكامل بتاريخ إصدار الفاتورة الأصلية (النظام لا يحفظ تاريخ إلغاء الفاتورة)."}


# ══════════════════ حركة المخزون ══════════════════

_TYPE_AR = {"receive": "استلام (وارد)", "transfer": "تحويل", "adjust": "تسوية جرد"}


async def stock_movements_report(user, date_from, date_to, branch_id) -> dict:
    f, t = parse_range(date_from, date_to)
    branch = _branch(user, branch_id)
    can_cost = user.has("accounting.view_reports")
    p: list = [user.company_id, f, t]
    sc = ""
    if branch:
        p.append(branch); sc = f" AND (sm.from_loc_id = ${len(p)} OR sm.to_loc_id = ${len(p)})"
    base = f"sm.company_id=$1 AND (sm.created_at AT TIME ZONE 'Asia/Riyadh')::date BETWEEN $2 AND $3{sc}"
    by_type = await fetch(
        f"""SELECT sm.move_type, COUNT(*)::int AS n, COALESCE(SUM(sm.qty),0) AS qty,
                   COALESCE(SUM(sm.qty * sm.unit_cost) FILTER (WHERE sm.unit_cost IS NOT NULL),0) AS value,
                   COALESCE(SUM(sm.qty) FILTER (WHERE sm.move_no LIKE 'STI%'),0) AS adj_in,
                   COALESCE(SUM(sm.qty) FILTER (WHERE sm.move_no LIKE 'STO%'),0) AS adj_out
            FROM stock_moves sm WHERE {base} GROUP BY sm.move_type ORDER BY 2 DESC""", *p)
    top = await fetch(
        f"""SELECT COALESCE(p.name, sm.product_label) AS name, sm.product_id, COUNT(*)::int AS n, COALESCE(SUM(sm.qty),0) AS qty
            FROM stock_moves sm LEFT JOIN products p ON p.id = sm.product_id WHERE {base}
            GROUP BY 1, 2 ORDER BY qty DESC LIMIT 15""", *p)
    daily = await fetch(
        f"""SELECT (sm.created_at AT TIME ZONE 'Asia/Riyadh')::date AS d, COUNT(*)::int AS n, COALESCE(SUM(sm.qty),0) AS qty
            FROM stock_moves sm WHERE {base} GROUP BY 1 ORDER BY 1""", *p)
    types = [{"type": r["move_type"], "label": _TYPE_AR.get(r["move_type"], r["move_type"]), "count": r["n"], "qty": _num(r["qty"]),
              "value": round(_num(r["value"]), 2) if can_cost else None,
              "adjustIn": _num(r["adj_in"]) if r["move_type"] == "adjust" else None, "adjustOut": _num(r["adj_out"]) if r["move_type"] == "adjust" else None} for r in by_type]
    return {"meta": _meta(user, f, t, branch), "canCost": can_cost, "byType": types,
            "topProducts": [{"productId": str(r["product_id"]) if r["product_id"] else None, "name": r["name"] or "—", "count": r["n"], "qty": _num(r["qty"])} for r in top],
            "daily": [{"date": r["d"].isoformat(), "count": r["n"], "qty": _num(r["qty"])} for r in daily],
            "totals": {"count": sum(x["count"] for x in types)},
            "note": "القيمة تُحسب فقط للحركات المسجّل لها تكلفة وحدة (الاستلام من المشتريات). التحويلات والتسويات بلا تكلفة مسجّلة في الحركة نفسها."}


# ══════════════════ الموارد البشرية ══════════════════

async def hr_report(user, date_from, date_to, branch_id) -> dict:
    f, t = parse_range(date_from, date_to)
    branch = _branch(user, branch_id)
    p: list = [user.company_id]
    bc = ""
    if branch:
        p.append(branch); bc = f" AND e.branch_id = ${len(p)}::uuid"
    heads = await fetch(
        f"""SELECT COALESCE(b.name,'بلا فرع') AS branch, COALESCE(d.name,'بلا قسم') AS dept,
                   COUNT(*) FILTER (WHERE e.is_saudi)::int AS saudi, COUNT(*) FILTER (WHERE NOT e.is_saudi)::int AS non_saudi
            FROM hr_employees e LEFT JOIN branches b ON b.id = e.branch_id LEFT JOIN hr_departments d ON d.id = e.department_id
            WHERE e.company_id=$1 AND e.is_active{bc} GROUP BY 1, 2""", *p)
    by_branch: dict[str, int] = {}
    by_dept: dict[str, int] = {}
    saudi = non = 0
    for r in heads:
        n = r["saudi"] + r["non_saudi"]
        by_branch[r["branch"]] = by_branch.get(r["branch"], 0) + n
        by_dept[r["dept"]] = by_dept.get(r["dept"], 0) + n
        saudi += r["saudi"]; non += r["non_saudi"]
    p2 = p + [f, t]
    a, b2 = len(p) + 1, len(p) + 2
    att = await fetchrow(
        f"""WITH x AS (
              SELECT a.employee_id, a.check_in, a.check_out,
                     ((a.work_date + s.start_time) AT TIME ZONE 'Asia/Riyadh') AS st,
                     ((a.work_date + s.end_time + CASE WHEN s.end_time <= s.start_time THEN interval '1 day' ELSE interval '0' END) AT TIME ZONE 'Asia/Riyadh') AS en,
                     s.grace_minutes AS g
              FROM hr_attendance a JOIN hr_employees e ON e.id = a.employee_id
              LEFT JOIN hr_work_schedules s ON s.id = e.schedule_id
              WHERE a.company_id=$1 AND a.work_date BETWEEN ${a} AND ${b2}{bc})
            SELECT COUNT(*) FILTER (WHERE check_in IS NOT NULL)::int AS days,
                   COUNT(*) FILTER (WHERE st IS NOT NULL AND check_in > st + make_interval(mins => g))::int AS late_days,
                   COALESCE(SUM(GREATEST(0, (EXTRACT(EPOCH FROM (check_in - st))/60)::int - g)) FILTER (WHERE st IS NOT NULL AND check_in IS NOT NULL),0)::int AS late_min,
                   COALESCE(SUM(GREATEST(0, (EXTRACT(EPOCH FROM (check_out - en))/60)::int)) FILTER (WHERE en IS NOT NULL AND check_out IS NOT NULL),0)::int AS ot_min,
                   COALESCE(SUM((EXTRACT(EPOCH FROM (check_out - check_in))/60)::int) FILTER (WHERE check_out IS NOT NULL AND check_in IS NOT NULL),0)::int AS worked_min
            FROM x""", *p2)
    leave = await fetch(
        f"""SELECT l.leave_type, COUNT(*)::int AS n, COALESCE(SUM(l.days_count),0)::int AS days
            FROM hr_leave_requests l JOIN hr_employees e ON e.id = l.employee_id
            WHERE l.company_id=$1 AND l.status='approved' AND l.start_date BETWEEN ${a} AND ${b2}{bc} GROUP BY 1 ORDER BY 3 DESC""", *p2)
    con = await fetchrow(
        f"""SELECT COUNT(*) FILTER (WHERE c.end_date < (now() AT TIME ZONE 'Asia/Riyadh')::date)::int AS expired,
                   COUNT(*) FILTER (WHERE c.end_date BETWEEN (now() AT TIME ZONE 'Asia/Riyadh')::date AND (now() AT TIME ZONE 'Asia/Riyadh')::date + 30)::int AS d30,
                   COUNT(*) FILTER (WHERE c.end_date BETWEEN (now() AT TIME ZONE 'Asia/Riyadh')::date + 31 AND (now() AT TIME ZONE 'Asia/Riyadh')::date + 90)::int AS d90
            FROM hr_contracts c JOIN hr_employees e ON e.id = c.employee_id
            WHERE c.company_id=$1 AND c.status='active' AND c.end_date IS NOT NULL AND e.is_active{bc}""", *p)
    payroll = None
    if user.has("hr.payroll") and user.has("hr.salary.view") and not branch:   # المسير على مستوى الشركة
        rows = await fetch(
            """SELECT r.period_year, r.period_month, r.status, COUNT(p.id)::int AS slips,
                      COALESCE(SUM(p.basic_salary),0) AS basic, COALESCE(SUM(p.allowances),0) AS allowances,
                      COALESCE(SUM(p.violations_deduction + p.other_deductions),0) AS deductions,
                      COALESCE(SUM(p.advance_deduction),0) AS advances, COALESCE(SUM(p.net_pay),0) AS net
               FROM hr_payroll_runs r LEFT JOIN hr_payslips p ON p.payroll_run_id = r.id
               WHERE r.company_id=$1 AND make_date(r.period_year, r.period_month, 1) BETWEEN date_trunc('month', $2::date) AND $3::date
               GROUP BY 1,2,3 ORDER BY 1,2""", user.company_id, f, t)
        payroll = [{"year": r["period_year"], "month": r["period_month"], "status": r["status"], "slips": r["slips"], "basic": _num(r["basic"]),
                    "allowances": _num(r["allowances"]), "deductions": _num(r["deductions"]), "advances": _num(r["advances"]), "net": _num(r["net"])} for r in rows]
    return {"meta": _meta(user, f, t, branch),
            "headcount": {"total": saudi + non, "saudi": saudi, "nonSaudi": non,
                          "byBranch": [{"name": k, "count": v} for k, v in sorted(by_branch.items(), key=lambda x: -x[1])],
                          "byDepartment": [{"name": k, "count": v} for k, v in sorted(by_dept.items(), key=lambda x: -x[1])]},
            "attendance": {"daysPresent": att["days"], "lateDays": att["late_days"], "lateMinutes": att["late_min"],
                           "overtimeMinutes": att["ot_min"], "workedMinutes": att["worked_min"]},
            "leave": [{"type": r["leave_type"], "requests": r["n"], "days": r["days"]} for r in leave],
            "contracts": {"expired": con["expired"], "d30": con["d30"], "d90": con["d90"]},
            "payroll": payroll,
            "note": "التأخير والإضافي لمن له جدول دوام فقط. أرقام الرواتب تظهر لمن يملك صلاحيتي الرواتب وعرض الرواتب، وعلى مستوى الشركة كلها."}


# ══════════════════ فحص التسوية: المبيعات مقابل دفتر الأستاذ ══════════════════

async def reconciliation(user, date_from, date_to, branch_id) -> dict:
    f, t = parse_range(date_from, date_to)
    branch = _branch(user, branch_id)
    p: list = [user.company_id, f, t]
    ibc = jbc = rbc = ""
    if branch:
        p.append(branch)
        ibc = f" AND i.branch_id = ${len(p)}::uuid"; jbc = f" AND je.branch_id = ${len(p)}::uuid"; rbc = f" AND r.branch_id = ${len(p)}::uuid"
    inv = await fetchrow(
        f"""SELECT COALESCE(SUM(total_ex),0) AS ex, COALESCE(SUM(total_vat),0) AS vat, COALESCE(SUM(COALESCE(cogs_total,0)),0) AS cogs
            FROM invoices i WHERE i.company_id=$1 AND NOT i.is_returned AND {RIYADH_DAY} BETWEEN $2 AND $3{ibc}""", *p)
    ret = await fetchrow(
        f"""SELECT COALESCE(SUM(r.total_ex),0) AS ex, COALESCE(SUM(r.total_vat),0) AS vat FROM invoice_returns r
            WHERE r.company_id=$1 AND (r.created_at AT TIME ZONE 'Asia/Riyadh')::date BETWEEN $2 AND $3{rbc}""", *p)
    full = await fetchrow(
        f"""SELECT COUNT(*)::int AS n FROM invoices i WHERE i.company_id=$1 AND i.is_returned AND {RIYADH_DAY} BETWEEN $2 AND $3{ibc}""", *p)
    codes = [ACCOUNT_CODES["SALES_REVENUE"], ACCOUNT_CODES["VAT_PAYABLE"], ACCOUNT_CODES["COGS"]]
    q = f"""SELECT a.code, COALESCE(SUM(jl.credit - jl.debit),0) AS net
            FROM journal_lines jl JOIN journal_entries je ON je.id = jl.entry_id JOIN accounts a ON a.id = jl.account_id
            WHERE je.company_id=$1 AND je.entry_date BETWEEN $2 AND $3 AND a.company_id=$1 AND a.code = ANY(${len(p) + 1}::text[]){jbc}
            GROUP BY a.code"""
    jr = await fetch(q, *p, codes)
    jm = {r["code"]: _num(r["net"]) for r in jr}
    checks = []

    def add(key, label, inv_val, led_val, note):
        diff = round(inv_val - led_val, 2)
        checks.append({"key": key, "label": label, "invoices": round(inv_val, 2), "ledger": round(led_val, 2), "diff": diff, "ok": abs(diff) <= 0.05, "note": note})
    add("revenue", "الإيرادات (قبل الضريبة)", _num(inv["ex"]) - _num(ret["ex"]), jm.get(codes[0], 0.0),
        "الفواتير غير المرتجعة بالكامل ناقص المرتجعات الجزئية، مقابل رصيد حساب المبيعات في الأستاذ.")
    add("vat", "ضريبة المخرجات", _num(inv["vat"]) - _num(ret["vat"]), jm.get(codes[1], 0.0),
        "ضريبة الفواتير ناقص ضريبة المرتجعات، مقابل حساب ضريبة القيمة المضافة المستحقة (دائن − مدين). قد يشمل الحساب حركات أخرى كسداد الضريبة.")
    add("cogs", "تكلفة المبيعات", _num(inv["cogs"]), -jm.get(codes[2], 0.0), "تكلفة البضاعة المسجّلة على الفواتير مقابل حساب تكلفة المبيعات.")
    # ── الخزينة: سندات القبض/الصرف غير الملغاة مقابل حركة حسابات النقد من قيود الخزينة (إنشاء + إلغاء) ──
    tp: list = [user.company_id, f, t]
    tbc = tjc = ""
    if branch:
        tp.append(branch); tbc = f" AND v.branch_id = ${len(tp)}::uuid"; tjc = f" AND je.branch_id = ${len(tp)}::uuid"
    vt = await fetchrow(
        f"""SELECT COALESCE(SUM(CASE WHEN v.type='receipt' THEN v.amount ELSE -v.amount END),0) AS net
            FROM treasury_vouchers v WHERE v.company_id=$1 AND v.status <> 'cancelled'
              AND (v.created_at AT TIME ZONE 'Asia/Riyadh')::date BETWEEN $2 AND $3{tbc}""", *tp)
    cash_codes = [PAYMENT_ACCOUNT_CODES["cash"], PAYMENT_ACCOUNT_CODES["card"], PAYMENT_ACCOUNT_CODES["transfer"]]
    jt = await fetchrow(
        f"""SELECT COALESCE(SUM(jl.debit - jl.credit),0) AS net
            FROM journal_lines jl JOIN journal_entries je ON je.id = jl.entry_id JOIN accounts a ON a.id = jl.account_id
            WHERE je.company_id=$1 AND a.company_id=$1 AND je.entry_date BETWEEN $2 AND $3
              AND je.source_type IN ('treasury_voucher','treasury_voucher_cancel') AND a.code = ANY(${len(tp) + 1}::text[]){tjc}""", *tp, cash_codes)
    add("treasury", "الخزينة (صافي القبض − الصرف)", _num(vt["net"]), _num(jt["net"]),
        "صافي سندات الخزينة غير الملغاة مقابل حركة حسابات النقد/الشبكة/التحويل الناتجة عن قيود السندات (يشمل قيود الإلغاء). إلغاء سند بتاريخ مختلف عن إصداره يُفسّر فرقاً مؤقتاً.")
    # ── المخزون: قيمة الأرصدة الحالية بتكلفة الصنف مقابل رصيد حساب المخزون — يُقارن فقط حين تنتهي الفترة اليوم ──
    from .center import riyadh_today
    inv_item = {"key": "inventory", "label": "قيمة المخزون (الرصيد الحالي)",
                "note": "قيمة الأرصدة الحالية × تكلفة الصنف الحالية، مقابل رصيد حساب المخزون في الأستاذ حتى نهاية الفترة. الفرق شائع عند وجود رصيد افتتاحي بلا قيد أو تغيّر تكلفة الأصناف أو تسويات جرد لم تُرحَّل محاسبياً."}
    if t != riyadh_today():
        checks.append({**inv_item, "invoices": None, "ledger": None, "diff": None, "ok": None,
                       "note": "لا يمكن مقارنة المخزون إلا والفترة تنتهي اليوم (أرصدة المخزون لحظية وليست تاريخية)."})
    else:
        ip: list = [user.company_id]
        ibc2 = ""
        if branch:
            ip.append(branch); ibc2 = f" AND inv.loc_id = ${len(ip)}"
        sv = await fetchrow(
            f"""SELECT COALESCE(SUM(inv.qty * COALESCE(p.cost_price,0)),0) AS v FROM inventory inv JOIN products p ON p.id = inv.product_id
                WHERE inv.company_id=$1{ibc2}""", *ip)
        gp: list = [user.company_id, t, ACCOUNT_CODES["INVENTORY"]]
        gbc = ""
        if branch:
            gp.append(branch); gbc = f" AND je.branch_id = ${len(gp)}::uuid"
        gl = await fetchrow(
            f"""SELECT COALESCE(SUM(jl.debit - jl.credit),0) AS v
                FROM journal_lines jl JOIN journal_entries je ON je.id = jl.entry_id JOIN accounts a ON a.id = jl.account_id
                WHERE je.company_id=$1 AND a.company_id=$1 AND je.entry_date <= $2 AND a.code = $3{gbc}""", *gp)
        add(inv_item["key"], inv_item["label"], _num(sv["v"]), _num(gl["v"]), inv_item["note"])
    # ── الذمم: أرصدة دفاتر العملاء/الموردين حتى نهاية الفترة مقابل حسابي الذمم المدينة والدائنة (إجماليات الشركة) ──
    for key, label, table, acc_code, sign, note in (
        ("receivables", "الذمم المدينة (العملاء)", "customer_ledger", ACCOUNT_CODES["RECEIVABLES"], 1,
         "مجموع دفتر العملاء حتى نهاية الفترة مقابل رصيد حساب الذمم المدينة (مدين − دائن)."),
        ("payables", "الذمم الدائنة (الموردون)", "supplier_ledger", ACCOUNT_CODES["PAYABLES"], -1,
         "مجموع دفتر الموردين (المستحق لهم) حتى نهاية الفترة مقابل رصيد حساب الذمم الدائنة (دائن − مدين).")):
        if branch:
            checks.append({"key": key, "label": label, "invoices": None, "ledger": None, "diff": None, "ok": None,
                           "note": "دفاتر العملاء والموردين على مستوى الشركة — لا تُقارن لمستخدم مقيَّد بفرع."})
            continue
        sub = await fetchrow(
            f"""SELECT COALESCE(SUM(amount),0) AS v FROM {table}
                WHERE company_id=$1 AND (created_at AT TIME ZONE 'Asia/Riyadh')::date <= $2""", user.company_id, t)
        gl = await fetchrow(
            """SELECT COALESCE(SUM(jl.debit - jl.credit),0) AS v
               FROM journal_lines jl JOIN journal_entries je ON je.id = jl.entry_id JOIN accounts a ON a.id = jl.account_id
               WHERE je.company_id=$1 AND a.company_id=$1 AND je.entry_date <= $2 AND a.code = $3""", user.company_id, t, acc_code)
        add(key, label, _num(sub["v"]), sign * _num(gl["v"]), note)
    bad = [c for c in checks if c["ok"] is False]
    return {"meta": _meta(user, f, t, branch), "checks": checks, "fullReturnsInPeriod": full["n"],
            "status": "mismatch" if bad else "ok",
            "warning": ("يوجد فرق بين البيانات التشغيلية ودفتر الأستاذ في: " + "، ".join(c["label"] for c in bad) +
                        ". من الأسباب الشائعة: فواتير مرتجعة بالكامل عُكست قيودها بتاريخ مختلف، أو فواتير قبل ربط الحسابات، أو قيود يدوية على الحسابات نفسها. لا يُخفى الفرق — راجعه مع المحاسب.") if bad else None,
            "note": "فحص قراءة فقط: لا يعدّل أي قيد ولا فاتورة."}


def attach_compare(res: dict, prev: dict, mode: str, cr: tuple[dt.date, dt.date], metrics: list[str]) -> dict:
    """يُضيف مقارنة فترة بفترة على المجاميع (metrics = مفاتيح داخل totals). النسبة None لو لا أساس مقارنة."""
    res["compare"] = {"mode": mode, "from": cr[0].isoformat(), "to": cr[1].isoformat(), "totals": prev["totals"],
                      **{m: delta(_num(res["totals"].get(m)), _num(prev["totals"].get(m))) for m in metrics}}
    return res


# ══════════════════ مقارنة فترات لتقارير التحليلات القديمة (ضريبة / مبيعات / ربحية) ══════════════════

async def period_compare(user, kind: str, date_from, date_to, mode: str, branch_id=None) -> dict:
    """يستدعي نفس دوال التقارير القديمة للفترتين ويُرجع القيم والنسبة (الحساب في الخادم). النسبة None بلا أساس مقارنة."""
    from . import service
    f, t = parse_range(date_from, date_to)
    cr = compare_range(f, t, mode)
    if not cr:
        raise HTTPException(422, "نمط المقارنة: prev أو yoy")
    spec = {
        "vat": ("accounting.view_vat", None, ["outputVat", "inputVat", "netVat"]),
        "sales": ("reports.sales", None, ["totalInc", "totalEx", "invoiceCount", "grossProfit"]),
        "profit": ("accounting.view_reports", None, ["revenueEx", "cogs", "grossProfit"]),
    }
    if kind not in spec:
        raise HTTPException(422, "نوع التقرير غير مدعوم")
    perm = spec[kind][0]
    if not (user.has(perm) or (kind == "sales" and user.has("accounting.view_reports"))):
        raise HTTPException(403, "ليس لديك صلاحية لهذا الإجراء")

    async def run(a: dt.date, b: dt.date) -> dict:
        a_s, b_s = a.isoformat(), b.isoformat()
        if kind == "vat":
            return await service.vat_return(user.company_id, a_s, b_s)
        if kind == "sales":
            return (await service.sales_summary(user.company_id, a_s, b_s, _branch(user, branch_id), "day"))["totals"]
        return (await service.profitability(user.company_id, a_s, b_s, "category"))["totals"]
    cur_d, prev_d = await run(f, t), await run(*cr)
    metrics = {m: {"cur": round(_num(cur_d.get(m)), 2), **delta(_num(cur_d.get(m)), _num(prev_d.get(m)))} for m in spec[kind][2]}
    return {"kind": kind, "mode": mode, "from": f.isoformat(), "to": t.isoformat(), "prevFrom": cr[0].isoformat(), "prevTo": cr[1].isoformat(), "metrics": metrics,
            "note": "التقارير القديمة تقرأ التاريخ بتوقيت الخادم (UTC) — قد يختلف الرقم قرب منتصف الليل عن التقارير الجديدة."}
