// modules/hr/types.ts — عقود الموارد البشرية المشتركة بين الشاشات

export type Employee = {
  id: string;
  branch_id: string | null;
  branch_name: string | null;
  linked_user_id: string | null;
  linked_email: string | null;
  full_name: string;
  national_id: string | null;          // مُقنَّع من الخادم لمن لا يملك hr.identity.view
  nationality: string | null;
  is_saudi: boolean;
  birth_date: string | null;
  phone: string | null;
  job_title: string | null;
  contract_type: "full_time" | "part_time" | "temporary";
  hire_date: string;
  termination_date: string | null;
  basic_salary: number | null;         // null = لا يملك المستخدم hr.salary.view
  iban: string | null;
  iqama_number: string | null;
  iqama_expiry_date: string | null;
  approval_pin?: string | null;
  allowances?: number | null;
  housing_allowance?: number | null;
  transport_allowance?: number | null;
  other_allowance?: number | null;
  commission_type: CommissionType;
  commission_pct: number | null;
  department_id?: string | null;
  department_name?: string | null;
  position_id?: string | null;
  position_name?: string | null;
  manager_id?: string | null;
  schedule_id?: string | null;
  gender?: string | null;
  email?: string | null;
  address?: string | null;
  gosi_number?: string | null;
  gosi_status?: string | null;
  is_active: boolean;
};

export type CommissionType = "none" | "pct_sales" | "pct_profit";
export const COMMISSION_TYPE_LABELS: Record<CommissionType, string> = {
  none: "بدون عمولة", pct_sales: "نسبة من صافي المبيعات", pct_profit: "نسبة من الربح الإجمالي",
};

export const CONTRACT_LABELS: Record<Employee["contract_type"], string> = {
  full_time: "دوام كامل", part_time: "دوام جزئي", temporary: "مؤقت",
};

export type IqamaAlert = {
  id: string;
  full_name: string;
  iqama_number: string | null;
  iqama_expiry_date: string;
  phone: string | null;
  branch_name: string | null;
  days_remaining: number;
};

export type Attendance = {
  id: string;
  employee_id: string;
  employee_name: string;
  work_date: string;
  check_in: string | null;
  check_out: string | null;
  notes: string | null;
  schedule_name?: string | null;
  worked_minutes?: number | null;
  late_minutes?: number | null;
  early_minutes?: number | null;
  overtime_minutes?: number | null;
  day_status?: "present" | "late" | "early_leave" | "absent";
};

export type LeaveType = string;   // أساسي (annual/sick/unpaid/other) أو رمز نوع مُعرَّف في إعدادات HR
export const LEAVE_TYPE_LABELS: Record<string, string> = {
  annual: "سنوية", sick: "مرضية", unpaid: "بدون راتب", other: "أخرى",
};

export type LeaveRequest = {
  id: string;
  employee_id: string;
  employee_name: string;
  leave_type: LeaveType;
  start_date: string;
  end_date: string;
  days_count: number;
  status: "pending" | "approved" | "rejected";
  reason: string | null;
  approved_by_name: string | null;
};

export type LeaveBalance = {
  employeeId: string;
  annualEntitlement: number;
  used: number;
  remaining: number;
  note: string;
  byType?: { code: string; name: string; used: number; entitlement: number | null; remaining: number | null }[];
};

export type Violation = {
  id: string;
  employee_id: string;
  employee_name: string;
  violation_date: string;
  violation_type: string;
  description: string | null;
  deduction_amount: number | null;
  issued_by_name: string | null;
};

export type PayrollRun = {
  id: string;
  period_month: number;
  period_year: number;
  status: "draft" | "finalized" | "paid";
  payslip_count: number | null;
  total_net: number | null;
  paid_at?: string | null;
  payment_method?: string | null;
};

export type Payslip = {
  id: string;
  employee_id: string;
  employee_name: string;
  job_title: string | null;
  iban: string | null;
  basic_salary: number;
  allowances: number;
  commission_amount: number;
  violations_deduction: number;
  other_deductions: number;
  advance_deduction: number;
  gosi_employee: number;
  gosi_employer: number;
  net_pay: number;
};

export type CommissionPreviewRow = {
  employee_id: string;
  employee_name: string;
  commission_type: CommissionType;
  commission_pct: number;
  sales_ex: number;
  gross_profit: number;
  commission_amount: number;
};

export type CustodyStatus = "held" | "returned" | "lost";
export const CUSTODY_STATUS_LABELS: Record<CustodyStatus, string> = {
  held: "محتجزة لدى الموظف", returned: "مُرجعة", lost: "مفقودة",
};

export type CustodyItem = {
  id: string;
  employee_id: string;
  employee_name: string;
  item_name: string;
  description: string | null;
  estimated_value: number;
  assigned_date: string;
  returned_date: string | null;
  status: CustodyStatus;
  notes: string | null;
};

export type RequestType = "branch_transfer" | "supplies" | "malfunction_report";
export const REQUEST_TYPE_LABELS: Record<RequestType, string> = {
  branch_transfer: "نقل فرع", supplies: "مستلزمات", malfunction_report: "بلاغ عطل",
};

export type EmployeeRequest = {
  id: string;
  employee_id: string;
  employee_name: string;
  request_type: RequestType;
  title: string | null;
  details: Record<string, any>;
  status: "pending" | "approved" | "rejected";
  decided_by_name: string | null;
  decision_note: string | null;
};

// تنسيق الأرقام يحترم إعداد "تنسيق الأرقام" بالنظام (لاتينية/عربية هندية) — راجع lib/format.ts
export { money } from "@/lib/format";
