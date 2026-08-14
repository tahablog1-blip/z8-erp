# modules/hr/api.py — طبقة الـ HTTP: مسارات + صلاحيات فقط
from fastapi import APIRouter, Depends, Query

from ...core.deps import CurrentUser, require_permission
from . import service
from .schemas import (
    AttendanceOut, CheckInBody, EmployeeCreate, EmployeeOut, EmployeeUpdate,
    IqamaAlertOut, LeaveBalanceOut, LeaveCreate, LeaveDecisionBody, LeaveOut,
    PayrollRunCreate, PayrollRunOut, PayrollRunResultOut, PayslipOut,
    TerminateBody, TerminateOut, ViolationCreate, ViolationOut,
)

router = APIRouter()


# ══════════════════ الموظفون ══════════════════

@router.get("/employees", response_model=list[EmployeeOut])
async def list_employees(branchId: str | None = Query(default=None),
                         user: CurrentUser = Depends(require_permission("hr.view", "hr.manage"))):
    return await service.list_employees(user.company_id, user.branch_scope, branchId)


@router.post("/employees", response_model=EmployeeOut, status_code=201)
async def create_employee(body: EmployeeCreate, user: CurrentUser = Depends(require_permission("hr.manage"))):
    return await service.create_employee(user.company_id, user.branch_scope, body.model_dump())


@router.put("/employees/{employee_id}", response_model=EmployeeOut)
async def update_employee(employee_id: str, body: EmployeeUpdate,
                          user: CurrentUser = Depends(require_permission("hr.manage"))):
    return await service.update_employee(user.company_id, employee_id, body.model_dump(exclude_unset=True))


@router.post("/employees/{employee_id}/terminate", response_model=TerminateOut)
async def terminate_employee(employee_id: str, body: TerminateBody,
                             user: CurrentUser = Depends(require_permission("hr.manage"))):
    """إنهاء خدمة (تعطيل ناعم) — بيرجّع تقدير مكافأة نهاية الخدمة"""
    return await service.terminate_employee(user.company_id, employee_id, body.terminationDate)


@router.get("/iqama-alerts", response_model=list[IqamaAlertOut])
async def iqama_alerts(daysAhead: int = Query(default=60, ge=1, le=365),
                       user: CurrentUser = Depends(require_permission("hr.view", "hr.manage"))):
    return await service.iqama_alerts(user.company_id, daysAhead)


# ══════════════════ الحضور والانصراف ══════════════════

@router.get("/attendance", response_model=list[AttendanceOut])
async def list_attendance(date_from: str | None = Query(default=None, alias="from"),
                          date_to: str | None = Query(default=None, alias="to"),
                          employeeId: str | None = Query(default=None),
                          user: CurrentUser = Depends(require_permission("hr.view", "hr.attendance"))):
    return await service.list_attendance(user.company_id, date_from, date_to, employeeId)


@router.post("/attendance/check-in", response_model=AttendanceOut, status_code=201)
async def check_in(body: CheckInBody, user: CurrentUser = Depends(require_permission("hr.attendance"))):
    """تسجيل حضور — بيفتح سجل اليوم لو مش موجود، أو يسيب أول وقت حضور مسجّل زي ما هو"""
    return await service.check_in(user.company_id, user.user_id, body.employeeId)


@router.post("/attendance/check-out", response_model=AttendanceOut)
async def check_out(body: CheckInBody, user: CurrentUser = Depends(require_permission("hr.attendance"))):
    return await service.check_out(user.company_id, body.employeeId)


# ══════════════════ الإجازات ══════════════════

@router.get("/leave-requests", response_model=list[LeaveOut])
async def list_leave_requests(employeeId: str | None = Query(default=None),
                              status: str | None = Query(default=None),
                              user: CurrentUser = Depends(require_permission("hr.view", "hr.leave_approve"))):
    return await service.list_leave_requests(user.company_id, employeeId, status)


@router.post("/leave-requests", response_model=LeaveOut, status_code=201)
async def create_leave_request(body: LeaveCreate,
                               user: CurrentUser = Depends(require_permission("hr.manage", "hr.leave_approve"))):
    return await service.create_leave_request(user.company_id, body.model_dump())


@router.post("/leave-requests/{leave_id}/decision", response_model=LeaveOut)
async def decide_leave_request(leave_id: str, body: LeaveDecisionBody,
                               user: CurrentUser = Depends(require_permission("hr.leave_approve"))):
    return await service.decide_leave_request(user.company_id, user.user_id, leave_id, body.decision)


@router.get("/leave-balance/{employee_id}", response_model=LeaveBalanceOut)
async def leave_balance(employee_id: str,
                        user: CurrentUser = Depends(require_permission("hr.view", "hr.leave_approve"))):
    return await service.leave_balance(user.company_id, employee_id)


# ══════════════════ المخالفات ══════════════════

@router.get("/violations", response_model=list[ViolationOut])
async def list_violations(employeeId: str | None = Query(default=None),
                          user: CurrentUser = Depends(require_permission("hr.view", "hr.violations"))):
    return await service.list_violations(user.company_id, employeeId)


@router.post("/violations", response_model=ViolationOut, status_code=201)
async def create_violation(body: ViolationCreate, user: CurrentUser = Depends(require_permission("hr.violations"))):
    return await service.create_violation(user.company_id, user.user_id, body.model_dump())


# ══════════════════ الرواتب ══════════════════

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
    return await service.finalize_payroll_run(user.company_id, run_id)
