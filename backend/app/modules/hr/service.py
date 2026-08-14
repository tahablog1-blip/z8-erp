# modules/hr/service.py — منطق الأعمال معزول عن طبقة الـ HTTP
# منقول من hr.routes.js بالحرف — نفس صيغة $1
#
# ⚠ حساب مكافأة نهاية الخدمة، نسب التأمينات (GOSI)، ورصيد الإجازة السنوي
# كلها تقديرية حسب القواعد العامة — لازم تُراجَع مع محاسب/مستشار قانوني
# قبل أي صرف فعلي (نفس تحذير النظام الأصلي بالحرف).
from datetime import date, datetime
from decimal import Decimal

import asyncpg
from fastapi import HTTPException

from ...core.db import execute, fetch, fetchrow, transaction


def _num(v) -> float:
    return float(v) if isinstance(v, Decimal) else (v or 0)


def _row_id(r: dict) -> dict:
    r = dict(r)
    r["id"] = str(r["id"])
    for k in ("branch_id", "linked_user_id", "employee_id", "approved_by", "issued_by", "payroll_run_id"):
        if r.get(k):
            r[k] = str(r[k])
    return r


# ══════════════════ الموظفون ══════════════════

async def list_employees(company_id: str, branch_scope: str | None, branch_id_param: str | None) -> list[dict]:
    branch_id = branch_scope or branch_id_param
    params: list = [company_id]
    branch_filter = ""
    if branch_id:
        params.append(branch_id)
        branch_filter = f" AND e.branch_id = ${len(params)}"
    rows = await fetch(
        f"""SELECT e.*, b.name AS branch_name, u.email AS linked_email
            FROM hr_employees e
            LEFT JOIN branches b ON b.id = e.branch_id
            LEFT JOIN users u ON u.id = e.linked_user_id
            WHERE e.company_id = $1{branch_filter}
            ORDER BY e.is_active DESC, e.full_name""",
        *params,
    )
    out = []
    for r in rows:
        r = _row_id(r)
        r["basic_salary"] = _num(r["basic_salary"])
        r["allowances"] = _num(r.get("allowances"))
        out.append(r)
    return out


def _nz(v):
    """الفراغ القادم من نماذج الويب = NULL — يمنع انفجار أعمدة uuid/date بالسلاسل الفارغة"""
    return None if v in ("", None) else v


async def _validate_linked_user(company_id: str, user_id, exclude_employee_id: str | None = None):
    """حارس الربط: المدير العام (admin) لا يُربَط بموظف — وحساب الدخول الواحد لموظف واحد فقط.
    يعمل على مستوى السيرفر فلا يمكن تجاوزه من أي واجهة."""
    if not user_id:
        return
    u = await fetchrow("SELECT id, role, full_name FROM users WHERE id=$1::uuid AND company_id=$2",
                       user_id, company_id)
    if not u:
        raise HTTPException(400, "حساب الدخول المحدد غير موجود")
    if u["role"] == "admin":
        raise HTTPException(400, "لا يمكن ربط المدير العام بسجل موظف — حسابه فوق هيكل الموظفين")
    params = [user_id, company_id]
    q = "SELECT full_name FROM hr_employees WHERE linked_user_id=$1::uuid AND company_id=$2"
    if exclude_employee_id:
        q += " AND id<>$3::uuid"
        params.append(exclude_employee_id)
    taken = await fetchrow(q, *params)
    if taken:
        raise HTTPException(400, f"هذا الحساب مرتبط بالفعل بالموظف: {taken['full_name']}")


def _clean_pin(v) -> str | None:
    """رمز الاعتماد: 4-6 أرقام أو لا شيء — الفراغ يعني إزالة الرمز"""
    v = (v or "").strip()
    if not v:
        return None
    if not (v.isdigit() and 4 <= len(v) <= 6):
        raise HTTPException(400, "رمز الاعتماد يجب أن يكون من 4 إلى 6 أرقام")
    return v


async def create_employee(company_id: str, branch_scope: str | None, d: dict) -> dict:
    if branch_scope and d.get("branchId") and d["branchId"] != branch_scope:
        raise HTTPException(403, "غير مسموح لك بالعمل على فرع غير الفرع المخصّص لك")
    await _validate_linked_user(company_id, _nz(d.get("linkedUserId")))
    try:
        row = await fetchrow(
            """INSERT INTO hr_employees
                 (company_id, branch_id, linked_user_id, full_name, national_id, nationality,
                  is_saudi, birth_date, phone, job_title, contract_type, hire_date, basic_salary,
                  iban, iqama_number, iqama_expiry_date, tech_role, approval_pin, allowances)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8::text::date,$9,$10,$11,COALESCE($12::text::date,CURRENT_DATE),$13,$14,$15,$16::text::date,$17,$18,$19)
               RETURNING *""",
            company_id, _nz(branch_scope or d.get("branchId")), _nz(d.get("linkedUserId")), d["fullName"],
            _nz(d.get("nationalId")), _nz(d.get("nationality")), d.get("isSaudi", False), _nz(d.get("birthDate")),
            _nz(d.get("phone")), _nz(d.get("jobTitle")), d.get("contractType", "full_time"), _nz(d.get("hireDate")),
            Decimal(str(d.get("basicSalary") or 0)), _nz(d.get("iban")), _nz(d.get("iqamaNumber")), _nz(d.get("iqamaExpiryDate")),
            _nz(d.get("techRole")), _clean_pin(d.get("approvalPin")),
            Decimal(str(d.get("allowances") or 0)),
        )
    except asyncpg.UniqueViolationError as e:
        if "approval_pin" in str(e):
            raise HTTPException(400, "رمز الاعتماد هذا مستخدم لموظف آخر — اختر رقماً مختلفاً")
        raise
    r = _row_id(row); r["basic_salary"] = _num(r["basic_salary"]); r["allowances"] = _num(r.get("allowances"))
    return r


_EMP_COL_MAP = {
    "branchId": "branch_id", "linkedUserId": "linked_user_id", "fullName": "full_name",
    "nationalId": "national_id", "nationality": "nationality", "isSaudi": "is_saudi",
    "birthDate": "birth_date", "phone": "phone", "jobTitle": "job_title",
    "contractType": "contract_type", "hireDate": "hire_date", "basicSalary": "basic_salary",
    "iban": "iban", "iqamaNumber": "iqama_number", "iqamaExpiryDate": "iqama_expiry_date",
    "techRole": "tech_role", "approvalPin": "approval_pin", "allowances": "allowances",
}

# أعمدة التاريخ — لازم تتحول بالكاست ::text::date في التحديث (سبب خطأ toordinal)
_EMP_DATE_KEYS = {"birthDate", "hireDate", "iqamaExpiryDate"}


async def update_employee(company_id: str, employee_id: str, fields: dict) -> dict:
    keys = [k for k in fields if k in _EMP_COL_MAP]
    if not keys:
        raise HTTPException(400, "لا يوجد ما يُحدَّث")
    if "linkedUserId" in fields:
        await _validate_linked_user(company_id, _nz(fields["linkedUserId"]), employee_id)
    # أعمدة التاريخ بتوصل نصوص من الويب — الكاست في SQL نفسه بنمط المشروع الثابت،
    # والفراغ يتطبّع NULL قبلها — دا كان سبب DataError: 'str' has no attribute 'toordinal'
    set_parts = [
        f"{_EMP_COL_MAP[k]} = ${i}::text::date" if k in _EMP_DATE_KEYS
        else f"{_EMP_COL_MAP[k]} = ${i}"
        for i, k in enumerate(keys, start=3)
    ]
    set_parts.append("updated_at = now()")
    def _val(k):
        if k in ("basicSalary", "allowances"):
            return Decimal(str(fields[k] or 0))
        if k == "approvalPin":
            return _clean_pin(fields[k])
        return _nz(fields[k])
    values = [_val(k) for k in keys]
    try:
        row = await fetchrow(
            f"""UPDATE hr_employees SET {', '.join(set_parts)}
                WHERE id=$1 AND company_id=$2 RETURNING *""",
            employee_id, company_id, *values,
        )
    except asyncpg.UniqueViolationError as e:
        if "approval_pin" in str(e):
            raise HTTPException(400, "رمز الاعتماد هذا مستخدم لموظف آخر — اختر رقماً مختلفاً")
        raise
    if not row:
        raise HTTPException(404, "الموظف غير موجود")
    r = _row_id(row); r["basic_salary"] = _num(r["basic_salary"]); r["allowances"] = _num(r.get("allowances"))
    return r


def _calc_end_of_service(basic_salary: float, hire_date: date, termination_date: date) -> dict:
    """تقدير مكافأة نهاية الخدمة: نص شهر عن كل سنة من أول 5 سنين، شهر كامل بعد كده.
    ⚠ تقدير مبسّط لحالة "انتهاء الخدمة العادي" فقط — ما بياخدش في الاعتبار الاستقالة
    أو الفصل التأديبي أو انقطاعات العقد. لازم يُراجَع قبل أي صرف فعلي."""
    total_days = (termination_date - hire_date).days
    total_years = total_days / 365.25
    if total_years <= 0:
        return {"totalYears": 0, "amount": 0, "note": "مدة الخدمة صفر أو غير صالحة"}
    first5 = min(total_years, 5)
    after5 = max(total_years - 5, 0)
    amount = round((first5 * basic_salary * 0.5) + (after5 * basic_salary), 2)
    return {
        "totalYears": round(total_years, 2), "amount": amount,
        "note": "تقدير أولي حسب حالة إنهاء الخدمة العادي فقط — راجعه مع محاسبك قبل الصرف الفعلي",
    }


async def terminate_employee(company_id: str, employee_id: str, termination_date: str | None) -> dict:
    term_date = date.fromisoformat(termination_date) if termination_date else date.today()
    emp = await fetchrow("SELECT * FROM hr_employees WHERE id=$1 AND company_id=$2", employee_id, company_id)
    if not emp:
        raise HTTPException(404, "الموظف غير موجود")

    await execute(
        "UPDATE hr_employees SET is_active=FALSE, termination_date=$1, updated_at=now() WHERE id=$2",
        term_date, employee_id,
    )
    eos = _calc_end_of_service(_num(emp["basic_salary"]), emp["hire_date"], term_date)
    return {"success": True, "endOfServiceEstimate": eos}


async def iqama_alerts(company_id: str, days_ahead: int) -> list[dict]:
    days_ahead = min(max(days_ahead, 1), 365)
    rows = await fetch(
        """SELECT e.id, e.full_name, e.iqama_number, e.iqama_expiry_date, e.phone, b.name AS branch_name,
                  (e.iqama_expiry_date - CURRENT_DATE)::int AS days_remaining
           FROM hr_employees e
           LEFT JOIN branches b ON b.id = e.branch_id
           WHERE e.company_id = $1 AND e.is_active = TRUE AND e.iqama_expiry_date IS NOT NULL
             AND (e.iqama_expiry_date - CURRENT_DATE) <= $2
           ORDER BY e.iqama_expiry_date ASC""",
        company_id, days_ahead,
    )
    return [_row_id(r) for r in rows]


# ══════════════════ الحضور والانصراف ══════════════════

async def list_attendance(company_id: str, date_from: str | None, date_to: str | None,
                          employee_id: str | None) -> list[dict]:
    conditions = ["a.company_id = $1"]
    params: list = [company_id]
    if date_from:
        params.append(date_from); conditions.append(f"a.work_date >= ${len(params)}::text::date")
    if date_to:
        params.append(date_to); conditions.append(f"a.work_date <= ${len(params)}::text::date")
    if employee_id:
        params.append(employee_id); conditions.append(f"a.employee_id = ${len(params)}")
    rows = await fetch(
        f"""SELECT a.*, e.full_name AS employee_name
            FROM hr_attendance a JOIN hr_employees e ON e.id = a.employee_id
            WHERE {' AND '.join(conditions)}
            ORDER BY a.work_date DESC, e.full_name LIMIT 500""",
        *params,
    )
    return [_row_id(r) for r in rows]


async def check_in(company_id: str, user_id: str, employee_id: str) -> dict:
    row = await fetchrow(
        """INSERT INTO hr_attendance (company_id, employee_id, work_date, check_in, created_by)
           VALUES ($1,$2,CURRENT_DATE,now(),$3)
           ON CONFLICT (employee_id, work_date)
           DO UPDATE SET check_in = COALESCE(hr_attendance.check_in, EXCLUDED.check_in)
           RETURNING *""",
        company_id, employee_id, user_id,
    )
    return _row_id(row)


async def check_out(company_id: str, employee_id: str) -> dict:
    row = await fetchrow(
        """UPDATE hr_attendance SET check_out = now()
           WHERE company_id=$1 AND employee_id=$2 AND work_date=CURRENT_DATE
           RETURNING *""",
        company_id, employee_id,
    )
    if not row:
        raise HTTPException(404, "لا يوجد تسجيل حضور اليوم لهذا الموظف")
    return _row_id(row)


# ══════════════════ الإجازات ══════════════════

async def list_leave_requests(company_id: str, employee_id: str | None, status: str | None) -> list[dict]:
    conditions = ["l.company_id = $1"]
    params: list = [company_id]
    if employee_id:
        params.append(employee_id); conditions.append(f"l.employee_id = ${len(params)}")
    if status:
        params.append(status); conditions.append(f"l.status = ${len(params)}")
    rows = await fetch(
        f"""SELECT l.*, e.full_name AS employee_name, u.full_name AS approved_by_name
            FROM hr_leave_requests l
            JOIN hr_employees e ON e.id = l.employee_id
            LEFT JOIN users u ON u.id = l.approved_by
            WHERE {' AND '.join(conditions)}
            ORDER BY l.created_at DESC""",
        *params,
    )
    return [_row_id(r) for r in rows]


async def create_leave_request(company_id: str, d: dict) -> dict:
    start = date.fromisoformat(d["startDate"])
    end = date.fromisoformat(d["endDate"])
    days = (end - start).days + 1
    if days < 1:
        raise HTTPException(400, "تاريخ النهاية لازم يكون بعد تاريخ البداية")
    row = await fetchrow(
        """INSERT INTO hr_leave_requests (company_id, employee_id, leave_type, start_date, end_date, days_count, reason)
           VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *""",
        company_id, d["employeeId"], d.get("leaveType", "annual"), start, end, days, d.get("reason"),
    )
    return _row_id(row)


async def decide_leave_request(company_id: str, user_id: str, leave_id: str, decision: str) -> dict:
    row = await fetchrow(
        """UPDATE hr_leave_requests SET status=$1, approved_by=$2, approved_at=now()
           WHERE id=$3 AND company_id=$4 AND status='pending' RETURNING *""",
        decision, user_id, leave_id, company_id,
    )
    if not row:
        raise HTTPException(404, "الطلب غير موجود أو تم البت فيه بالفعل")
    return _row_id(row)


async def leave_balance(company_id: str, employee_id: str) -> dict:
    """رصيد الإجازة السنوي التقريبي: 21 يوم/سنة لأول 5 سنين، 30 يوم بعدها
    (نظام العمل السعودي العام) — مطروح منه المُستخدم فعلياً هذا العام."""
    emp = await fetchrow("SELECT * FROM hr_employees WHERE id=$1 AND company_id=$2", employee_id, company_id)
    if not emp:
        raise HTTPException(404, "الموظف غير موجود")
    years_service = (date.today() - emp["hire_date"]).days / 365.25
    annual_entitlement = 30 if years_service >= 5 else 21

    used_row = await fetchrow(
        """SELECT COALESCE(SUM(days_count),0)::int AS used
           FROM hr_leave_requests
           WHERE employee_id=$1 AND leave_type='annual' AND status='approved'
             AND EXTRACT(YEAR FROM start_date) = EXTRACT(YEAR FROM CURRENT_DATE)""",
        employee_id,
    )
    used = used_row["used"]
    return {
        "employeeId": employee_id, "annualEntitlement": annual_entitlement,
        "used": used, "remaining": annual_entitlement - used,
        "note": "رصيد تقديري حسب نظام العمل السعودي العام — طابقه مع سجلاتك الرسمية",
    }


# ══════════════════ المخالفات ══════════════════

async def list_violations(company_id: str, employee_id: str | None) -> list[dict]:
    conditions = ["v.company_id = $1"]
    params: list = [company_id]
    if employee_id:
        params.append(employee_id); conditions.append(f"v.employee_id = ${len(params)}")
    rows = await fetch(
        f"""SELECT v.*, e.full_name AS employee_name, u.full_name AS issued_by_name
            FROM hr_violations v
            JOIN hr_employees e ON e.id = v.employee_id
            LEFT JOIN users u ON u.id = v.issued_by
            WHERE {' AND '.join(conditions)} ORDER BY v.violation_date DESC""",
        *params,
    )
    out = []
    for r in rows:
        r = _row_id(r); r["deduction_amount"] = _num(r["deduction_amount"])
        out.append(r)
    return out


async def create_violation(company_id: str, user_id: str, d: dict) -> dict:
    row = await fetchrow(
        """INSERT INTO hr_violations
             (company_id, employee_id, violation_date, violation_type, description, deduction_amount, issued_by)
           VALUES ($1,$2,COALESCE($3::text::date,CURRENT_DATE),$4,$5,$6,$7) RETURNING *""",
        company_id, d["employeeId"], d.get("violationDate"), d["violationType"],
        d.get("description"), Decimal(str(d.get("deductionAmount", 0))), user_id,
    )
    r = _row_id(row); r["deduction_amount"] = _num(r["deduction_amount"])
    return r


# ══════════════════ الرواتب ══════════════════

async def list_payroll_runs(company_id: str) -> list[dict]:
    rows = await fetch(
        """SELECT r.*, COUNT(p.id)::int AS payslip_count, COALESCE(SUM(p.net_pay),0)::numeric(12,2) AS total_net
           FROM hr_payroll_runs r LEFT JOIN hr_payslips p ON p.payroll_run_id = r.id
           WHERE r.company_id=$1 GROUP BY r.id ORDER BY r.period_year DESC, r.period_month DESC""",
        company_id,
    )
    out = []
    for r in rows:
        r = _row_id(r); r["total_net"] = _num(r["total_net"])
        out.append(r)
    return out


async def run_payroll(company_id: str, user_id: str, period_month: int, period_year: int) -> dict:
    async with transaction() as conn:
        async with conn.transaction():
            company = await conn.fetchrow(
                """SELECT gosi_saudi_employee_pct, gosi_saudi_employer_pct, gosi_nonsaudi_employer_pct
                   FROM companies WHERE id=$1""",
                company_id,
            )

            try:
                run = await conn.fetchrow(
                    """INSERT INTO hr_payroll_runs (company_id, period_month, period_year, created_by)
                       VALUES ($1,$2,$3,$4) RETURNING *""",
                    company_id, period_month, period_year, user_id,
                )
            except asyncpg.UniqueViolationError:
                raise HTTPException(409, "فيه دورة رواتب لنفس الشهر بالفعل")

            employees = await conn.fetch(
                "SELECT * FROM hr_employees WHERE company_id=$1 AND is_active=TRUE", company_id
            )

            # خصومات المخالفات لكل الموظفين باستعلام تجميعي واحد (بدل استعلام لكل موظف — N+1)
            viol_rows = await conn.fetch(
                """SELECT v.employee_id, COALESCE(SUM(v.deduction_amount),0)::numeric(12,2) AS total
                   FROM hr_violations v
                   JOIN hr_employees e ON e.id = v.employee_id
                   WHERE e.company_id=$1
                     AND EXTRACT(MONTH FROM v.violation_date)=$2
                     AND EXTRACT(YEAR FROM v.violation_date)=$3
                   GROUP BY v.employee_id""",
                company_id, period_month, period_year,
            )
            viol_map = {str(r["employee_id"]): Decimal(str(r["total"])) for r in viol_rows}

            slips = []
            for emp in employees:
                viol_deduction = viol_map.get(str(emp["id"]), Decimal("0.00"))
                basic = Decimal(str(emp["basic_salary"]))
                allowances = Decimal(str(emp["allowances"] if emp["allowances"] is not None else 0))
                if emp["is_saudi"]:
                    gosi_employee = (basic * Decimal(str(company["gosi_saudi_employee_pct"])) / 100).quantize(Decimal("0.01"))
                    gosi_employer = (basic * Decimal(str(company["gosi_saudi_employer_pct"])) / 100).quantize(Decimal("0.01"))
                else:
                    gosi_employee = Decimal("0.00")
                    gosi_employer = (basic * Decimal(str(company["gosi_nonsaudi_employer_pct"])) / 100).quantize(Decimal("0.01"))
                # ⚠ التأمينات محسوبة على الأساسي فقط — لو بدلاتك تدخل في وعاء GOSI راجعها مع محاسبك
                net_pay = (basic + allowances - viol_deduction - gosi_employee).quantize(Decimal("0.01"))
                slips.append((run["id"], emp["id"], basic, allowances, viol_deduction,
                              gosi_employee, gosi_employer, net_pay))

            # إدخال كل القسائم دفعة واحدة
            if slips:
                await conn.executemany(
                    """INSERT INTO hr_payslips
                         (payroll_run_id, employee_id, basic_salary, allowances, violations_deduction,
                          gosi_employee, gosi_employer, net_pay)
                       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)""",
                    slips,
                )

    payslips = await get_payslips(company_id, str(run["id"]))
    run_out = _row_id(run)
    return {"run": run_out, "payslips": payslips}


async def get_payslips(company_id: str, run_id: str) -> list[dict]:
    rows = await fetch(
        """SELECT p.*, e.full_name AS employee_name, e.job_title, e.iban
           FROM hr_payslips p JOIN hr_employees e ON e.id = p.employee_id
           WHERE p.payroll_run_id=$1 ORDER BY e.full_name""",
        run_id,
    )
    out = []
    for r in rows:
        r = _row_id(r)
        for k in ("basic_salary", "allowances", "violations_deduction", "other_deductions",
                 "gosi_employee", "gosi_employer", "net_pay"):
            r[k] = _num(r[k])
        out.append(r)
    return out


async def finalize_payroll_run(company_id: str, run_id: str) -> dict:
    row = await fetchrow(
        """UPDATE hr_payroll_runs SET status='finalized', finalized_at=now()
           WHERE id=$1 AND company_id=$2 AND status='draft' RETURNING *""",
        run_id, company_id,
    )
    if not row:
        raise HTTPException(404, "الدورة غير موجودة أو مُعتمدة بالفعل")
    return _row_id(row)
