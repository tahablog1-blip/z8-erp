// modules/hr/types.ts — عقود الموارد البشرية المشتركة بين الشاشات

export type Employee = {
  id: string;
  branch_id: string | null;
  branch_name: string | null;
  linked_user_id: string | null;
  linked_email: string | null;
  full_name: string;
  national_id: string | null;
  nationality: string | null;
  is_saudi: boolean;
  birth_date: string | null;
  phone: string | null;
  job_title: string | null;
  contract_type: "full_time" | "part_time" | "temporary";
  hire_date: string;
  termination_date: string | null;
  basic_salary: number;
  iban: string | null;
  iqama_number: string | null;
  iqama_expiry_date: string | null;
  is_active: boolean;
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
};

export type LeaveType = "annual" | "sick" | "unpaid" | "other";
export const LEAVE_TYPE_LABELS: Record<LeaveType, string> = {
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
};

export type Violation = {
  id: string;
  employee_id: string;
  employee_name: string;
  violation_date: string;
  violation_type: string;
  description: string | null;
  deduction_amount: number;
  issued_by_name: string | null;
};

export type PayrollRun = {
  id: string;
  period_month: number;
  period_year: number;
  status: "draft" | "finalized";
  payslip_count: number | null;
  total_net: number | null;
};

export type Payslip = {
  id: string;
  employee_id: string;
  employee_name: string;
  job_title: string | null;
  iban: string | null;
  basic_salary: number;
  allowances: number;
  violations_deduction: number;
  other_deductions: number;
  gosi_employee: number;
  gosi_employer: number;
  net_pay: number;
};

export const money = (n: number) =>
  Number(n || 0).toLocaleString("ar-SA-u-nu-latn", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
