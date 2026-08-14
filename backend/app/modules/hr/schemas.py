# modules/hr/schemas.py — عقود الإدخال والإخراج (Pydantic) — خمسة أقسام
from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, Field

ContractType = Literal["full_time", "part_time", "temporary"]
LeaveType = Literal["annual", "sick", "unpaid", "other"]
LeaveStatus = Literal["pending", "approved", "rejected"]


# ══════════════════ الموظفون ══════════════════

class EmployeeCreate(BaseModel):
    branchId: str | None = None
    linkedUserId: str | None = None
    fullName: str = Field(min_length=2, max_length=200)
    nationalId: str | None = None
    nationality: str | None = None
    isSaudi: bool = False
    birthDate: str | None = None
    phone: str | None = None
    jobTitle: str | None = None
    techRole: str | None = None   # filling / fitting / checking — دور الفني في الورشة
    contractType: ContractType = "full_time"
    hireDate: str | None = None
    basicSalary: float = Field(default=0, ge=0)
    iban: str | None = None
    iqamaNumber: str | None = None
    iqamaExpiryDate: str | None = None
    approvalPin: str | None = None   # رمز اعتماد أوامر العمل من التابلت (4-6 أرقام، فريد بالشركة)
    allowances: float = Field(default=0, ge=0)   # البدلات الشهرية — تدخل في صافي الراتب


class EmployeeUpdate(BaseModel):
    branchId: str | None = None
    linkedUserId: str | None = None
    fullName: str | None = Field(default=None, min_length=2, max_length=200)
    nationalId: str | None = None
    nationality: str | None = None
    isSaudi: bool | None = None
    birthDate: str | None = None
    phone: str | None = None
    jobTitle: str | None = None
    techRole: str | None = None
    contractType: ContractType | None = None
    hireDate: str | None = None
    basicSalary: float | None = Field(default=None, ge=0)
    iban: str | None = None
    iqamaNumber: str | None = None
    iqamaExpiryDate: str | None = None
    approvalPin: str | None = None
    allowances: float | None = Field(default=None, ge=0)


class EmployeeOut(BaseModel):
    id: str
    branch_id: str | None = None
    branch_name: str | None = None
    linked_user_id: str | None = None
    linked_email: str | None = None
    full_name: str
    national_id: str | None = None
    nationality: str | None = None
    is_saudi: bool
    birth_date: date | None = None
    phone: str | None = None
    job_title: str | None = None
    contract_type: str
    hire_date: date
    termination_date: date | None = None
    basic_salary: float
    iban: str | None = None
    iqama_number: str | None = None
    iqama_expiry_date: date | None = None
    approval_pin: str | None = None   # ظاهر لمشرفي HR فقط — الصفحة كلها خلف hr.view/hr.manage
    allowances: float = 0
    is_active: bool


class EndOfServiceOut(BaseModel):
    totalYears: float
    amount: float
    note: str


class TerminateBody(BaseModel):
    terminationDate: str | None = None


class TerminateOut(BaseModel):
    success: bool = True
    endOfServiceEstimate: EndOfServiceOut


class IqamaAlertOut(BaseModel):
    id: str
    full_name: str
    iqama_number: str | None = None
    iqama_expiry_date: date
    phone: str | None = None
    branch_name: str | None = None
    days_remaining: int


# ══════════════════ الحضور والانصراف ══════════════════

class AttendanceOut(BaseModel):
    id: str
    employee_id: str
    employee_name: str
    work_date: date
    check_in: datetime | None = None
    check_out: datetime | None = None
    notes: str | None = None


class CheckInBody(BaseModel):
    employeeId: str


# ══════════════════ الإجازات ══════════════════

class LeaveCreate(BaseModel):
    employeeId: str
    leaveType: LeaveType = "annual"
    startDate: str
    endDate: str
    reason: str | None = None


class LeaveDecisionBody(BaseModel):
    decision: Literal["approved", "rejected"]


class LeaveOut(BaseModel):
    id: str
    employee_id: str
    employee_name: str
    leave_type: str
    start_date: date
    end_date: date
    days_count: int
    status: str
    reason: str | None = None
    approved_by_name: str | None = None
    approved_at: datetime | None = None
    created_at: datetime


class LeaveBalanceOut(BaseModel):
    employeeId: str
    annualEntitlement: int
    used: int
    remaining: int
    note: str


# ══════════════════ المخالفات ══════════════════

class ViolationCreate(BaseModel):
    employeeId: str
    violationDate: str | None = None
    violationType: str = Field(min_length=1)
    description: str | None = None
    deductionAmount: float = Field(default=0, ge=0)


class ViolationOut(BaseModel):
    id: str
    employee_id: str
    employee_name: str
    violation_date: date
    violation_type: str
    description: str | None = None
    deduction_amount: float
    issued_by_name: str | None = None
    created_at: datetime


# ══════════════════ الرواتب ══════════════════

class PayrollRunCreate(BaseModel):
    periodMonth: int = Field(ge=1, le=12)
    periodYear: int = Field(ge=2000, le=2100)


class PayrollRunOut(BaseModel):
    id: str
    period_month: int
    period_year: int
    status: str
    payslip_count: int | None = None
    total_net: float | None = None
    created_at: datetime
    finalized_at: datetime | None = None


class PayslipOut(BaseModel):
    id: str
    employee_id: str
    employee_name: str
    job_title: str | None = None
    iban: str | None = None
    basic_salary: float
    allowances: float
    violations_deduction: float
    other_deductions: float
    gosi_employee: float
    gosi_employer: float
    net_pay: float


class PayrollRunResultOut(BaseModel):
    run: PayrollRunOut
    payslips: list[PayslipOut]
