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

from ..treasury import service as _treasury
from ...core import notify
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


# ══════════════════ مساعدات: نطاق الفرع، سجل الحركة والتدقيق، إخفاء الحساس ══════════════════

SALARY_KEYS = {"basicSalary", "allowances", "housingAllowance", "transportAllowance", "otherAllowance",
               "iban", "commissionType", "commissionPct"}
IDENTITY_KEYS = {"nationalId", "iqamaNumber", "iqamaExpiryDate"}


def scope_clause(params: list, branch_scope: str | None, alias: str = "e") -> str:
    """مستخدم مقيَّد بفرع يرى موظفي فرعه فقط (الأدمن/غير المقيَّد: بلا قيد)"""
    if not branch_scope:
        return ""
    params.append(branch_scope)
    return f" AND {alias}.branch_id = ${len(params)}::text::uuid"


async def assert_scope(company_id: str, employee_id: str, branch_scope: str | None) -> None:
    """موظف خارج فرع المستخدم أو غير موجود → 404 (لا نكشف وجوده)"""
    row = await fetchrow("SELECT branch_id FROM hr_employees WHERE id=$1::text::uuid AND company_id=$2",
                         employee_id, company_id)
    if not row or (branch_scope and str(row["branch_id"] or "") != branch_scope):
        raise HTTPException(404, "الموظف غير موجود")


def _mask_id(v):
    if not v:
        return v
    v = str(v)
    return "•" * max(len(v) - 4, 0) + v[-4:]


def mask_employee(r: dict, *, salary: bool = True, identity: bool = True, manage: bool = True) -> dict:
    """الحقول الحساسة تُحجب بالخادم — الواجهة لا تُحجب شيئاً بنفسها"""
    if not salary:
        for k in ("basic_salary", "allowances", "housing_allowance", "transport_allowance",
                  "other_allowance", "iban", "commission_pct"):
            if k in r:
                r[k] = None
    if not identity:
        for k in ("national_id", "iqama_number"):
            if k in r:
                r[k] = _mask_id(r[k])
    if not manage and "approval_pin" in r:
        r["approval_pin"] = None
    return r


async def log_event(company_id: str, employee_id: str, event: str, detail: dict | None = None,
                    actor: tuple[str | None, str | None] = (None, None), reason: str | None = None) -> None:
    """سجل حركة الموظف + أثر في سجل التدقيق العام (بدون أرقام هوية أو آيبان)"""
    import json
    actor_id, actor_name = actor
    try:
        await execute(
            """INSERT INTO hr_employee_history (company_id, employee_id, event_type, detail, reason, actor_id, actor_name)
               VALUES ($1,$2::text::uuid,$3,$4::jsonb,$5,$6,$7)""",
            company_id, employee_id, event, json.dumps(detail or {}, default=str), reason, actor_id, actor_name,
        )
        await execute(
            """INSERT INTO audit_log (company_id, actor_id, actor_name, action, scope, details)
               VALUES ($1,$2,$3,$4,'hr',$5)""",
            company_id, actor_id, actor_name, f"hr_{event}", f"employee={employee_id}" + (f" — {reason}" if reason else ""),
        )
    except Exception as e:   # التدقيق لا يُسقط العملية الأساسية
        print(f"⚠ hr log_event: {e}")


# ══════════════════ الموظفون ══════════════════

async def list_employees(company_id: str, branch_scope: str | None, branch_id_param: str | None,
                         viewer: dict | None = None) -> list[dict]:
    viewer = viewer or {"salary": True, "identity": True, "manage": True}
    params: list = [company_id]
    branch_filter = scope_clause(params, branch_scope)
    if not branch_scope and branch_id_param:
        params.append(branch_id_param)
        branch_filter = f" AND e.branch_id = ${len(params)}::text::uuid"
    rows = await fetch(
        f"""SELECT e.*, b.name AS branch_name, u.email AS linked_email,
                   d.name AS department_name, p.name AS position_name
            FROM hr_employees e
            LEFT JOIN branches b ON b.id = e.branch_id
            LEFT JOIN users u ON u.id = e.linked_user_id
            LEFT JOIN hr_departments d ON d.id = e.department_id
            LEFT JOIN hr_positions p ON p.id = e.position_id
            WHERE e.company_id = $1{branch_filter}
            ORDER BY e.is_active DESC, e.full_name""",
        *params,
    )
    return [_emp_out(r, viewer) for r in rows]


def _emp_out(row, viewer: dict | None = None) -> dict:
    viewer = viewer or {"salary": True, "identity": True, "manage": True}
    r = _row_id(row)
    for k in ("department_id", "position_id", "manager_id", "schedule_id"):
        if r.get(k):
            r[k] = str(r[k])
    for k in ("basic_salary", "allowances", "commission_pct", "housing_allowance", "transport_allowance", "other_allowance"):
        r[k] = _num(r.get(k))
    return mask_employee(r, salary=viewer["salary"], identity=viewer["identity"], manage=viewer["manage"])


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


_NEW_COLS = ("department_id", "position_id", "manager_id", "schedule_id", "gender", "email", "address",
             "gosi_number", "gosi_status", "housing_allowance", "transport_allowance", "other_allowance")


async def _validate_refs(company_id: str, d: dict) -> None:
    """القسم/الوظيفة/الجدول/المدير لازم تتبع نفس الشركة"""
    for key, table in (("departmentId", "hr_departments"), ("positionId", "hr_positions"),
                       ("scheduleId", "hr_work_schedules"), ("managerId", "hr_employees")):
        v = _nz(d.get(key))
        if v and not await fetchrow(f"SELECT 1 FROM {table} WHERE id=$1::text::uuid AND company_id=$2", v, company_id):
            raise HTTPException(400, "مرجع غير صالح (قسم/وظيفة/جدول دوام/مدير)")


def _allow_total(d: dict, current: dict | None = None) -> Decimal | None:
    """البدلات الإجمالية = مجموع المكوّنات لو أُرسل أي مكوّن؛ وإلا يبقى الحقل الموحّد كما هو (توافق للخلف)"""
    keys = ("housingAllowance", "transportAllowance", "otherAllowance")
    if not any(d.get(k) is not None for k in keys):
        return None
    cur = current or {}
    cols = ("housing_allowance", "transport_allowance", "other_allowance")
    tot = Decimal("0")
    for k, c in zip(keys, cols):
        tot += Decimal(str(d[k] if d.get(k) is not None else (cur.get(c) or 0)))
    return tot


async def create_employee(company_id: str, branch_scope: str | None, d: dict,
                          actor: tuple[str | None, str | None] = (None, None),
                          viewer: dict | None = None) -> dict:
    viewer = viewer or {"salary": True, "identity": True, "manage": True}
    if branch_scope and d.get("branchId") and d["branchId"] != branch_scope:
        raise HTTPException(403, "غير مسموح لك بالعمل على فرع غير الفرع المخصّص لك")
    if not viewer["salary"]:
        for k in SALARY_KEYS:
            d.pop(k, None)
    if not viewer["identity"]:
        for k in IDENTITY_KEYS:
            d.pop(k, None)
    await _validate_linked_user(company_id, _nz(d.get("linkedUserId")))
    await _validate_refs(company_id, d)
    tot = _allow_total(d)
    allowances = tot if tot is not None else Decimal(str(d.get("allowances") or 0))
    try:
        row = await fetchrow(
            """INSERT INTO hr_employees
                 (company_id, branch_id, linked_user_id, full_name, national_id, nationality,
                  is_saudi, birth_date, phone, job_title, contract_type, hire_date, basic_salary,
                  iban, iqama_number, iqama_expiry_date, tech_role, approval_pin, allowances,
                  commission_type, commission_pct,
                  department_id, position_id, manager_id, schedule_id, gender, email, address,
                  gosi_number, gosi_status, housing_allowance, transport_allowance, other_allowance)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8::text::date,$9,$10,$11,COALESCE($12::text::date,CURRENT_DATE),$13,$14,$15,$16::text::date,$17,$18,$19,$20,$21,
                       $22::text::uuid,$23::text::uuid,$24::text::uuid,$25::text::uuid,$26,$27,$28,$29,$30,$31,$32,$33)
               RETURNING *""",
            company_id, _nz(branch_scope or d.get("branchId")), _nz(d.get("linkedUserId")), d["fullName"],
            _nz(d.get("nationalId")), _nz(d.get("nationality")), d.get("isSaudi", False), _nz(d.get("birthDate")),
            _nz(d.get("phone")), _nz(d.get("jobTitle")), d.get("contractType", "full_time"), _nz(d.get("hireDate")),
            Decimal(str(d.get("basicSalary") or 0)), _nz(d.get("iban")), _nz(d.get("iqamaNumber")), _nz(d.get("iqamaExpiryDate")),
            _nz(d.get("techRole")), _clean_pin(d.get("approvalPin")),
            allowances,
            d.get("commissionType", "none"), Decimal(str(d.get("commissionPct") or 0)),
            _nz(d.get("departmentId")), _nz(d.get("positionId")), _nz(d.get("managerId")), _nz(d.get("scheduleId")),
            _nz(d.get("gender")), _nz(d.get("email")), _nz(d.get("address")),
            _nz(d.get("gosiNumber")), _nz(d.get("gosiStatus")),
            Decimal(str(d.get("housingAllowance") or 0)), Decimal(str(d.get("transportAllowance") or 0)),
            Decimal(str(d.get("otherAllowance") or 0)),
        )
    except asyncpg.UniqueViolationError as e:
        if "approval_pin" in str(e):
            raise HTTPException(400, "رمز الاعتماد هذا مستخدم لموظف آخر — اختر رقماً مختلفاً")
        raise
    await log_event(company_id, str(row["id"]), "hire", {"hireDate": row["hire_date"], "jobTitle": row["job_title"]}, actor)
    return _emp_out(row, viewer)


_EMP_COL_MAP = {
    "branchId": "branch_id", "linkedUserId": "linked_user_id", "fullName": "full_name",
    "nationalId": "national_id", "nationality": "nationality", "isSaudi": "is_saudi",
    "birthDate": "birth_date", "phone": "phone", "jobTitle": "job_title",
    "contractType": "contract_type", "hireDate": "hire_date", "basicSalary": "basic_salary",
    "iban": "iban", "iqamaNumber": "iqama_number", "iqamaExpiryDate": "iqama_expiry_date",
    "techRole": "tech_role", "approvalPin": "approval_pin", "allowances": "allowances",
    "commissionType": "commission_type", "commissionPct": "commission_pct",
    "departmentId": "department_id", "positionId": "position_id", "managerId": "manager_id",
    "scheduleId": "schedule_id", "gender": "gender", "email": "email", "address": "address",
    "gosiNumber": "gosi_number", "gosiStatus": "gosi_status",
    "housingAllowance": "housing_allowance", "transportAllowance": "transport_allowance",
    "otherAllowance": "other_allowance",
}

# أعمدة التاريخ — لازم تتحول بالكاست ::text::date في التحديث (سبب خطأ toordinal)
_EMP_DATE_KEYS = {"birthDate", "hireDate", "iqamaExpiryDate"}
_EMP_UUID_KEYS = {"departmentId", "positionId", "managerId", "scheduleId", "branchId", "linkedUserId"}
_EMP_MONEY_KEYS = {"basicSalary", "allowances", "commissionPct", "housingAllowance", "transportAllowance", "otherAllowance"}

# تغييرات تُسجَّل في سجل الحركة (القيم المالية بين قبل/بعد، والهوية بأسماء الحقول فقط)
_EVENT_BY_KEY = {
    "basicSalary": "salary_change", "allowances": "salary_change", "housingAllowance": "salary_change",
    "transportAllowance": "salary_change", "otherAllowance": "salary_change", "commissionPct": "salary_change",
    "commissionType": "salary_change", "iban": "bank_change",
    "branchId": "branch_transfer", "departmentId": "department_change", "positionId": "position_change",
    "jobTitle": "job_title_change", "contractType": "contract_change",
    "nationalId": "identity_change", "iqamaNumber": "identity_change", "iqamaExpiryDate": "identity_change",
    "gosiNumber": "gosi_change", "gosiStatus": "gosi_change",
}
_NO_VALUE_EVENTS = {"identity_change", "bank_change"}   # لا نخزّن قيمهم في السجل


async def update_employee(company_id: str, employee_id: str, fields: dict, branch_scope: str | None = None,
                          actor: tuple[str | None, str | None] = (None, None),
                          viewer: dict | None = None, reason: str | None = None) -> dict:
    viewer = viewer or {"salary": True, "identity": True, "manage": True}
    await assert_scope(company_id, employee_id, branch_scope)
    fields = dict(fields)
    # حقول لا يملك المستخدم صلاحيتها تُتجاهل بصمت (الواجهة قد ترسل القيم المُقنَّعة/الفارغة كما استلمتها)
    if not viewer["salary"]:
        for k in SALARY_KEYS:
            fields.pop(k, None)
    if not viewer["identity"]:
        for k in IDENTITY_KEYS:
            fields.pop(k, None)
    if branch_scope and "branchId" in fields and _nz(fields["branchId"]) != branch_scope:
        raise HTTPException(403, "غير مسموح لك بنقل موظف خارج فرعك")
    keys = [k for k in fields if k in _EMP_COL_MAP]
    if not keys:
        raise HTTPException(400, "لا يوجد ما يُحدَّث")
    if "linkedUserId" in fields:
        await _validate_linked_user(company_id, _nz(fields["linkedUserId"]), employee_id)
    await _validate_refs(company_id, fields)
    before = await fetchrow("SELECT * FROM hr_employees WHERE id=$1::text::uuid AND company_id=$2", employee_id, company_id)
    if not before:
        raise HTTPException(404, "الموظف غير موجود")
    tot = _allow_total(fields, dict(before))
    if tot is not None and "allowances" not in keys:
        fields["allowances"] = float(tot); keys.append("allowances")
    # أعمدة التاريخ بتوصل نصوص من الويب — الكاست في SQL نفسه بنمط المشروع الثابت،
    # والفراغ يتطبّع NULL قبلها — دا كان سبب DataError: 'str' has no attribute 'toordinal'
    set_parts = [
        f"{_EMP_COL_MAP[k]} = ${i}::text::date" if k in _EMP_DATE_KEYS
        else f"{_EMP_COL_MAP[k]} = ${i}::text::uuid" if k in _EMP_UUID_KEYS and k not in ("branchId", "linkedUserId")
        else f"{_EMP_COL_MAP[k]} = ${i}"
        for i, k in enumerate(keys, start=3)
    ]
    set_parts.append("updated_at = now()")
    def _val(k):
        if k in _EMP_MONEY_KEYS:
            return Decimal(str(fields[k] or 0))
        if k == "approvalPin":
            return _clean_pin(fields[k])
        return _nz(fields[k])
    values = [_val(k) for k in keys]
    try:
        row = await fetchrow(
            f"""UPDATE hr_employees SET {', '.join(set_parts)}
                WHERE id=$1::text::uuid AND company_id=$2 RETURNING *""",
            employee_id, company_id, *values,
        )
    except asyncpg.UniqueViolationError as e:
        if "approval_pin" in str(e):
            raise HTTPException(400, "رمز الاعتماد هذا مستخدم لموظف آخر — اختر رقماً مختلفاً")
        raise
    if not row:
        raise HTTPException(404, "الموظف غير موجود")
    # سجل الحركة: قبل/بعد لكل فئة تغيّرت فعلاً
    changes: dict[str, dict] = {}
    for k in keys:
        col = _EMP_COL_MAP[k]
        ev = _EVENT_BY_KEY.get(k)
        if not ev:
            continue
        b, a = before[col], row[col]
        if str(b) == str(a):
            continue
        ch = changes.setdefault(ev, {})
        ch[col] = None if ev in _NO_VALUE_EVENTS else {"before": b, "after": a}
        if ev in _NO_VALUE_EVENTS:
            ch[col] = "changed"
    for ev, detail in changes.items():
        await log_event(company_id, employee_id, ev, detail, actor, reason)
    return _emp_out(row, viewer)


# ── نهاية الخدمة: القواعد قابلة للضبط من إعدادات الشركة (القيم الافتراضية = السلوك الحالي) ──

async def _company_hr_cfg(company_id: str) -> dict:
    r = await fetchrow(
        """SELECT eos_first_years_months, eos_after_months, eos_threshold_years,
                  leave_days_before, leave_days_after, leave_threshold_years, gosi_basis
           FROM companies WHERE id=$1""", company_id)
    return dict(r) if r else {}


def _calc_end_of_service(basic_salary: float, hire_date: date, termination_date: date, cfg: dict | None = None) -> dict:
    """تقدير مكافأة نهاية الخدمة: أشهر الراتب عن كل سنة قبل الحد الفاصل وبعده — كلها من إعدادات الشركة
    (الافتراضي: نصف شهر لأول 5 سنين ثم شهر كامل). ⚠ تقدير لحالة "انتهاء الخدمة العادي" فقط —
    لا يأخذ في الاعتبار الاستقالة أو الفصل أو انقطاعات العقد. لازم يُراجَع قبل أي صرف فعلي."""
    cfg = cfg or {}
    first_m = float(cfg.get("eos_first_years_months") or 0.5)
    after_m = float(cfg.get("eos_after_months") or 1)
    thr = float(cfg.get("eos_threshold_years") or 5)
    total_days = (termination_date - hire_date).days
    total_years = total_days / 365.25
    if total_years <= 0:
        return {"totalYears": 0, "amount": 0, "note": "مدة الخدمة صفر أو غير صالحة"}
    first = min(total_years, thr)
    after = max(total_years - thr, 0)
    amount = round((first * basic_salary * first_m) + (after * basic_salary * after_m), 2)
    return {
        "totalYears": round(total_years, 2), "amount": amount,
        "note": "تقدير أولي حسب حالة إنهاء الخدمة العادي فقط وبالقواعد المضبوطة في إعدادات الموارد البشرية — راجعه مع محاسبك قبل الصرف الفعلي",
    }


async def terminate_employee(company_id: str, employee_id: str, termination_date: str | None,
                             branch_scope: str | None = None, actor: tuple[str | None, str | None] = (None, None),
                             viewer: dict | None = None, reason: str | None = None) -> dict:
    viewer = viewer or {"salary": True, "identity": True, "manage": True}
    await assert_scope(company_id, employee_id, branch_scope)
    term_date = date.fromisoformat(termination_date) if termination_date else date.today()
    emp = await fetchrow("SELECT * FROM hr_employees WHERE id=$1::text::uuid AND company_id=$2", employee_id, company_id)
    if not emp:
        raise HTTPException(404, "الموظف غير موجود")

    await execute(
        "UPDATE hr_employees SET is_active=FALSE, termination_date=$1, updated_at=now() WHERE id=$2::text::uuid",
        term_date, employee_id,
    )
    await log_event(company_id, employee_id, "termination", {"terminationDate": term_date}, actor, reason)
    eos = _calc_end_of_service(_num(emp["basic_salary"]), emp["hire_date"], term_date, await _company_hr_cfg(company_id))
    if not viewer["salary"]:
        eos["amount"] = None
    return {"success": True, "endOfServiceEstimate": eos}


async def iqama_alerts(company_id: str, days_ahead: int, branch_scope: str | None = None,
                       viewer: dict | None = None) -> list[dict]:
    viewer = viewer or {"identity": True}
    days_ahead = min(max(days_ahead, 1), 365)
    params: list = [company_id, days_ahead]
    sc = scope_clause(params, branch_scope)
    rows = await fetch(
        f"""SELECT e.id, e.full_name, e.iqama_number, e.iqama_expiry_date, e.phone, b.name AS branch_name,
                  (e.iqama_expiry_date - CURRENT_DATE)::int AS days_remaining
           FROM hr_employees e
           LEFT JOIN branches b ON b.id = e.branch_id
           WHERE e.company_id = $1 AND e.is_active = TRUE AND e.iqama_expiry_date IS NOT NULL
             AND (e.iqama_expiry_date - CURRENT_DATE) <= $2{sc}
           ORDER BY e.iqama_expiry_date ASC""",
        *params,
    )
    out = []
    for r in rows:
        r = _row_id(r)
        if not viewer.get("identity", True):
            r["iqama_number"] = _mask_id(r["iqama_number"])
        out.append(r)
    return out


# ══════════════════ الحضور والانصراف ══════════════════

async def list_attendance(company_id: str, date_from: str | None, date_to: str | None,
                          employee_id: str | None, branch_scope: str | None = None) -> list[dict]:
    """حساب التأخير/الخروج المبكر/ساعات العمل/الإضافي هنا (Backend) حسب جدول دوام الموظف — توقيت الرياض"""
    conditions = ["a.company_id = $1"]
    params: list = [company_id]
    if date_from:
        params.append(date_from); conditions.append(f"a.work_date >= ${len(params)}::text::date")
    if date_to:
        params.append(date_to); conditions.append(f"a.work_date <= ${len(params)}::text::date")
    if employee_id:
        params.append(employee_id); conditions.append(f"a.employee_id = ${len(params)}::text::uuid")
    sc = scope_clause(params, branch_scope)
    rows = await fetch(
        f"""WITH x AS (
              SELECT a.*, e.full_name AS employee_name, s.name AS schedule_name, s.grace_minutes,
                     ((a.work_date + s.start_time) AT TIME ZONE 'Asia/Riyadh') AS start_ts,
                     ((a.work_date + s.end_time + CASE WHEN s.end_time <= s.start_time THEN interval '1 day' ELSE interval '0' END)
                       AT TIME ZONE 'Asia/Riyadh') AS end_ts
              FROM hr_attendance a
              JOIN hr_employees e ON e.id = a.employee_id
              LEFT JOIN hr_work_schedules s ON s.id = e.schedule_id
              WHERE {' AND '.join(conditions)}{sc})
            SELECT x.*,
              CASE WHEN check_in IS NOT NULL AND check_out IS NOT NULL
                   THEN (EXTRACT(EPOCH FROM (check_out - check_in))/60)::int END AS worked_minutes,
              CASE WHEN start_ts IS NOT NULL AND check_in IS NOT NULL
                   THEN GREATEST(0, (EXTRACT(EPOCH FROM (check_in - start_ts))/60)::int - grace_minutes) END AS late_minutes,
              CASE WHEN end_ts IS NOT NULL AND check_out IS NOT NULL
                   THEN GREATEST(0, (EXTRACT(EPOCH FROM (end_ts - check_out))/60)::int) END AS early_minutes,
              CASE WHEN end_ts IS NOT NULL AND check_out IS NOT NULL
                   THEN GREATEST(0, (EXTRACT(EPOCH FROM (check_out - end_ts))/60)::int) END AS overtime_minutes
            FROM x ORDER BY work_date DESC, employee_name LIMIT 500""",
        *params,
    )
    out = []
    for r in rows:
        r = _row_id(r)
        if not r.get("check_in"):
            r["day_status"] = "absent"
        elif (r.get("late_minutes") or 0) > 0:
            r["day_status"] = "late"
        elif (r.get("early_minutes") or 0) > 0:
            r["day_status"] = "early_leave"
        else:
            r["day_status"] = "present"
        out.append(r)
    return out


async def check_in(company_id: str, user_id: str, employee_id: str, branch_scope: str | None = None) -> dict:
    await assert_scope(company_id, employee_id, branch_scope)
    row = await fetchrow(
        """INSERT INTO hr_attendance (company_id, employee_id, work_date, check_in, created_by)
           VALUES ($1,$2,CURRENT_DATE,now(),$3)
           ON CONFLICT (employee_id, work_date)
           DO UPDATE SET check_in = COALESCE(hr_attendance.check_in, EXCLUDED.check_in)
           RETURNING *""",
        company_id, employee_id, user_id,
    )
    return _row_id(row)


async def check_out(company_id: str, employee_id: str, branch_scope: str | None = None) -> dict:
    await assert_scope(company_id, employee_id, branch_scope)
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

async def list_leave_requests(company_id: str, employee_id: str | None, status: str | None,
                              branch_scope: str | None = None) -> list[dict]:
    conditions = ["l.company_id = $1"]
    params: list = [company_id]
    conditions.append("TRUE" + scope_clause(params, branch_scope))
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


_BASE_LEAVE = {"annual", "sick", "unpaid", "other"}


async def create_leave_request(company_id: str, d: dict, branch_scope: str | None = None,
                               actor: tuple[str | None, str | None] = (None, None)) -> dict:
    await assert_scope(company_id, d["employeeId"], branch_scope)
    ltype = d.get("leaveType", "annual")
    if ltype not in _BASE_LEAVE and not await fetchrow(
            "SELECT 1 FROM hr_leave_types WHERE company_id=$1 AND code=$2 AND is_active", company_id, ltype):
        raise HTTPException(400, "نوع الإجازة غير معرَّف")
    start = date.fromisoformat(d["startDate"])
    end = date.fromisoformat(d["endDate"])
    days = (end - start).days + 1
    if days < 1:
        raise HTTPException(400, "تاريخ النهاية لازم يكون بعد تاريخ البداية")
    row = await fetchrow(
        """INSERT INTO hr_leave_requests (company_id, employee_id, leave_type, start_date, end_date, days_count, reason)
           VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *""",
        company_id, d["employeeId"], ltype, start, end, days, d.get("reason"),
    )
    return _row_id(row)


async def decide_leave_request(company_id: str, user_id: str, leave_id: str, decision: str,
                               branch_scope: str | None = None, actor_name: str | None = None) -> dict:
    cur = await fetchrow("SELECT employee_id FROM hr_leave_requests WHERE id=$1::text::uuid AND company_id=$2",
                         leave_id, company_id)
    if cur:
        await assert_scope(company_id, str(cur["employee_id"]), branch_scope)
    row = await fetchrow(
        """UPDATE hr_leave_requests SET status=$1, approved_by=$2, approved_at=now()
           WHERE id=$3 AND company_id=$4 AND status='pending' RETURNING *""",
        decision, user_id, leave_id, company_id,
    )
    if not row:
        raise HTTPException(404, "الطلب غير موجود أو تم البت فيه بالفعل")
    await log_event(company_id, str(row["employee_id"]), f"leave_{decision}",
                    {"leaveType": row["leave_type"], "from": row["start_date"], "to": row["end_date"], "days": row["days_count"]},
                    (user_id, actor_name))
    return _row_id(row)


async def leave_balance(company_id: str, employee_id: str, branch_scope: str | None = None) -> dict:
    """رصيد الإجازة السنوية من إعدادات الشركة (الافتراضي 21 يوماً لأول 5 سنين ثم 30) — مطروح منه المُستخدم هذا العام.
    ولكل نوع إجازة مُعرَّف حصة سنوية: المتبقي = الحصة − المستخدم."""
    await assert_scope(company_id, employee_id, branch_scope)
    emp = await fetchrow("SELECT * FROM hr_employees WHERE id=$1::text::uuid AND company_id=$2", employee_id, company_id)
    if not emp:
        raise HTTPException(404, "الموظف غير موجود")
    cfg = await _company_hr_cfg(company_id)
    years_service = (date.today() - emp["hire_date"]).days / 365.25
    thr = float(cfg.get("leave_threshold_years") or 5)
    annual_entitlement = int(cfg.get("leave_days_after") or 30) if years_service >= thr else int(cfg.get("leave_days_before") or 21)

    used_rows = await fetch(
        """SELECT leave_type, COALESCE(SUM(days_count),0)::int AS used
           FROM hr_leave_requests
           WHERE employee_id=$1::text::uuid AND status='approved'
             AND EXTRACT(YEAR FROM start_date) = EXTRACT(YEAR FROM CURRENT_DATE)
           GROUP BY leave_type""", employee_id)
    used_by = {r["leave_type"]: r["used"] for r in used_rows}
    types = await fetch("SELECT code, name, annual_days, is_paid FROM hr_leave_types WHERE company_id=$1 AND is_active", company_id)
    names = {"annual": "سنوية", "sick": "مرضية", "unpaid": "بدون راتب", "other": "أخرى"}
    by_type = []
    for code, nm in names.items():
        by_type.append({"code": code, "name": nm, "used": used_by.get(code, 0),
                        "entitlement": annual_entitlement if code == "annual" else None,
                        "remaining": (annual_entitlement - used_by.get(code, 0)) if code == "annual" else None})
    for t in types:
        ent = t["annual_days"]
        by_type.append({"code": t["code"], "name": t["name"], "used": used_by.get(t["code"], 0),
                        "entitlement": ent, "remaining": (ent - used_by.get(t["code"], 0)) if ent is not None else None})
    used = used_by.get("annual", 0)
    return {
        "employeeId": employee_id, "annualEntitlement": annual_entitlement,
        "used": used, "remaining": annual_entitlement - used, "byType": by_type,
        "note": "الرصيد محسوب بقواعد إعدادات الموارد البشرية للشركة — طابقه مع سجلاتك الرسمية",
    }


# ══════════════════ المخالفات ══════════════════

async def list_violations(company_id: str, employee_id: str | None, branch_scope: str | None = None) -> list[dict]:
    conditions = ["v.company_id = $1"]
    params: list = [company_id]
    conditions.append("TRUE" + scope_clause(params, branch_scope))
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


async def create_violation(company_id: str, user_id: str, d: dict, branch_scope: str | None = None,
                           actor_name: str | None = None) -> dict:
    await assert_scope(company_id, d["employeeId"], branch_scope)
    row = await fetchrow(
        """INSERT INTO hr_violations
             (company_id, employee_id, violation_date, violation_type, description, deduction_amount, issued_by)
           VALUES ($1,$2,COALESCE($3::text::date,CURRENT_DATE),$4,$5,$6,$7) RETURNING *""",
        company_id, d["employeeId"], d.get("violationDate"), d["violationType"],
        d.get("description"), Decimal(str(d.get("deductionAmount", 0))), user_id,
    )
    r = _row_id(row); r["deduction_amount"] = _num(r["deduction_amount"])
    await log_event(company_id, d["employeeId"], "violation",
                    {"type": d["violationType"], "amount": float(d.get("deductionAmount", 0))}, (user_id, actor_name))
    return r


# ══════════════════ الرواتب ══════════════════

def _month_range(year: int, month: int) -> tuple[date, date]:
    start = date(year, month, 1)
    end = date(year + 1, 1, 1) if month == 12 else date(year, month + 1, 1)
    return start, end


async def _commission_basis(fetch_fn, company_id: str, date_from: date, date_to: date) -> dict[str, dict]:
    """صافي أساس العمولة لكل كاشير (مستخدم) خلال فترة — من فواتير المبيعات غير المرتجعة
    بالكامل، بعد خصم المرتجعات الجزئية المسجّلة خلال نفس الفترة على فواتيره.
    ⚠ تبسيط مقصود: المرتجع الجزئي يُخصَم من صافي المبيعات والربح بالتساوي (بدون إعادة
    حساب تكلفة البضاعة المرتجعة بدقة) — كافٍ لعمولة تقديرية شهرية، يُراجَع مع المحاسب
    لو اتضح أن حجم المرتجعات الجزئية كبير مؤثر."""
    sales_rows = await fetch_fn(
        """SELECT created_by, SUM(total_ex)::numeric(12,2) AS sales_ex,
                  SUM(total_ex - COALESCE(cogs_total,0))::numeric(12,2) AS gross_profit
           FROM invoices
           WHERE company_id=$1 AND is_returned=FALSE AND created_at >= $2 AND created_at < $3
           GROUP BY created_by""",
        company_id, date_from, date_to)
    ret_rows = await fetch_fn(
        """SELECT i.created_by, SUM(r.total_ex)::numeric(12,2) AS returned_ex
           FROM invoice_returns r JOIN invoices i ON i.id = r.invoice_id
           WHERE i.company_id=$1 AND r.created_at >= $2 AND r.created_at < $3
           GROUP BY i.created_by""",
        company_id, date_from, date_to)
    ret_map = {str(r["created_by"]): Decimal(str(r["returned_ex"])) for r in ret_rows if r["created_by"]}
    basis: dict[str, dict] = {}
    for r in sales_rows:
        if not r["created_by"]:
            continue
        uid = str(r["created_by"])
        returned = ret_map.get(uid, Decimal("0.00"))
        basis[uid] = {
            "sales_ex": max(Decimal(str(r["sales_ex"])) - returned, Decimal("0.00")),
            "gross_profit": max(Decimal(str(r["gross_profit"])) - returned, Decimal("0.00")),
        }
    return basis


async def commissions_preview(company_id: str, date_from: str, date_to: str) -> list[dict]:
    """معاينة عمولات المبيعات لأي فترة (بلا ربط بدورة رواتب) — لمراجعة المحاسب/المدير
    قبل تشغيل الرواتب فعلياً."""
    basis_map = await _commission_basis(fetch, company_id, date.fromisoformat(date_from), date.fromisoformat(date_to))
    employees = await fetch(
        """SELECT id, full_name, linked_user_id, commission_type, commission_pct
           FROM hr_employees WHERE company_id=$1 AND is_active=TRUE AND commission_type<>'none'
           ORDER BY full_name""",
        company_id)
    out = []
    for emp in employees:
        basis = basis_map.get(str(emp["linked_user_id"])) if emp["linked_user_id"] else None
        sales_ex = basis["sales_ex"] if basis else Decimal("0.00")
        gross_profit = basis["gross_profit"] if basis else Decimal("0.00")
        base_val = sales_ex if emp["commission_type"] == "pct_sales" else gross_profit
        amount = (base_val * Decimal(str(emp["commission_pct"])) / 100).quantize(Decimal("0.01"))
        out.append({
            "employee_id": str(emp["id"]), "employee_name": emp["full_name"],
            "commission_type": emp["commission_type"], "commission_pct": _num(emp["commission_pct"]),
            "sales_ex": _num(sales_ex), "gross_profit": _num(gross_profit), "commission_amount": _num(amount),
        })
    return out


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
                """SELECT gosi_saudi_employee_pct, gosi_saudi_employer_pct, gosi_nonsaudi_employer_pct, gosi_basis
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
            adv_map = await _treasury.payroll_advance_deductions(conn, company_id)
            date_from, date_to = _month_range(period_year, period_month)
            commission_basis_map = await _commission_basis(conn.fetch, company_id, date_from, date_to)

            slips = []
            for emp in employees:
                viol_deduction = viol_map.get(str(emp["id"]), Decimal("0.00"))
                basic = Decimal(str(emp["basic_salary"]))
                allowances = Decimal(str(emp["allowances"] if emp["allowances"] is not None else 0))
                comm_amount = Decimal("0.00")
                if emp["linked_user_id"] and emp["commission_type"] != "none" and emp["commission_pct"]:
                    basis = commission_basis_map.get(str(emp["linked_user_id"]))
                    if basis:
                        base_val = basis["sales_ex"] if emp["commission_type"] == "pct_sales" else basis["gross_profit"]
                        comm_amount = (base_val * Decimal(str(emp["commission_pct"])) / 100).quantize(Decimal("0.01"))
                gosi_base = basic + allowances if company["gosi_basis"] == "basic_allowances" else basic
                if emp["is_saudi"]:
                    gosi_employee = (gosi_base * Decimal(str(company["gosi_saudi_employee_pct"])) / 100).quantize(Decimal("0.01"))
                    gosi_employer = (gosi_base * Decimal(str(company["gosi_saudi_employer_pct"])) / 100).quantize(Decimal("0.01"))
                else:
                    gosi_employee = Decimal("0.00")
                    gosi_employer = (gosi_base * Decimal(str(company["gosi_nonsaudi_employer_pct"])) / 100).quantize(Decimal("0.01"))
                # ⚠ وعاء التأمينات من إعدادات الشركة (gosi_basis): الأساسي فقط (الافتراضي) أو الأساسي + البدلات — راجعه مع محاسبك
                net_pre = basic + allowances + comm_amount - viol_deduction - gosi_employee
                adv_ded = min(adv_map.get(str(emp["id"]), Decimal("0.00")), max(net_pre, Decimal("0.00"))).quantize(Decimal("0.01"))
                net_pay = (net_pre - adv_ded).quantize(Decimal("0.01"))
                slips.append((run["id"], emp["id"], basic, allowances, viol_deduction,
                              gosi_employee, gosi_employer, net_pay, adv_ded, comm_amount))

            # إدخال كل القسائم دفعة واحدة
            if slips:
                await conn.executemany(
                    """INSERT INTO hr_payslips
                         (payroll_run_id, employee_id, basic_salary, allowances, violations_deduction,
                          gosi_employee, gosi_employer, net_pay, advance_deduction, commission_amount)
                       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)""",
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
        for k in ("basic_salary", "allowances", "commission_amount", "violations_deduction", "other_deductions",
                 "advance_deduction", "gosi_employee", "gosi_employer", "net_pay"):
            r[k] = _num(r[k])
        out.append(r)
    return out


async def finalize_payroll_run(company_id: str, run_id: str) -> dict:
    """اعتماد مسير الرواتب: يسجّل قيد يومية شامل واحد —
      مدين: مصروف الرواتب (الإجمالي) + مصروف اشتراكات التأمينات (حصة الشركة)
      دائن: التأمينات المستحقة (حصة الموظف + الشركة) + إيرادات أخرى (خصم مخالفات)
            + سلف الموظفين (تسوية السلف المخصومة) + رواتب مستحقة الدفع (الصافي)
    رواتب مستحقة الدفع تُسوَّى لاحقاً نقداً/بنكاً عبر pay_payroll_run — فالمصروف
    يُعترف به وقت الاعتماد بصرف النظر عن وقت الدفع الفعلي للموظفين."""
    from ...core import accounting
    from ...core.db import transaction
    async with transaction() as conn:
        async with conn.transaction():
            row = await conn.fetchrow(
                """UPDATE hr_payroll_runs SET status='finalized', finalized_at=now()
                   WHERE id=$1 AND company_id=$2 AND status='draft' RETURNING *""",
                run_id, company_id)
            if not row:
                raise HTTPException(404, "الدورة غير موجودة أو مُعتمدة بالفعل")

            slips = await conn.fetch(
                """SELECT employee_id, basic_salary, allowances, violations_deduction,
                          gosi_employee, gosi_employer, net_pay, advance_deduction, commission_amount
                   FROM hr_payslips WHERE payroll_run_id=$1""", run_id)
            if not slips:
                return _row_id(row)

            # تسوية السلف أولاً (سجل السداد لكل موظف — القيد المحاسبي يُدمَج تحت بالكلي)
            adv_total = Decimal("0.00")
            for sl in slips:
                if sl["advance_deduction"] and sl["advance_deduction"] > 0:
                    adv_total += await _treasury.apply_repayment(
                        conn, company_id, str(sl["employee_id"]), sl["advance_deduction"],
                        "payroll", run_id=row["id"], strict=False)

            gross = sum((accounting.dec(sl["basic_salary"]) + accounting.dec(sl["allowances"])) for sl in slips)
            gosi_employee_total = sum(accounting.dec(sl["gosi_employee"]) for sl in slips)
            gosi_employer_total = sum(accounting.dec(sl["gosi_employer"]) for sl in slips)
            violations_total = sum(accounting.dec(sl["violations_deduction"]) for sl in slips)
            commission_total = sum(accounting.dec(sl["commission_amount"]) for sl in slips)
            net_pay_total = sum(accounting.dec(sl["net_pay"]) for sl in slips)
            gosi_total = gosi_employee_total + gosi_employer_total

            exp_code, exp_name = _treasury.EXPENSE_ACCOUNTS["رواتب وأجور"]
            salary_exp_acc = await _treasury._get_or_create_account(conn, company_id, exp_code, exp_name, "expense")
            net_payable_acc = await _treasury._get_or_create_account(
                conn, company_id, _treasury.NET_SALARIES_PAYABLE_ACCOUNT[0],
                _treasury.NET_SALARIES_PAYABLE_ACCOUNT[1], "liability")

            lines = [{"account_id": salary_exp_acc, "debit": gross,
                      "description": f"إجمالي رواتب وبدلات {row['period_month']}/{row['period_year']}"}]
            if gosi_employer_total > 0:
                gosi_exp_acc = await _treasury._get_or_create_account(
                    conn, company_id, _treasury.GOSI_EXPENSE_ACCOUNT[0],
                    _treasury.GOSI_EXPENSE_ACCOUNT[1], "expense")
                lines.append({"account_id": gosi_exp_acc, "debit": gosi_employer_total,
                              "description": "اشتراكات التأمينات — حصة الشركة"})
            if gosi_total > 0:
                gosi_pay_acc = await _treasury._get_or_create_account(
                    conn, company_id, _treasury.GOSI_PAYABLE_ACCOUNT[0],
                    _treasury.GOSI_PAYABLE_ACCOUNT[1], "liability")
                lines.append({"account_id": gosi_pay_acc, "credit": gosi_total,
                              "description": "تأمينات مستحقة (حصة الموظف والشركة)"})
            if violations_total > 0:
                inc_acc = await _treasury._get_or_create_account(
                    conn, company_id, _treasury.OTHER_INCOME[0], _treasury.OTHER_INCOME[1], "revenue")
                lines.append({"account_id": inc_acc, "credit": violations_total,
                              "description": "خصم مخالفات من الرواتب"})
            if commission_total > 0:
                comm_acc = await _treasury._get_or_create_account(
                    conn, company_id, _treasury.COMMISSION_EXPENSE_ACCOUNT[0],
                    _treasury.COMMISSION_EXPENSE_ACCOUNT[1], "expense")
                lines.append({"account_id": comm_acc, "debit": commission_total,
                              "description": "عمولات مبيعات مستحقة للموظفين"})
            if adv_total > 0:
                adv_acc = await _treasury._get_or_create_account(
                    conn, company_id, _treasury.ADVANCE_ACCOUNT[0], _treasury.ADVANCE_ACCOUNT[1], "asset")
                lines.append({"account_id": adv_acc, "credit": adv_total,
                              "description": "تسوية سلف الموظفين من الراتب"})
            lines.append({"account_id": net_payable_acc, "credit": net_pay_total,
                         "description": "صافي رواتب مستحقة الدفع للموظفين"})

            await accounting.post_journal_entry(
                conn, company_id=company_id, source_type="payroll_run", source_id=str(row["id"]),
                description=f"قيد رواتب {row['period_month']}/{row['period_year']}", lines=lines)
    return _row_id(row)


async def pay_payroll_run(company_id: str, user_id: str, run_id: str, method: str) -> dict:
    """تسوية صافي الرواتب المستحقة فعلياً (بعد الاعتماد) — مدين رواتب مستحقة الدفع،
    دائن النقد/الشبكة/التحويل. منفصل عن الاعتماد لأن الدفع الفعلي غالباً يتأخر أيام."""
    from ...core import accounting
    from ...core.db import transaction
    async with transaction() as conn:
        async with conn.transaction():
            row = await conn.fetchrow(
                """UPDATE hr_payroll_runs SET status='paid', paid_at=now(), paid_by=$3, payment_method=$4
                   WHERE id=$1 AND company_id=$2 AND status='finalized' RETURNING *""",
                run_id, company_id, user_id, method)
            if not row:
                raise HTTPException(404, "الدورة غير موجودة أو غير معتمدة بعد أو مدفوعة بالفعل")
            total = await conn.fetchval(
                "SELECT COALESCE(SUM(net_pay),0) FROM hr_payslips WHERE payroll_run_id=$1", run_id)
            total = accounting.dec(total)
            if total > 0:
                net_payable_acc = await _treasury._get_or_create_account(
                    conn, company_id, _treasury.NET_SALARIES_PAYABLE_ACCOUNT[0],
                    _treasury.NET_SALARIES_PAYABLE_ACCOUNT[1], "liability")
                cash_acc = await accounting.get_account_id(conn, company_id, accounting.PAYMENT_ACCOUNT_CODES[method])
                await accounting.post_journal_entry(
                    conn, company_id=company_id, source_type="payroll_run_payment", source_id=str(row["id"]),
                    description=f"صرف رواتب {row['period_month']}/{row['period_year']} ({method})",
                    lines=[{"account_id": net_payable_acc, "debit": total, "description": "تسوية رواتب مستحقة"},
                           {"account_id": cash_acc, "credit": total, "description": f"صرف ({method})"}])
    return _row_id(row)


# ══════════════════ عهد الموظفين (مالية وعينية) ══════════════════

def _custody_row(r: dict) -> dict:
    r = dict(r)
    r["id"] = str(r["id"])
    r["employee_id"] = str(r["employee_id"])
    return r


async def list_custody_items(company_id: str, employee_id: str | None, status: str | None,
                             branch_scope: str | None = None) -> list[dict]:
    conditions = ["c.company_id = $1"]
    params: list = [company_id]
    conditions.append("TRUE" + scope_clause(params, branch_scope))
    if employee_id:
        params.append(employee_id); conditions.append(f"c.employee_id = ${len(params)}")
    if status:
        params.append(status); conditions.append(f"c.status = ${len(params)}")
    rows = await fetch(
        f"""SELECT c.*, e.full_name AS employee_name
            FROM hr_custody_items c JOIN hr_employees e ON e.id = c.employee_id
            WHERE {' AND '.join(conditions)}
            ORDER BY c.created_at DESC""",
        *params,
    )
    return [_custody_row(r) for r in rows]


async def create_custody_item(company_id: str, user_id: str, d: dict, branch_scope: str | None = None) -> dict:
    await assert_scope(company_id, d["employeeId"], branch_scope)
    assigned = date.fromisoformat(d["assignedDate"]) if d.get("assignedDate") else date.today()
    row = await fetchrow(
        """INSERT INTO hr_custody_items
             (company_id, employee_id, item_name, description, estimated_value, assigned_date, notes, created_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *""",
        company_id, d["employeeId"], d["itemName"], d.get("description"),
        d.get("estimatedValue", 0), assigned, d.get("notes"), user_id,
    )
    emp = await fetchrow("SELECT full_name FROM hr_employees WHERE id=$1", row["employee_id"])
    out = _custody_row(row)
    out["employee_name"] = emp["full_name"] if emp else ""
    return out


async def update_custody_status(company_id: str, item_id: str, d: dict, branch_scope: str | None = None) -> dict:
    """تحديث حالة عنصر عهدة: استرجاع أو فقد. الرجوع لحالة 'محتجزة' يمسح تاريخ الإرجاع تلقائياً."""
    cur = await fetchrow("SELECT employee_id FROM hr_custody_items WHERE id=$1::text::uuid AND company_id=$2", item_id, company_id)
    if cur:
        await assert_scope(company_id, str(cur["employee_id"]), branch_scope)
    status = d["status"]
    returned_date = (
        date.fromisoformat(d["returnedDate"]) if d.get("returnedDate")
        else (date.today() if status in ("returned", "lost") else None)
    )
    row = await fetchrow(
        """UPDATE hr_custody_items
           SET status=$1, returned_date=$2, notes=COALESCE($3, notes)
           WHERE id=$4 AND company_id=$5 RETURNING *""",
        status, returned_date, d.get("notes"), item_id, company_id,
    )
    if not row:
        raise HTTPException(404, "عنصر العهدة غير موجود")
    emp = await fetchrow("SELECT full_name FROM hr_employees WHERE id=$1", row["employee_id"])
    out = _custody_row(row)
    out["employee_name"] = emp["full_name"] if emp else ""
    return out


# ══════════════════ الطلبات الإلكترونية العامة ══════════════════
# (نقل فرع / مستلزمات / بلاغ عطل — الإجازات لها مسارها الخاص فوق تحت "الإجازات")

_REQUEST_TITLES = {
    "branch_transfer": "طلب نقل فرع",
    "supplies": "طلب مستلزمات",
    "malfunction_report": "بلاغ عطل",
}


def _request_row(r: dict) -> dict:
    r = dict(r)
    r["id"] = str(r["id"])
    r["employee_id"] = str(r["employee_id"])
    return r


async def list_employee_requests(company_id: str, employee_id: str | None,
                                  request_type: str | None, status: str | None,
                                  branch_scope: str | None = None) -> list[dict]:
    conditions = ["r.company_id = $1"]
    params: list = [company_id]
    conditions.append("TRUE" + scope_clause(params, branch_scope))
    if employee_id:
        params.append(employee_id); conditions.append(f"r.employee_id = ${len(params)}")
    if request_type:
        params.append(request_type); conditions.append(f"r.request_type = ${len(params)}")
    if status:
        params.append(status); conditions.append(f"r.status = ${len(params)}")
    rows = await fetch(
        f"""SELECT r.*, e.full_name AS employee_name, u.full_name AS decided_by_name
            FROM hr_employee_requests r
            JOIN hr_employees e ON e.id = r.employee_id
            LEFT JOIN users u ON u.id = r.decided_by
            WHERE {' AND '.join(conditions)}
            ORDER BY r.created_at DESC""",
        *params,
    )
    return [_request_row(r) for r in rows]


async def create_employee_request(company_id: str, user_id: str, d: dict, branch_scope: str | None = None) -> dict:
    await assert_scope(company_id, d["employeeId"], branch_scope)
    request_type = d["requestType"]
    details = d.get("details") or {}
    title = d.get("title") or _REQUEST_TITLES.get(request_type, "طلب")
    row = await fetchrow(
        """INSERT INTO hr_employee_requests (company_id, employee_id, request_type, title, details, created_by)
           VALUES ($1,$2,$3,$4,$5::jsonb,$6) RETURNING *""",
        company_id, d["employeeId"], request_type, title, details, user_id,
    )
    emp = await fetchrow("SELECT full_name FROM hr_employees WHERE id=$1", row["employee_id"])
    out = _request_row(row)
    out["employee_name"] = emp["full_name"] if emp else ""
    out["decided_by_name"] = None

    await notify.notify_users_with_permission(
        company_id, "hr.requests_approve", "hr_request_pending",
        f"{title} — بانتظار الاعتماد ({out['employee_name']})",
        body=details.get("reason") or details.get("description"),
        link="/hr", severity="info", dedupe_key=f"hr_request_pending:{row['id']}",
    )
    return out


async def decide_employee_request(company_id: str, user_id: str, request_id: str, d: dict,
                                  branch_scope: str | None = None) -> dict:
    decision = d["decision"]
    cur = await fetchrow("SELECT employee_id FROM hr_employee_requests WHERE id=$1::text::uuid AND company_id=$2", request_id, company_id)
    if cur:
        await assert_scope(company_id, str(cur["employee_id"]), branch_scope)
    row = await fetchrow(
        """UPDATE hr_employee_requests
           SET status=$1, decided_by=$2, decided_at=now(), decision_note=$3
           WHERE id=$4 AND company_id=$5 AND status='pending' RETURNING *""",
        decision, user_id, d.get("decisionNote"), request_id, company_id,
    )
    if not row:
        raise HTTPException(404, "الطلب غير موجود أو تم البت فيه بالفعل")

    # نقل الفرع: تطبيق فعلي تلقائي عند الاعتماد لو الطلب بيحدد فرعاً مستهدفاً صالحاً
    if decision == "approved" and row["request_type"] == "branch_transfer":
        target_branch_id = (row["details"] or {}).get("targetBranchId")
        if target_branch_id:
            try:
                await execute(
                    "UPDATE hr_employees SET branch_id=$1, updated_at=now() WHERE id=$2 AND company_id=$3",
                    target_branch_id, row["employee_id"], company_id)
            except Exception:
                pass  # فرع غير صالح — الاعتماد يُسجَّل برغم ذلك؛ التصحيح يدوي من شاشة الموظفين

    emp = await fetchrow("SELECT full_name FROM hr_employees WHERE id=$1", row["employee_id"])
    decider = await fetchrow("SELECT full_name FROM users WHERE id=$1", user_id)
    out = _request_row(row)
    out["employee_name"] = emp["full_name"] if emp else ""
    out["decided_by_name"] = decider["full_name"] if decider else None
    return out

