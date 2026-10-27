# modules/hr/api.py — طبقة الـ HTTP: مسارات + صلاحيات فقط
from fastapi import APIRouter, Depends, HTTPException, Query

from ...core.deps import CurrentUser, require_permission
from . import org, overview, service
from .schemas import (
    AttendanceOut, CheckInBody, CommissionPreviewRow, CustodyItemCreate, CustodyItemOut, CustodyStatusBody,
    EmployeeCreate, EmployeeOut, EmployeeRequestCreate, EmployeeRequestDecisionBody, EmployeeRequestOut,
    EmployeeUpdate, IqamaAlertOut, LeaveBalanceOut, LeaveCreate, LeaveDecisionBody, LeaveOut,
    PayrollPayIn, PayrollRunCreate, PayrollRunOut, PayrollRunResultOut, PayslipOut,
    TerminateBody, TerminateOut, ViolationCreate, ViolationOut,
    ContractBody, DepartmentBody, DocumentBody, HrSettingsBody, LeaveTypeBody, PositionBody, ReasonBody, ScheduleBody,
)

router = APIRouter()


def _viewer(user: CurrentUser) -> dict:
    """ما يحق للمستخدم رؤيته من الحقول الحساسة — يُحسب بالخادم ويُمرَّر للخدمة (لا تعتمد الواجهة على شيء)"""
    return {"salary": user.has("hr.salary.view"), "identity": user.has("hr.identity.view"),
            "manage": user.has("hr.manage"), "payroll": user.has("hr.payroll")}


def _actor(user: CurrentUser) -> tuple[str, str]:
    return (user.user_id, user.full_name or user.email)


# ══════════════════ الموظفون ══════════════════

@router.get("/employees", response_model=list[EmployeeOut])
async def list_employees(branchId: str | None = Query(default=None),
                         user: CurrentUser = Depends(require_permission("hr.view", "hr.manage"))):
    return await service.list_employees(user.company_id, user.branch_scope, branchId, _viewer(user))


@router.post("/employees", response_model=EmployeeOut, status_code=201)
async def create_employee(body: EmployeeCreate, user: CurrentUser = Depends(require_permission("hr.manage"))):
    return await service.create_employee(user.company_id, user.branch_scope, body.model_dump(), _actor(user), _viewer(user))


@router.put("/employees/{employee_id}", response_model=EmployeeOut)
async def update_employee(employee_id: str, body: EmployeeUpdate,
                          user: CurrentUser = Depends(require_permission("hr.manage"))):
    return await service.update_employee(user.company_id, employee_id, body.model_dump(exclude_unset=True),
                                         user.branch_scope, _actor(user), _viewer(user))


@router.post("/employees/{employee_id}/terminate", response_model=TerminateOut)
async def terminate_employee(employee_id: str, body: TerminateBody,
                             user: CurrentUser = Depends(require_permission("hr.manage"))):
    """إنهاء خدمة (تعطيل ناعم) — بيرجّع تقدير مكافأة نهاية الخدمة"""
    return await service.terminate_employee(user.company_id, employee_id, body.terminationDate,
                                            user.branch_scope, _actor(user), _viewer(user), body.reason)


@router.get("/iqama-alerts", response_model=list[IqamaAlertOut])
async def iqama_alerts(daysAhead: int = Query(default=60, ge=1, le=365),
                       user: CurrentUser = Depends(require_permission("hr.view", "hr.manage"))):
    return await service.iqama_alerts(user.company_id, daysAhead, user.branch_scope, _viewer(user))


# ══════════════════ الحضور والانصراف ══════════════════

@router.get("/attendance", response_model=list[AttendanceOut])
async def list_attendance(date_from: str | None = Query(default=None, alias="from"),
                          date_to: str | None = Query(default=None, alias="to"),
                          employeeId: str | None = Query(default=None),
                          user: CurrentUser = Depends(require_permission("hr.view", "hr.attendance"))):
    return await service.list_attendance(user.company_id, date_from, date_to, employeeId, user.branch_scope)


@router.post("/attendance/check-in", response_model=AttendanceOut, status_code=201)
async def check_in(body: CheckInBody, user: CurrentUser = Depends(require_permission("hr.attendance"))):
    """تسجيل حضور — بيفتح سجل اليوم لو مش موجود، أو يسيب أول وقت حضور مسجّل زي ما هو"""
    return await service.check_in(user.company_id, user.user_id, body.employeeId, user.branch_scope)


@router.post("/attendance/check-out", response_model=AttendanceOut)
async def check_out(body: CheckInBody, user: CurrentUser = Depends(require_permission("hr.attendance"))):
    return await service.check_out(user.company_id, body.employeeId, user.branch_scope)


# ══════════════════ الإجازات ══════════════════

@router.get("/leave-requests", response_model=list[LeaveOut])
async def list_leave_requests(employeeId: str | None = Query(default=None),
                              status: str | None = Query(default=None),
                              user: CurrentUser = Depends(require_permission("hr.view", "hr.leave_approve"))):
    return await service.list_leave_requests(user.company_id, employeeId, status, user.branch_scope)


@router.post("/leave-requests", response_model=LeaveOut, status_code=201)
async def create_leave_request(body: LeaveCreate,
                               user: CurrentUser = Depends(require_permission("hr.manage", "hr.leave_approve"))):
    return await service.create_leave_request(user.company_id, body.model_dump(), user.branch_scope, _actor(user))


@router.post("/leave-requests/{leave_id}/decision", response_model=LeaveOut)
async def decide_leave_request(leave_id: str, body: LeaveDecisionBody,
                               user: CurrentUser = Depends(require_permission("hr.leave_approve"))):
    return await service.decide_leave_request(user.company_id, user.user_id, leave_id, body.decision,
                                              user.branch_scope, user.full_name)


@router.get("/leave-balance/{employee_id}", response_model=LeaveBalanceOut)
async def leave_balance(employee_id: str,
                        user: CurrentUser = Depends(require_permission("hr.view", "hr.leave_approve"))):
    return await service.leave_balance(user.company_id, employee_id, user.branch_scope)


# ══════════════════ المخالفات ══════════════════

@router.get("/violations", response_model=list[ViolationOut])
async def list_violations(employeeId: str | None = Query(default=None),
                          user: CurrentUser = Depends(require_permission("hr.view", "hr.violations"))):
    return await _violations(user, employeeId)


@router.post("/violations", response_model=ViolationOut, status_code=201)
async def create_violation(body: ViolationCreate, user: CurrentUser = Depends(require_permission("hr.violations"))):
    return await service.create_violation(user.company_id, user.user_id, body.model_dump(), user.branch_scope, user.full_name)


# ══════════════════ الرواتب ══════════════════

@router.get("/commissions-preview", response_model=list[CommissionPreviewRow])
async def commissions_preview(dateFrom: str = Query(..., alias="from"), dateTo: str = Query(..., alias="to"),
                              user: CurrentUser = Depends(require_permission("hr.payroll"))):
    """معاينة عمولات المبيعات لأي فترة قبل تشغيل الرواتب فعلياً — dateTo غير شامل (exclusive)"""
    return await service.commissions_preview(user.company_id, dateFrom, dateTo)


@router.get("/payroll-runs", response_model=list[PayrollRunOut])
async def list_payroll_runs(user: CurrentUser = Depends(require_permission("hr.payroll"))):
    return await service.list_payroll_runs(user.company_id)


@router.post("/payroll-runs", response_model=PayrollRunResultOut, status_code=201)
async def run_payroll(body: PayrollRunCreate, user: CurrentUser = Depends(require_permission("hr.payroll"))):
    """تشغيل رواتب الشهر: بيحسب لكل موظف نشط راتبه + تأمينات − خصومات المخالفات"""
    return await service.run_payroll(user.company_id, user.user_id, body.periodMonth, body.periodYear)


@router.get("/payroll-runs/{run_id}/payslips", response_model=list[PayslipOut])
async def get_payslips(run_id: str, user: CurrentUser = Depends(require_permission("hr.payroll"))):
    return await service.get_payslips(user.company_id, run_id)


@router.post("/payroll-runs/{run_id}/finalize", response_model=PayrollRunOut)
async def finalize_payroll_run(run_id: str, user: CurrentUser = Depends(require_permission("hr.payroll"))):
    """اعتماد المسير — يسجّل قيد الرواتب الشامل في دفتر اليومية (مصروف + تأمينات + صافي مستحق)"""
    return await service.finalize_payroll_run(user.company_id, run_id)


@router.post("/payroll-runs/{run_id}/pay", response_model=PayrollRunOut)
async def pay_payroll_run(run_id: str, body: PayrollPayIn,
                          user: CurrentUser = Depends(require_permission("hr.payroll"))):
    """تسجيل الصرف الفعلي لصافي الرواتب (بعد الاعتماد) — مدين رواتب مستحقة، دائن النقد/البنك"""
    return await service.pay_payroll_run(user.company_id, user.user_id, run_id, body.method)


# ══════════════════ عهد الموظفين ══════════════════

@router.get("/custody", response_model=list[CustodyItemOut])
async def list_custody_items(employeeId: str | None = Query(default=None),
                             status: str | None = Query(default=None),
                             user: CurrentUser = Depends(require_permission("hr.view", "hr.custody"))):
    return await service.list_custody_items(user.company_id, employeeId, status, user.branch_scope)


@router.post("/custody", response_model=CustodyItemOut, status_code=201)
async def create_custody_item(body: CustodyItemCreate, user: CurrentUser = Depends(require_permission("hr.custody"))):
    return await service.create_custody_item(user.company_id, user.user_id, body.model_dump(), user.branch_scope)


@router.put("/custody/{item_id}/status", response_model=CustodyItemOut)
async def update_custody_status(item_id: str, body: CustodyStatusBody,
                                user: CurrentUser = Depends(require_permission("hr.custody"))):
    return await service.update_custody_status(user.company_id, item_id, body.model_dump(), user.branch_scope)


# ══════════════════ الطلبات الإلكترونية العامة ══════════════════

@router.get("/requests", response_model=list[EmployeeRequestOut])
async def list_employee_requests(employeeId: str | None = Query(default=None),
                                 requestType: str | None = Query(default=None),
                                 status: str | None = Query(default=None),
                                 user: CurrentUser = Depends(require_permission("hr.view", "hr.requests_approve"))):
    return await service.list_employee_requests(user.company_id, employeeId, requestType, status, user.branch_scope)


@router.post("/requests", response_model=EmployeeRequestOut, status_code=201)
async def create_employee_request(body: EmployeeRequestCreate,
                                  user: CurrentUser = Depends(require_permission("hr.manage", "hr.requests_approve"))):
    return await service.create_employee_request(user.company_id, user.user_id, body.model_dump(), user.branch_scope)


@router.post("/requests/{request_id}/decision", response_model=EmployeeRequestOut)
async def decide_employee_request(request_id: str, body: EmployeeRequestDecisionBody,
                                  user: CurrentUser = Depends(require_permission("hr.requests_approve"))):
    return await service.decide_employee_request(user.company_id, user.user_id, request_id, body.model_dump(), user.branch_scope)


async def _violations(user: CurrentUser, employee_id: str | None):
    rows = await service.list_violations(user.company_id, employee_id, user.branch_scope)
    if not user.has("hr.salary.view"):
        for r in rows:
            r["deduction_amount"] = None
    return rows


# ══════════════════ لوحة الموارد البشرية وملف الموظف 360° ══════════════════

@router.get("/overview")
async def hr_overview(user: CurrentUser = Depends(require_permission("hr.view", "hr.manage"))):
    return await overview.dashboard(user.company_id, user.branch_scope, _viewer(user))


@router.get("/employees/{employee_id}/360")
async def employee_360(employee_id: str, user: CurrentUser = Depends(require_permission("hr.view", "hr.manage"))):
    return await overview.employee_360(user.company_id, employee_id, user.branch_scope, _viewer(user))


@router.get("/employees/{employee_id}/history")
async def employee_history(employee_id: str, user: CurrentUser = Depends(require_permission("hr.view", "hr.manage"))):
    return await overview.employee_history(user.company_id, employee_id, user.branch_scope, _viewer(user))


# ══════════════════ الأقسام والوظائف وجداول الدوام ══════════════════

@router.get("/departments")
async def list_departments(user: CurrentUser = Depends(require_permission("hr.view", "hr.manage"))):
    return await org.list_departments(user.company_id)


@router.post("/departments", status_code=201)
async def create_department(body: DepartmentBody, user: CurrentUser = Depends(require_permission("hr.manage"))):
    return await org.save_department(user.company_id, body.model_dump())


@router.put("/departments/{dept_id}")
async def update_department(dept_id: str, body: DepartmentBody, user: CurrentUser = Depends(require_permission("hr.manage"))):
    return await org.save_department(user.company_id, body.model_dump(), dept_id)


@router.get("/positions")
async def list_positions(user: CurrentUser = Depends(require_permission("hr.view", "hr.manage"))):
    return await org.list_positions(user.company_id)


@router.post("/positions", status_code=201)
async def create_position(body: PositionBody, user: CurrentUser = Depends(require_permission("hr.manage"))):
    return await org.save_position(user.company_id, body.model_dump())


@router.put("/positions/{pos_id}")
async def update_position(pos_id: str, body: PositionBody, user: CurrentUser = Depends(require_permission("hr.manage"))):
    return await org.save_position(user.company_id, body.model_dump(), pos_id)


@router.get("/schedules")
async def list_schedules(user: CurrentUser = Depends(require_permission("hr.view", "hr.manage", "hr.attendance"))):
    return await org.list_schedules(user.company_id)


@router.post("/schedules", status_code=201)
async def create_schedule(body: ScheduleBody, user: CurrentUser = Depends(require_permission("hr.manage"))):
    return await org.save_schedule(user.company_id, body.model_dump())


@router.put("/schedules/{sched_id}")
async def update_schedule(sched_id: str, body: ScheduleBody, user: CurrentUser = Depends(require_permission("hr.manage"))):
    return await org.save_schedule(user.company_id, body.model_dump(), sched_id)


# ══════════════════ العقود والمستندات ══════════════════

@router.get("/contracts")
async def list_contracts(employeeId: str | None = Query(default=None), status: str | None = Query(default=None),
                         expiringDays: int | None = Query(default=None, ge=0, le=365),
                         user: CurrentUser = Depends(require_permission("hr.view", "hr.manage"))):
    return await org.list_contracts(user.company_id, employeeId, user.branch_scope, _viewer(user), status, expiringDays)


@router.post("/contracts", status_code=201)
async def create_contract(body: ContractBody, user: CurrentUser = Depends(require_permission("hr.manage"))):
    return await org.create_contract(user.company_id, body.model_dump(), user.branch_scope, _actor(user), _viewer(user))


@router.post("/contracts/{contract_id}/end")
async def end_contract(contract_id: str, body: ReasonBody, user: CurrentUser = Depends(require_permission("hr.manage"))):
    return await org.end_contract(user.company_id, contract_id, user.branch_scope, _actor(user), body.reason)


@router.get("/documents")
async def list_documents(employeeId: str | None = Query(default=None),
                         expiringDays: int | None = Query(default=None, ge=0, le=365),
                         user: CurrentUser = Depends(require_permission("hr.view", "hr.manage"))):
    return await org.list_documents(user.company_id, employeeId, user.branch_scope, expiringDays)


@router.post("/documents", status_code=201)
async def create_document(body: DocumentBody, user: CurrentUser = Depends(require_permission("hr.manage"))):
    if not body.employeeId:
        raise HTTPException(400, "الموظف مطلوب")
    return await org.save_document(user.company_id, body.model_dump(), user.branch_scope, _actor(user))


@router.put("/documents/{doc_id}")
async def update_document(doc_id: str, body: DocumentBody, user: CurrentUser = Depends(require_permission("hr.manage"))):
    return await org.save_document(user.company_id, body.model_dump(), user.branch_scope, _actor(user), doc_id)


# ══════════════════ إعدادات الموارد البشرية ══════════════════

@router.get("/leave-types")
async def list_leave_types(user: CurrentUser = Depends(require_permission("hr.view", "hr.manage", "hr.leave_approve"))):
    return await org.list_leave_types(user.company_id)


@router.post("/leave-types", status_code=201)
async def create_leave_type(body: LeaveTypeBody, user: CurrentUser = Depends(require_permission("hr.manage"))):
    return await org.save_leave_type(user.company_id, body.model_dump())


@router.put("/leave-types/{type_id}")
async def update_leave_type(type_id: str, body: LeaveTypeBody, user: CurrentUser = Depends(require_permission("hr.manage"))):
    return await org.save_leave_type(user.company_id, body.model_dump(), type_id)


@router.get("/settings")
async def get_hr_settings(user: CurrentUser = Depends(require_permission("hr.view", "hr.manage"))):
    return await org.get_settings(user.company_id)


@router.put("/settings")
async def put_hr_settings(body: HrSettingsBody, user: CurrentUser = Depends(require_permission("hr.payroll"))):
    """قواعد نهاية الخدمة والإجازة ونسب/وعاء التأمينات — تغييرها يؤثر على المسيرات القادمة، وكل تعديل يُسجَّل في التدقيق"""
    return await org.update_settings(user.company_id, body.model_dump(exclude_none=True), _actor(user))
