# modules/hr/org.py — الهيكل التنظيمي والعقود والمستندات وجداول الدوام وإعدادات الموارد البشرية
# إضافات فقط: جداول مستقلة (hr_departments / hr_positions / hr_contracts / hr_documents / hr_work_schedules / hr_leave_types)
# لا تلمس منطق الرواتب أو المحاسبة. الراتب في العقد لا يظهر إلا لمن يملك hr.salary.view.
from datetime import date, time
from decimal import Decimal

import asyncpg
from fastapi import HTTPException

from ...core.db import execute, fetch, fetchrow, transaction
from . import service as S


def _out(r) -> dict:
    d = dict(r)
    for k, v in list(d.items()):
        if k == "id" or k.endswith("_id"):
            d[k] = str(v) if v else None
        elif isinstance(v, Decimal):
            d[k] = float(v)
    return d


# ══════════════════ الأقسام ══════════════════

async def list_departments(company_id: str) -> list[dict]:
    rows = await fetch(
        """SELECT d.*, (SELECT count(*) FROM hr_employees e WHERE e.department_id = d.id AND e.is_active)::int AS employees
           FROM hr_departments d WHERE d.company_id=$1 ORDER BY d.is_active DESC, d.name""", company_id)
    return [_out(r) for r in rows]


async def save_department(company_id: str, d: dict, dept_id: str | None = None) -> dict:
    name = (d.get("name") or "").strip()
    if len(name) < 2:
        raise HTTPException(400, "اسم القسم مطلوب")
    try:
        if dept_id:
            row = await fetchrow(
                """UPDATE hr_departments SET name=$3, is_active=COALESCE($4, is_active)
                   WHERE id=$1::text::uuid AND company_id=$2 RETURNING *""", dept_id, company_id, name, d.get("isActive"))
        else:
            row = await fetchrow("INSERT INTO hr_departments (company_id, name) VALUES ($1,$2) RETURNING *", company_id, name)
    except asyncpg.UniqueViolationError:
        raise HTTPException(409, "يوجد قسم بنفس الاسم")
    if not row:
        raise HTTPException(404, "القسم غير موجود")
    return _out(row)


# ══════════════════ الوظائف ══════════════════

async def list_positions(company_id: str) -> list[dict]:
    rows = await fetch(
        """SELECT p.*, d.name AS department_name,
                  (SELECT count(*) FROM hr_employees e WHERE e.position_id = p.id AND e.is_active)::int AS employees
           FROM hr_positions p LEFT JOIN hr_departments d ON d.id = p.department_id
           WHERE p.company_id=$1 ORDER BY p.is_active DESC, p.name""", company_id)
    return [_out(r) for r in rows]


async def save_position(company_id: str, d: dict, pos_id: str | None = None) -> dict:
    name = (d.get("name") or "").strip()
    if len(name) < 2:
        raise HTTPException(400, "المسمى الوظيفي مطلوب")
    dept = S._nz(d.get("departmentId"))
    if dept and not await fetchrow("SELECT 1 FROM hr_departments WHERE id=$1::text::uuid AND company_id=$2", dept, company_id):
        raise HTTPException(400, "القسم غير صالح")
    try:
        if pos_id:
            row = await fetchrow(
                """UPDATE hr_positions SET name=$3, department_id=$4::text::uuid, is_active=COALESCE($5, is_active)
                   WHERE id=$1::text::uuid AND company_id=$2 RETURNING *""", pos_id, company_id, name, dept, d.get("isActive"))
        else:
            row = await fetchrow(
                "INSERT INTO hr_positions (company_id, name, department_id) VALUES ($1,$2,$3::text::uuid) RETURNING *",
                company_id, name, dept)
    except asyncpg.UniqueViolationError:
        raise HTTPException(409, "توجد وظيفة بنفس المسمى")
    if not row:
        raise HTTPException(404, "الوظيفة غير موجودة")
    return _out(row)


# ══════════════════ جداول الدوام ══════════════════

def _t(v: str) -> time:
    try:
        return time.fromisoformat(v)
    except Exception:
        raise HTTPException(400, "صيغة الوقت غير صحيحة (HH:MM)")


async def list_schedules(company_id: str) -> list[dict]:
    rows = await fetch(
        """SELECT s.*, (SELECT count(*) FROM hr_employees e WHERE e.schedule_id = s.id AND e.is_active)::int AS employees
           FROM hr_work_schedules s WHERE s.company_id=$1 ORDER BY s.is_active DESC, s.name""", company_id)
    out = []
    for r in rows:
        o = _out(r)
        o["start_time"] = r["start_time"].strftime("%H:%M")
        o["end_time"] = r["end_time"].strftime("%H:%M")
        out.append(o)
    return out


async def save_schedule(company_id: str, d: dict, sched_id: str | None = None) -> dict:
    name = (d.get("name") or "").strip()
    if len(name) < 2:
        raise HTTPException(400, "اسم الجدول مطلوب")
    st, en = _t(d["startTime"]), _t(d["endTime"])
    grace = int(d.get("graceMinutes") or 0)
    off = sorted({int(x) for x in (d.get("weeklyOff") or [])})
    if grace < 0 or grace > 240 or any(x < 0 or x > 6 for x in off):
        raise HTTPException(400, "قيم غير صالحة (السماح 0–240 دقيقة، أيام العطلة 0–6 من الأحد)")
    try:
        if sched_id:
            row = await fetchrow(
                """UPDATE hr_work_schedules SET name=$3, start_time=$4, end_time=$5, grace_minutes=$6, weekly_off=$7,
                          is_active=COALESCE($8, is_active)
                   WHERE id=$1::text::uuid AND company_id=$2 RETURNING *""",
                sched_id, company_id, name, st, en, grace, off, d.get("isActive"))
        else:
            row = await fetchrow(
                """INSERT INTO hr_work_schedules (company_id, name, start_time, end_time, grace_minutes, weekly_off)
                   VALUES ($1,$2,$3,$4,$5,$6) RETURNING *""", company_id, name, st, en, grace, off)
    except asyncpg.UniqueViolationError:
        raise HTTPException(409, "يوجد جدول بنفس الاسم")
    if not row:
        raise HTTPException(404, "الجدول غير موجود")
    o = _out(row); o["start_time"] = st.strftime("%H:%M"); o["end_time"] = en.strftime("%H:%M")
    return o


# ══════════════════ العقود ══════════════════

async def list_contracts(company_id: str, employee_id: str | None, branch_scope: str | None, viewer: dict,
                         status: str | None = None, expiring_days: int | None = None) -> list[dict]:
    params: list = [company_id]
    where = ["c.company_id=$1"]
    where.append("TRUE" + S.scope_clause(params, branch_scope))
    if employee_id:
        params.append(employee_id); where.append(f"c.employee_id=${len(params)}::text::uuid")
    if status:
        params.append(status); where.append(f"c.status=${len(params)}")
    if expiring_days is not None:
        params.append(int(expiring_days))
        where.append(f"c.status='active' AND c.end_date IS NOT NULL AND c.end_date <= (now() AT TIME ZONE 'Asia/Riyadh')::date + ${len(params)}::int")
    rows = await fetch(
        f"""SELECT c.*, e.full_name AS employee_name,
                   CASE WHEN c.end_date IS NULL THEN NULL
                        ELSE (c.end_date - (now() AT TIME ZONE 'Asia/Riyadh')::date)::int END AS days_remaining
            FROM hr_contracts c JOIN hr_employees e ON e.id = c.employee_id
            WHERE {' AND '.join(where)} ORDER BY c.start_date DESC, c.created_at DESC""", *params)
    out = []
    for r in rows:
        o = _out(r)
        if not viewer["salary"]:
            o["basic_salary"] = None
        out.append(o)
    return out


async def create_contract(company_id: str, d: dict, branch_scope: str | None, actor: tuple, viewer: dict) -> dict:
    """عقد جديد لموظف: العقد النشط السابق يُنهى تلقائياً (تجديد) والسجل يحفظ التاريخ كاملاً — لا حذف أبداً"""
    emp_id = d["employeeId"]
    await S.assert_scope(company_id, emp_id, branch_scope)
    start = date.fromisoformat(d["startDate"])
    end = date.fromisoformat(d["endDate"]) if S._nz(d.get("endDate")) else None
    if end and end < start:
        raise HTTPException(400, "تاريخ نهاية العقد قبل بدايته")
    salary = Decimal(str(d.get("basicSalary") or 0)) if viewer["salary"] else Decimal("0")
    async with transaction() as conn:
        async with conn.transaction():
            prev = await conn.fetch(
                "SELECT id, start_date FROM hr_contracts WHERE company_id=$1 AND employee_id=$2::text::uuid AND status='active'",
                company_id, emp_id)
            for p in prev:
                await conn.execute(
                    """UPDATE hr_contracts SET status='ended',
                              end_date = COALESCE(end_date, GREATEST($2::date - 1, start_date)) WHERE id=$1""", p["id"], start)
            row = await conn.fetchrow(
                """INSERT INTO hr_contracts (company_id, employee_id, contract_type, start_date, end_date, basic_salary, notes, created_by)
                   VALUES ($1,$2::text::uuid,$3,$4,$5,$6,$7,$8::text::uuid) RETURNING *""",
                company_id, emp_id, d.get("contractType", "full_time"), start, end, salary, S._nz(d.get("notes")), actor[0])
    await S.log_event(company_id, emp_id, "contract_new" if not prev else "contract_renewal",
                      {"type": d.get("contractType", "full_time"), "start": start, "end": end}, actor)
    o = _out(row)
    o["days_remaining"] = (end - date.today()).days if end else None
    if not viewer["salary"]:
        o["basic_salary"] = None
    return o


async def end_contract(company_id: str, contract_id: str, branch_scope: str | None, actor: tuple, reason: str | None) -> dict:
    cur = await fetchrow("SELECT * FROM hr_contracts WHERE id=$1::text::uuid AND company_id=$2", contract_id, company_id)
    if not cur:
        raise HTTPException(404, "العقد غير موجود")
    await S.assert_scope(company_id, str(cur["employee_id"]), branch_scope)
    row = await fetchrow(
        """UPDATE hr_contracts SET status='ended', end_date=COALESCE(end_date, (now() AT TIME ZONE 'Asia/Riyadh')::date)
           WHERE id=$1::text::uuid RETURNING *""", contract_id)
    await S.log_event(company_id, str(cur["employee_id"]), "contract_end", {}, actor, reason)
    return _out(row)


# ══════════════════ المستندات ══════════════════

async def list_documents(company_id: str, employee_id: str | None, branch_scope: str | None,
                         expiring_days: int | None = None) -> list[dict]:
    params: list = [company_id]
    where = ["d.company_id=$1", "TRUE" + S.scope_clause(params, branch_scope)]
    if employee_id:
        params.append(employee_id); where.append(f"d.employee_id=${len(params)}::text::uuid")
    if expiring_days is not None:
        params.append(int(expiring_days))
        where.append(f"d.expiry_date IS NOT NULL AND d.expiry_date <= (now() AT TIME ZONE 'Asia/Riyadh')::date + ${len(params)}::int")
    rows = await fetch(
        f"""SELECT d.*, e.full_name AS employee_name,
                   CASE WHEN d.expiry_date IS NULL THEN NULL
                        ELSE (d.expiry_date - (now() AT TIME ZONE 'Asia/Riyadh')::date)::int END AS days_remaining
            FROM hr_documents d JOIN hr_employees e ON e.id = d.employee_id
            WHERE {' AND '.join(where)} ORDER BY d.expiry_date NULLS LAST, d.created_at DESC""", *params)
    return [_out(r) for r in rows]


async def save_document(company_id: str, d: dict, branch_scope: str | None, actor: tuple, doc_id: str | None = None) -> dict:
    dtype = (d.get("docType") or "").strip()
    if not dtype:
        raise HTTPException(400, "نوع المستند مطلوب")
    issue = date.fromisoformat(d["issueDate"]) if S._nz(d.get("issueDate")) else None
    expiry = date.fromisoformat(d["expiryDate"]) if S._nz(d.get("expiryDate")) else None
    if issue and expiry and expiry < issue:
        raise HTTPException(400, "تاريخ الانتهاء قبل الإصدار")
    if doc_id:
        cur = await fetchrow("SELECT employee_id FROM hr_documents WHERE id=$1::text::uuid AND company_id=$2", doc_id, company_id)
        if not cur:
            raise HTTPException(404, "المستند غير موجود")
        await S.assert_scope(company_id, str(cur["employee_id"]), branch_scope)
        row = await fetchrow(
            """UPDATE hr_documents SET doc_type=$3, doc_number=$4, issue_date=$5, expiry_date=$6, notes=$7
               WHERE id=$1::text::uuid AND company_id=$2 RETURNING *""",
            doc_id, company_id, dtype, S._nz(d.get("docNumber")), issue, expiry, S._nz(d.get("notes")))
    else:
        await S.assert_scope(company_id, d["employeeId"], branch_scope)
        row = await fetchrow(
            """INSERT INTO hr_documents (company_id, employee_id, doc_type, doc_number, issue_date, expiry_date, notes, created_by)
               VALUES ($1,$2::text::uuid,$3,$4,$5,$6,$7,$8::text::uuid) RETURNING *""",
            company_id, d["employeeId"], dtype, S._nz(d.get("docNumber")), issue, expiry, S._nz(d.get("notes")), actor[0])
    await S.log_event(company_id, str(row["employee_id"]), "document_" + ("update" if doc_id else "add"), {"type": dtype}, actor)
    return _out(row)


# ══════════════════ أنواع الإجازات + إعدادات الموارد البشرية ══════════════════

async def list_leave_types(company_id: str) -> list[dict]:
    return [_out(r) for r in await fetch("SELECT * FROM hr_leave_types WHERE company_id=$1 ORDER BY name", company_id)]


async def save_leave_type(company_id: str, d: dict, type_id: str | None = None) -> dict:
    name = (d.get("name") or "").strip()
    code = (d.get("code") or "").strip().lower()
    if len(name) < 2:
        raise HTTPException(400, "اسم نوع الإجازة مطلوب")
    if not type_id:
        if not code or not code.replace("_", "").isalnum() or code in S._BASE_LEAVE:
            raise HTTPException(400, "رمز النوع: حروف/أرقام إنجليزية، وغير مكرر مع الأنواع الأساسية")
    days = d.get("annualDays")
    days = int(days) if days not in (None, "") else None
    if days is not None and (days < 0 or days > 365):
        raise HTTPException(400, "الحصة السنوية غير صالحة")
    try:
        if type_id:
            row = await fetchrow(
                """UPDATE hr_leave_types SET name=$3, annual_days=$4, is_paid=COALESCE($5,is_paid), is_active=COALESCE($6,is_active)
                   WHERE id=$1::text::uuid AND company_id=$2 RETURNING *""",
                type_id, company_id, name, days, d.get("isPaid"), d.get("isActive"))
        else:
            row = await fetchrow(
                """INSERT INTO hr_leave_types (company_id, code, name, annual_days, is_paid)
                   VALUES ($1,$2,$3,$4,COALESCE($5,TRUE)) RETURNING *""", company_id, code, name, days, d.get("isPaid"))
    except asyncpg.UniqueViolationError:
        raise HTTPException(409, "الرمز مستخدم")
    if not row:
        raise HTTPException(404, "النوع غير موجود")
    return _out(row)


async def get_settings(company_id: str) -> dict:
    r = await S._company_hr_cfg(company_id)
    gp = await fetchrow(
        "SELECT gosi_saudi_employee_pct, gosi_saudi_employer_pct, gosi_nonsaudi_employer_pct FROM companies WHERE id=$1", company_id)
    return {**{k: float(v) if isinstance(v, Decimal) else v for k, v in r.items()},
            **{k: float(v) for k, v in dict(gp).items()}}


_SETTINGS = {
    "eosFirstYearsMonths": ("eos_first_years_months", 0, 3), "eosAfterMonths": ("eos_after_months", 0, 3),
    "eosThresholdYears": ("eos_threshold_years", 0, 40), "leaveDaysBefore": ("leave_days_before", 0, 365),
    "leaveDaysAfter": ("leave_days_after", 0, 365), "leaveThresholdYears": ("leave_threshold_years", 0, 40),
    "gosiSaudiEmployeePct": ("gosi_saudi_employee_pct", 0, 100), "gosiSaudiEmployerPct": ("gosi_saudi_employer_pct", 0, 100),
    "gosiNonsaudiEmployerPct": ("gosi_nonsaudi_employer_pct", 0, 100),
}


async def update_settings(company_id: str, d: dict, actor: tuple) -> dict:
    sets, vals = [], [company_id]
    for key, (col, lo, hi) in _SETTINGS.items():
        if d.get(key) is None:
            continue
        v = Decimal(str(d[key]))
        if v < lo or v > hi:
            raise HTTPException(400, f"القيمة خارج النطاق المسموح: {key}")
        vals.append(v); sets.append(f"{col}=${len(vals)}")
    if d.get("gosiBasis") is not None:
        if d["gosiBasis"] not in ("basic", "basic_allowances"):
            raise HTTPException(400, "وعاء التأمينات غير صالح")
        vals.append(d["gosiBasis"]); sets.append(f"gosi_basis=${len(vals)}")
    if not sets:
        raise HTTPException(400, "لا يوجد ما يُحدَّث")
    before = await get_settings(company_id)
    await execute(f"UPDATE companies SET {', '.join(sets)} WHERE id=$1", *vals)
    after = await get_settings(company_id)
    changed = {k: {"before": before.get(k), "after": after.get(k)} for k in after if before.get(k) != after.get(k)}
    try:
        import json
        await execute(
            "INSERT INTO audit_log (company_id, actor_id, actor_name, action, scope, details) VALUES ($1,$2,$3,'hr_settings_change','hr',$4)",
            company_id, actor[0], actor[1], json.dumps(changed, default=str))
    except Exception as e:
        print(f"⚠ hr settings audit: {e}")
    return after
