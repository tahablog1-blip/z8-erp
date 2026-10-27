# modules/hr/overview.py — لوحة الموارد البشرية + ملف الموظف 360° (قراءة فقط)
# كل الأرقام تُحسب هنا من بيانات النظام الحقيقية؛ الواجهة تعرض فقط.
# الخصوصية: الأرقام المالية لا تظهر إلا لمن يملك hr.salary.view، والهوية مُقنَّعة لمن لا يملك hr.identity.view.
from datetime import date

from fastapi import HTTPException

from ...core.db import fetch, fetchrow
from . import service as S

_TODAY = "(now() AT TIME ZONE 'Asia/Riyadh')::date"


async def _advances(company_id: str, branch_scope: str | None, employee_id: str | None = None) -> dict:
    """جدول السلف قد لا يوجد في قواعد حديثة — نقرأه بحذر (لا نُنشئه ولا نكتب عليه)"""
    params: list = [company_id]
    sc = S.scope_clause(params, branch_scope)
    emp = ""
    if employee_id:
        params.append(employee_id); emp = f" AND a.employee_id = ${len(params)}::text::uuid"
    try:
        rows = await fetch(
            f"""SELECT a.id, a.employee_id, e.full_name AS employee_name, a.amount, a.installment, a.status, a.created_at,
                       a.amount - COALESCE((SELECT SUM(r.amount) FROM advance_repayments r WHERE r.advance_id = a.id), 0) AS balance
                FROM employee_advances a JOIN hr_employees e ON e.id = a.employee_id
                WHERE a.company_id=$1{sc}{emp} AND a.status='active'
                ORDER BY a.created_at DESC LIMIT 200""", *params)
    except Exception:
        return {"available": False, "count": 0, "total": 0, "balance": 0, "items": []}
    items = [{"id": str(r["id"]), "employeeId": str(r["employee_id"]), "employeeName": r["employee_name"],
              "amount": float(r["amount"]), "installment": float(r["installment"]),
              "balance": float(r["balance"]), "status": r["status"], "createdAt": r["created_at"]} for r in rows]
    return {"available": True, "count": len(items), "total": sum(i["amount"] for i in items),
            "balance": sum(i["balance"] for i in items), "items": items}


async def dashboard(company_id: str, branch_scope: str | None, viewer: dict) -> dict:
    p: list = [company_id]
    sc = S.scope_clause(p, branch_scope)

    emp = await fetchrow(
        f"""SELECT count(*)::int AS total,
                   count(*) FILTER (WHERE e.is_active)::int AS active,
                   count(*) FILTER (WHERE NOT e.is_active)::int AS terminated,
                   count(*) FILTER (WHERE e.is_active AND e.is_saudi)::int AS saudi,
                   count(*) FILTER (WHERE e.is_active AND NOT e.is_saudi)::int AS non_saudi,
                   count(*) FILTER (WHERE e.is_active AND e.schedule_id IS NULL)::int AS no_schedule
            FROM hr_employees e WHERE e.company_id=$1{sc}""", *p)

    on_leave = await fetchrow(
        f"""SELECT count(DISTINCT l.employee_id)::int AS n
            FROM hr_leave_requests l JOIN hr_employees e ON e.id = l.employee_id
            WHERE l.company_id=$1 AND l.status='approved' AND e.is_active{sc}
              AND {_TODAY} BETWEEN l.start_date AND l.end_date""", *p)

    # حضور اليوم: الحاضر/المتأخر/الغائب — فقط لمن له جدول دوام (غير ذلك «غير محدد» ولا يُحتسب غائباً)
    att = await fetchrow(
        f"""WITH emp AS (
              SELECT e.id, s.grace_minutes, s.weekly_off,
                     ((({_TODAY}) + s.start_time) AT TIME ZONE 'Asia/Riyadh') AS start_ts
              FROM hr_employees e LEFT JOIN hr_work_schedules s ON s.id = e.schedule_id
              WHERE e.company_id=$1 AND e.is_active{sc}),
            today AS (SELECT a.employee_id, a.check_in FROM hr_attendance a WHERE a.company_id=$1 AND a.work_date = {_TODAY}),
            lv AS (SELECT DISTINCT l.employee_id FROM hr_leave_requests l
                   WHERE l.company_id=$1 AND l.status='approved' AND {_TODAY} BETWEEN l.start_date AND l.end_date)
            SELECT
              count(*) FILTER (WHERE t.check_in IS NOT NULL)::int AS present,
              count(*) FILTER (WHERE t.check_in IS NOT NULL AND emp.start_ts IS NOT NULL
                               AND t.check_in > emp.start_ts + make_interval(mins => emp.grace_minutes))::int AS late,
              count(*) FILTER (WHERE t.check_in IS NULL AND emp.start_ts IS NOT NULL AND lv.employee_id IS NULL
                               AND NOT (EXTRACT(DOW FROM {_TODAY})::int = ANY(emp.weekly_off))
                               AND now() > emp.start_ts + make_interval(mins => emp.grace_minutes))::int AS absent
            FROM emp LEFT JOIN today t ON t.employee_id = emp.id LEFT JOIN lv ON lv.employee_id = emp.id""", *p)

    contracts = await fetchrow(
        f"""SELECT count(*) FILTER (WHERE c.end_date < {_TODAY})::int AS expired,
                   count(*) FILTER (WHERE c.end_date >= {_TODAY} AND c.end_date <= {_TODAY} + 30)::int AS d30,
                   count(*) FILTER (WHERE c.end_date > {_TODAY} + 30 AND c.end_date <= {_TODAY} + 60)::int AS d60,
                   count(*) FILTER (WHERE c.end_date > {_TODAY} + 60 AND c.end_date <= {_TODAY} + 90)::int AS d90
            FROM hr_contracts c JOIN hr_employees e ON e.id = c.employee_id
            WHERE c.company_id=$1 AND c.status='active' AND c.end_date IS NOT NULL AND e.is_active{sc}""", *p)

    docs = await fetchrow(
        f"""WITH all_docs AS (
              SELECT d.expiry_date FROM hr_documents d JOIN hr_employees e ON e.id = d.employee_id
              WHERE d.company_id=$1 AND d.expiry_date IS NOT NULL AND e.is_active{sc}
              UNION ALL
              SELECT e.iqama_expiry_date FROM hr_employees e
              WHERE e.company_id=$1 AND e.is_active AND e.iqama_expiry_date IS NOT NULL{sc})
            SELECT count(*) FILTER (WHERE expiry_date < {_TODAY})::int AS expired,
                   count(*) FILTER (WHERE expiry_date >= {_TODAY} AND expiry_date <= {_TODAY} + 30)::int AS d30,
                   count(*) FILTER (WHERE expiry_date > {_TODAY} + 30 AND expiry_date <= {_TODAY} + 60)::int AS d60
            FROM all_docs""", *p)

    pending_leave = await fetchrow(
        f"""SELECT count(*)::int AS n FROM hr_leave_requests l JOIN hr_employees e ON e.id = l.employee_id
            WHERE l.company_id=$1 AND l.status='pending'{sc}""", *p)
    recent_leave = await fetch(
        f"""SELECT l.id, l.leave_type, l.start_date, l.end_date, l.days_count, l.status, e.full_name AS employee_name
            FROM hr_leave_requests l JOIN hr_employees e ON e.id = l.employee_id
            WHERE l.company_id=$1{sc} ORDER BY l.created_at DESC LIMIT 6""", *p)

    # الرواتب: آخر مسير (المسير على مستوى الشركة) — الأرقام المالية لمن يملك hr.salary.view فقط
    last_run = await fetchrow(
        """SELECT r.id, r.period_month, r.period_year, r.status, r.created_at, r.paid_at,
                  (SELECT count(*) FROM hr_payslips p WHERE p.payroll_run_id = r.id)::int AS slips,
                  (SELECT COALESCE(SUM(p.net_pay),0) FROM hr_payslips p WHERE p.payroll_run_id = r.id) AS net_total
           FROM hr_payroll_runs r WHERE r.company_id=$1 ORDER BY r.period_year DESC, r.period_month DESC LIMIT 1""", company_id)
    payroll = None
    if viewer.get("payroll"):
        if last_run:
            m, y = last_run["period_month"], last_run["period_year"]
            nm, ny = (1, y + 1) if m == 12 else (m + 1, y)
            payroll = {"lastMonth": m, "lastYear": y, "lastStatus": last_run["status"], "slips": last_run["slips"],
                       "lastNetTotal": float(last_run["net_total"]) if viewer["salary"] else None,
                       "nextMonth": nm, "nextYear": ny, "activeEmployees": emp["active"]}
        else:
            t = date.today()
            payroll = {"lastMonth": None, "lastYear": None, "lastStatus": None, "slips": 0, "lastNetTotal": None,
                       "nextMonth": t.month, "nextYear": t.year, "activeEmployees": emp["active"]}

    adv = await _advances(company_id, branch_scope)
    if not viewer["salary"]:
        adv = {"available": adv["available"], "count": adv["count"], "total": None, "balance": None, "items": []}
    else:
        adv = {**adv, "items": []}

    hist = await fetch(
        f"""SELECT h.id, h.event_type, h.detail, h.reason, h.actor_name, h.created_at, e.full_name AS employee_name
            FROM hr_employee_history h JOIN hr_employees e ON e.id = h.employee_id
            WHERE h.company_id=$1{sc} ORDER BY h.created_at DESC LIMIT 8""", *p)

    return {
        "employees": dict(emp),
        "today": {"present": att["present"], "late": att["late"], "absent": att["absent"],
                  "onLeave": on_leave["n"], "noSchedule": emp["no_schedule"]},
        "contracts": dict(contracts),
        "documents": dict(docs),
        "leave": {"pending": pending_leave["n"],
                  "recent": [{**S._row_id(r)} for r in recent_leave]},
        "payroll": payroll,
        "advances": adv,
        "activity": [_hist_out(r, viewer) for r in hist],
        "viewer": {"salary": viewer["salary"], "identity": viewer["identity"]},
    }


def _hist_out(r, viewer: dict) -> dict:
    r = dict(r)
    r["id"] = str(r["id"])
    if not viewer["salary"] and r["event_type"] in ("salary_change", "bank_change", "contract_change"):
        r["detail"] = {}
    return r


async def employee_history(company_id: str, employee_id: str, branch_scope: str | None, viewer: dict, limit: int = 100) -> list[dict]:
    await S.assert_scope(company_id, employee_id, branch_scope)
    rows = await fetch(
        """SELECT id, event_type, detail, reason, actor_name, created_at FROM hr_employee_history
           WHERE company_id=$1 AND employee_id=$2::text::uuid ORDER BY created_at DESC LIMIT $3""",
        company_id, employee_id, min(limit, 300))
    return [_hist_out(r, viewer) for r in rows]


async def employee_360(company_id: str, employee_id: str, branch_scope: str | None, viewer: dict) -> dict:
    await S.assert_scope(company_id, employee_id, branch_scope)
    row = await fetchrow(
        """SELECT e.*, b.name AS branch_name, u.email AS linked_email, d.name AS department_name,
                  p.name AS position_name, m.full_name AS manager_name, s.name AS schedule_name,
                  s.start_time AS schedule_start, s.end_time AS schedule_end
           FROM hr_employees e
           LEFT JOIN branches b ON b.id = e.branch_id
           LEFT JOIN users u ON u.id = e.linked_user_id
           LEFT JOIN hr_departments d ON d.id = e.department_id
           LEFT JOIN hr_positions p ON p.id = e.position_id
           LEFT JOIN hr_employees m ON m.id = e.manager_id
           LEFT JOIN hr_work_schedules s ON s.id = e.schedule_id
           WHERE e.id=$1::text::uuid AND e.company_id=$2""", employee_id, company_id)
    if not row:
        raise HTTPException(404, "الموظف غير موجود")
    emp = S._emp_out(row, viewer)
    emp["manager_name"] = row["manager_name"]
    emp["schedule_name"] = row["schedule_name"]
    emp["schedule_start"] = row["schedule_start"]
    emp["schedule_end"] = row["schedule_end"]
    today = date.today()
    emp["service_years"] = round(((row["termination_date"] or today) - row["hire_date"]).days / 365.25, 2)

    from . import org
    contracts = await org.list_contracts(company_id, employee_id, branch_scope, viewer)
    documents = await org.list_documents(company_id, employee_id, branch_scope)
    attendance = await S.list_attendance(company_id, str(date.fromordinal(today.toordinal() - 29)), str(today), employee_id, branch_scope)
    summary = {
        "days": len(attendance),
        "late": sum(1 for a in attendance if a["day_status"] == "late"),
        "earlyLeave": sum(1 for a in attendance if a["day_status"] == "early_leave"),
        "workedMinutes": sum(a.get("worked_minutes") or 0 for a in attendance),
        "overtimeMinutes": sum(a.get("overtime_minutes") or 0 for a in attendance),
        "lateMinutes": sum(a.get("late_minutes") or 0 for a in attendance),
    }
    leaves = (await S.list_leave_requests(company_id, employee_id, None, branch_scope))[:20]
    balance = await S.leave_balance(company_id, employee_id, branch_scope)
    violations = (await S.list_violations(company_id, employee_id, branch_scope))[:20]
    if not viewer["salary"]:
        for v in violations:
            v["deduction_amount"] = None
    custody = (await S.list_custody_items(company_id, employee_id, None, branch_scope))[:50]
    adv = await _advances(company_id, branch_scope, employee_id)
    if not viewer["salary"]:
        adv = {"available": adv["available"], "count": adv["count"], "total": None, "balance": None, "items": []}

    payslips: list = []
    if viewer["salary"] and viewer.get("payroll"):
        rows = await fetch(
            """SELECT r.period_month, r.period_year, r.status, p.basic_salary, p.allowances, p.commission_amount,
                      p.violations_deduction, p.advance_deduction, p.gosi_employee, p.net_pay
               FROM hr_payslips p JOIN hr_payroll_runs r ON r.id = p.payroll_run_id
               WHERE p.employee_id=$1::text::uuid AND r.company_id=$2
               ORDER BY r.period_year DESC, r.period_month DESC LIMIT 12""", employee_id, company_id)
        payslips = [{k: (float(v) if hasattr(v, "quantize") else v) for k, v in dict(r).items()} for r in rows]

    return {
        "employee": emp, "contracts": contracts, "documents": documents,
        "attendance": {"summary": summary, "rows": attendance[:31]},
        "leave": {"balance": balance, "requests": leaves},
        "advances": adv, "violations": violations, "custody": custody,
        "payslips": payslips,
        "history": await employee_history(company_id, employee_id, branch_scope, viewer, 100),
    }
