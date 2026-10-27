# modules/hr/schemas.py — عقود الإدخال والإخراج (Pydantic) — خمسة أقسام
from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, Field

ContractType = Literal["full_time", "part_time", "temporary"]
LeaveType = Literal["annual", "sick", "unpaid", "other"]
LeaveStatus = Literal["pending", "approved", "rejected"]
CommissionType = Literal["none", "pct_sales", "pct_profit"]


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
    commissionType: CommissionType = "none"    # عمولة مبيعات: من صافي المبيعات أو من الربح الإجمالي
    commissionPct: float = Field(default=0, ge=0, le=100)
    departmentId: str | None = None
    positionId: str | None = None
    managerId: str | None = None
    scheduleId: str | None = None
    gender: Literal["male", "female"] | None = None
    email: str | None = None
    address: str | None = None
    gosiNumber: str | None = None
    gosiStatus: str | None = None
    housingAllowance: float | None = Field(default=None, ge=0)
    transportAllowance: float | None = Field(default=None, ge=0)
    otherAllowance: float | None = Field(default=None, ge=0)


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
    commissionType: CommissionType | None = None
    commissionPct: float | None = Field(default=None, ge=0, le=100)
    departmentId: str | None = None
    positionId: str | None = None
    managerId: str | None = None
    scheduleId: str | None = None
    gender: Literal["male", "female"] | None = None
    email: str | None = None
    address: str | None = None
    gosiNumber: str | None = None
    gosiStatus: str | None = None
    housingAllowance: float | None = Field(default=None, ge=0)
    transportAllowance: float | None = Field(default=None, ge=0)
    otherAllowance: float | None = Field(default=None, ge=0)


class EmployeeOut(BaseModel):
    id: str
    branch_id: str | None = None
    branch_name: str | None = None
    linked_user_id: str | None = None
    linked_email: str | None = None
    full_name: str
    national_id: str | None = None          # مُقنَّع (****1234) لمن لا يملك hr.identity.view
    nationality: str | None = None
    is_saudi: bool
    birth_date: date | None = None
    phone: str | None = None
    job_title: str | None = None
    contract_type: str
    hire_date: date
    termination_date: date | None = None
    basic_salary: float | None = None       # None لمن لا يملك hr.salary.view
    iban: str | None = None                 # None لمن لا يملك hr.salary.view
    iqama_number: str | None = None         # مُقنَّع لمن لا يملك hr.identity.view
    iqama_expiry_date: date | None = None
    approval_pin: str | None = None         # لمن يملك hr.manage فقط
    allowances: float | None = None
    housing_allowance: float | None = None
    transport_allowance: float | None = None
    other_allowance: float | None = None
    commission_type: CommissionType = "none"
    commission_pct: float | None = None
    department_id: str | None = None
    department_name: str | None = None
    position_id: str | None = None
    position_name: str | None = None
    manager_id: str | None = None
    schedule_id: str | None = None
    gender: str | None = None
    email: str | None = None
    address: str | None = None
    gosi_number: str | None = None
    gosi_status: str | None = None
    is_active: bool


class EndOfServiceOut(BaseModel):
    totalYears: float
    amount: float | None = None
    note: str


class TerminateBody(BaseModel):
    terminationDate: str | None = None
    reason: str | None = None


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
    schedule_name: str | None = None
    worked_minutes: int | None = None
    late_minutes: int | None = None
    early_minutes: int | None = None
    overtime_minutes: int | None = None
    day_status: str | None = None   # present | late | early_leave | absent


class CheckInBody(BaseModel):
    employeeId: str


# ══════════════════ الإجازات ══════════════════

class LeaveCreate(BaseModel):
    employeeId: str
    leaveType: str = "annual"   # أحد الأنواع الأساسية أو نوع مُعرَّف في إعدادات الموارد البشرية
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
    byType: list[dict] = []   # استخدام كل نوع إجازة هذا العام (والمتبقي لما له حصة سنوية معرّفة)


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
    paid_at: datetime | None = None
    payment_method: str | None = None


class PayrollPayIn(BaseModel):
    method: Literal["cash", "card", "transfer"] = "transfer"


class PayslipOut(BaseModel):
    id: str
    employee_id: str
    employee_name: str
    job_title: str | None = None
    iban: str | None = None
    basic_salary: float
    allowances: float
    commission_amount: float = 0
    violations_deduction: float
    other_deductions: float
    advance_deduction: float = 0
    gosi_employee: float
    gosi_employer: float
    net_pay: float


class PayrollRunResultOut(BaseModel):
    run: PayrollRunOut
    payslips: list[PayslipOut]


class CommissionPreviewRow(BaseModel):
    employee_id: str
    employee_name: str
    commission_type: CommissionType
    commission_pct: float
    sales_ex: float
    gross_profit: float
    commission_amount: float


# ══════════════════ عهد الموظفين ══════════════════

CustodyStatus = Literal["held", "returned", "lost"]


class CustodyItemCreate(BaseModel):
    employeeId: str
    itemName: str = Field(min_length=1, max_length=200)
    description: str | None = None
    estimatedValue: float = Field(default=0, ge=0)
    assignedDate: str | None = None
    notes: str | None = None


class CustodyStatusBody(BaseModel):
    status: CustodyStatus
    returnedDate: str | None = None
    notes: str | None = None


class CustodyItemOut(BaseModel):
    id: str
    employee_id: str
    employee_name: str
    item_name: str
    description: str | None = None
    estimated_value: float
    assigned_date: date
    returned_date: date | None = None
    status: str
    notes: str | None = None
    created_at: datetime


# ══════════════════ الطلبات الإلكترونية العامة ══════════════════
# (الإجازات لها مسارها الخاص فوق — هنا بقية الأنواع: نقل فرع / مستلزمات / بلاغ عطل)

RequestType = Literal["branch_transfer", "supplies", "malfunction_report"]
RequestStatus = Literal["pending", "approved", "rejected"]


class EmployeeRequestCreate(BaseModel):
    employeeId: str
    requestType: RequestType
    title: str | None = None
    details: dict = Field(default_factory=dict)


class EmployeeRequestDecisionBody(BaseModel):
    decision: Literal["approved", "rejected"]
    decisionNote: str | None = None


class EmployeeRequestOut(BaseModel):
    id: str
    employee_id: str
    employee_name: str
    request_type: str
    title: str | None = None
    details: dict
    status: str
    decided_by_name: str | None = None
    decided_at: datetime | None = None
    decision_note: str | None = None
    created_at: datetime


# ══════════════════ الهيكل التنظيمي / العقود / المستندات / الإعدادات ══════════════════

class DepartmentBody(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    isActive: bool | None = None


class PositionBody(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    departmentId: str | None = None
    isActive: bool | None = None


class ScheduleBody(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    startTime: str
    endTime: str
    graceMinutes: int = Field(default=0, ge=0, le=240)
    weeklyOff: list[int] = [5]
    isActive: bool | None = None


class ContractBody(BaseModel):
    employeeId: str
    contractType: ContractType = "full_time"
    startDate: str
    endDate: str | None = None
    basicSalary: float | None = Field(default=None, ge=0)
    notes: str | None = None


class ReasonBody(BaseModel):
    reason: str | None = None


class DocumentBody(BaseModel):
    employeeId: str | None = None
    docType: str = Field(min_length=1, max_length=80)
    docNumber: str | None = None
    issueDate: str | None = None
    expiryDate: str | None = None
    notes: str | None = None


class LeaveTypeBody(BaseModel):
    code: str | None = None
    name: str = Field(min_length=2, max_length=80)
    annualDays: int | None = Field(default=None, ge=0, le=365)
    isPaid: bool | None = None
    isActive: bool | None = None


class HrSettingsBody(BaseModel):
    eosFirstYearsMonths: float | None = None
    eosAfterMonths: float | None = None
    eosThresholdYears: float | None = None
    leaveDaysBefore: int | None = None
    leaveDaysAfter: int | None = None
    leaveThresholdYears: float | None = None
    gosiSaudiEmployeePct: float | None = None
    gosiSaudiEmployerPct: float | None = None
    gosiNonsaudiEmployerPct: float | None = None
    gosiBasis: Literal["basic", "basic_allowances"] | None = None
