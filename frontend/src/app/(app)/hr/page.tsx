"use client";
// شاشة الموارد البشرية — الموظفون، الحضور والانصراف، الإجازات، المخالفات، الرواتب
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { LoadingScreen } from "@/components/LoadingScreen";
import { DataTable, Column } from "@/components/DataTable";
import { Badge, Button, Card, ErrorNote, Field, Input, Modal, Select, Switch, Tabs, Textarea, PageHeader } from "@/components/ui";
import { appAlert, appConfirm } from "@/components/dialog";
import {
  Attendance, CommissionPreviewRow, CommissionType, COMMISSION_TYPE_LABELS, CONTRACT_LABELS,
  CustodyItem, CustodyStatus, CUSTODY_STATUS_LABELS, Employee, EmployeeRequest,
  IqamaAlert, LEAVE_TYPE_LABELS, LeaveBalance,
  LeaveRequest, LeaveType, PayrollRun, Payslip, RequestType, REQUEST_TYPE_LABELS, Violation, money,
} from "@/modules/hr/types";
import { formatDate, formatTime } from "@/lib/format";
import { HrDashboard } from "@/components/hr/HrDashboard";
import { OrgPanel } from "@/components/hr/OrgPanel";
import { ContractsPanel } from "@/components/hr/ContractsPanel";
import { DocumentsPanel } from "@/components/hr/DocumentsPanel";
import { HrSettingsPanel } from "@/components/hr/HrSettingsPanel";
import { Avatar, DayStatus, Hidden, fmtMin, MONTHS_AR } from "@/components/hr/shared";
import { printReport, tableHTML, kpisHTML } from "@/lib/print";

type Branch = { id: string; name: string };
type Tab = "dashboard" | "employees" | "attendance" | "leave" | "violations" | "payroll" | "custody" | "requests" | "contracts" | "documents" | "org" | "settings";
type Lookup = { id: string; name: string; department_id?: string | null; is_active: boolean };
type Sched = { id: string; name: string; start_time: string; end_time: string; is_active: boolean };

const dateFmt = (s: string) => formatDate(s);
const timeFmt = (s: string | null) => (s ? formatTime(s) : "—");

const EMPTY_EMP = {
  branchId: "", fullName: "", nationalId: "", nationality: "", isSaudi: false, phone: "",
  jobTitle: "", techRole: "", contractType: "full_time" as Employee["contract_type"], hireDate: "",
  basicSalary: 0, allowances: 0, iban: "", iqamaNumber: "", iqamaExpiryDate: "", approvalPin: "",
  linkedUserId: "", commissionType: "none" as CommissionType, commissionPct: 0,
  departmentId: "", positionId: "", managerId: "", scheduleId: "", gender: "", email: "", address: "",
  gosiNumber: "", gosiStatus: "", housingAllowance: 0, transportAllowance: 0, otherAllowance: 0,
};

export default function HrPage() {
  const { hasPerm } = useAuth();
  const canView = hasPerm("hr.view", "hr.manage");
  const canManage = hasPerm("hr.manage");
  const canAttendance = hasPerm("hr.attendance");
  const canLeaveApprove = hasPerm("hr.leave_approve");
  const canViolations = hasPerm("hr.violations");
  const canPayroll = hasPerm("hr.payroll");
  const canCustody = hasPerm("hr.custody");
  const canRequestsApprove = hasPerm("hr.requests_approve");
  const canRequestsCreate = hasPerm("hr.manage", "hr.requests_approve");
  const canSalary = hasPerm("hr.salary.view");
  const canIdentity = hasPerm("hr.identity.view");

  const [tab, setTab] = useState<Tab>(canView ? "dashboard" : "attendance");
  useEffect(() => {   // رابط مباشر من مركز التقارير: /hr?tab=payroll
    const t = new URLSearchParams(window.location.search).get("tab") as Tab | null;
    if (t && ["payroll", "attendance", "leave", "contracts", "documents"].includes(t)) changeTab(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [departments, setDepartments] = useState<Lookup[]>([]);
  const [positions, setPositions] = useState<Lookup[]>([]);
  const [schedules, setSchedules] = useState<Sched[]>([]);
  const [leaveTypes, setLeaveTypes] = useState<{ code: string; name: string; is_active: boolean }[]>([]);
  const [fBranch, setFBranch] = useState(""); const [fDept, setFDept] = useState(""); const [fNat, setFNat] = useState("");
  const [fStatus, setFStatus] = useState(""); const [fContract, setFContract] = useState(""); const [fSearch, setFSearch] = useState("");
  const [branches, setBranches] = useState<Branch[]>([]);
  // ── حسابات الدخول للربط بالموظفين — المدير العام (admin) مستبعد عمداً ──
  type LoginUser = { id: string; email: string; full_name: string; role: string; is_active: boolean };
  const [loginUsers, setLoginUsers] = useState<LoginUser[]>([]);
  const [iqamaAlerts, setIqamaAlerts] = useState<IqamaAlert[]>([]);
  const [attendance, setAttendance] = useState<Attendance[]>([]);
  const [leaves, setLeaves] = useState<LeaveRequest[]>([]);
  const [violations, setViolations] = useState<Violation[]>([]);
  const [payrollRuns, setPayrollRuns] = useState<PayrollRun[]>([]);
  const [custodyItems, setCustodyItems] = useState<CustodyItem[]>([]);
  const [empRequests, setEmpRequests] = useState<EmployeeRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [pageErr, setPageErr] = useState("");

  useEffect(() => {
    api<LoginUser[]>("/settings/users")
      .then((us) => setLoginUsers(us.filter((u) => u.role !== "admin" && u.is_active)))
      .catch(() => setLoginUsers([]));   // مفيش صلاحية إدارة المستخدمين؟ الحقل يختفي بهدوء
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── نموذج موظف ──
  const [empModal, setEmpModal] = useState<null | { mode: "create" } | { mode: "edit"; emp: Employee }>(null);
  const [empForm, setEmpForm] = useState({ ...EMPTY_EMP });
  const [empErr, setEmpErr] = useState("");

  // ── نموذج إجازة ──
  const [leaveModal, setLeaveModal] = useState(false);
  const [leaveForm, setLeaveForm] = useState({ employeeId: "", leaveType: "annual" as string, startDate: "", endDate: "", reason: "" });
  const [leaveErr, setLeaveErr] = useState("");
  const [balance, setBalance] = useState<LeaveBalance | null>(null);

  // ── نموذج مخالفة ──
  const [violModal, setViolModal] = useState(false);
  const [violForm, setViolForm] = useState({ employeeId: "", violationType: "", description: "", deductionAmount: 0 });
  const [violErr, setViolErr] = useState("");

  // ── نموذج عهدة ──
  const [custodyModal, setCustodyModal] = useState(false);
  const [custodyForm, setCustodyForm] = useState({ employeeId: "", itemName: "", description: "", estimatedValue: 0, assignedDate: "", notes: "" });
  const [custodyErr, setCustodyErr] = useState("");

  // ── نموذج طلب عام (نقل فرع / مستلزمات / بلاغ عطل) ──
  const [reqModal, setReqModal] = useState(false);
  const [reqForm, setReqForm] = useState({ employeeId: "", requestType: "supplies" as RequestType, targetBranchId: "", itemsText: "", reason: "" });
  const [reqErr, setReqErr] = useState("");

  // ── الرواتب ──
  const [payrollModal, setPayrollModal] = useState(false);
  const [payMonth, setPayMonth] = useState(new Date().getMonth() + 1);
  const [payYear, setPayYear] = useState(new Date().getFullYear());
  const [payErr, setPayErr] = useState("");
  const [payBusy, setPayBusy] = useState(false);
  const [viewPayslips, setViewPayslips] = useState<{ run: PayrollRun; slips: Payslip[] } | null>(null);

  const [commPreviewOpen, setCommPreviewOpen] = useState(false);
  const [commFrom, setCommFrom] = useState("");
  const [commTo, setCommTo] = useState("");
  const [commRows, setCommRows] = useState<CommissionPreviewRow[]>([]);
  const [commErr, setCommErr] = useState("");
  const [commBusy, setCommBusy] = useState(false);

  const filteredEmployees = useMemo(() => {
    const q = fSearch.trim().toLowerCase();
    return employees.filter((e) =>
      (!fBranch || e.branch_id === fBranch) && (!fDept || e.department_id === fDept) &&
      (!fNat || (fNat === "saudi" ? e.is_saudi : !e.is_saudi)) &&
      (!fStatus || (fStatus === "active" ? e.is_active : !e.is_active)) && (!fContract || e.contract_type === fContract) &&
      (!q || [e.full_name, e.phone, e.email, e.national_id, e.iqama_number, e.department_name, e.position_name, e.job_title]
        .some((v) => String(v ?? "").toLowerCase().includes(q))));
  }, [employees, fBranch, fDept, fNat, fStatus, fContract, fSearch]);

  const employeeName = useMemo(() => {
    const m: Record<string, string> = {};
    employees.forEach((e) => { m[e.id] = e.full_name; });
    return m;
  }, [employees]);

  async function load() {
    setLoading(true);
    try {
      const calls: Promise<any>[] = [api<Branch[]>("/branches")];
      if (canView) { calls.push(api<Employee[]>("/hr/employees")); calls.push(api<IqamaAlert[]>("/hr/iqama-alerts")); }
      const results = await Promise.all(calls);
      setBranches(results[0]);
      if (canView) { setEmployees(results[1]); setIqamaAlerts(results[2]); }
      if (canView) {   // قوائم مرجعية للفلاتر والنموذج — فشلها لا يمنع الصفحة
        api<Lookup[]>("/hr/departments").then(setDepartments).catch(() => setDepartments([]));
        api<Lookup[]>("/hr/positions").then(setPositions).catch(() => setPositions([]));
        api<Sched[]>("/hr/schedules").then(setSchedules).catch(() => setSchedules([]));
        api<{ code: string; name: string; is_active: boolean }[]>("/hr/leave-types").then(setLeaveTypes).catch(() => setLeaveTypes([]));
      }
      setPageErr("");
    } catch (e: any) { setPageErr(e.message); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  async function loadAttendance() {
    try { setAttendance(await api<Attendance[]>("/hr/attendance")); } catch (e: any) { setPageErr(e.message); }
  }
  async function loadLeaves() {
    try { setLeaves(await api<LeaveRequest[]>("/hr/leave-requests")); } catch (e: any) { setPageErr(e.message); }
  }
  async function loadViolations() {
    try { setViolations(await api<Violation[]>("/hr/violations")); } catch (e: any) { setPageErr(e.message); }
  }
  async function loadPayroll() {
    try { setPayrollRuns(await api<PayrollRun[]>("/hr/payroll-runs")); } catch (e: any) { setPageErr(e.message); }
  }
  async function loadCustody() {
    try { setCustodyItems(await api<CustodyItem[]>("/hr/custody")); } catch (e: any) { setPageErr(e.message); }
  }
  async function loadRequests() {
    try { setEmpRequests(await api<EmployeeRequest[]>("/hr/requests")); } catch (e: any) { setPageErr(e.message); }
  }

  function changeTab(t: Tab) {
    setTab(t);
    if (t === "attendance" && attendance.length === 0) loadAttendance();
    if (t === "leave" && leaves.length === 0) loadLeaves();
    if (t === "violations" && violations.length === 0) loadViolations();
    if (t === "payroll" && payrollRuns.length === 0) loadPayroll();
    if (t === "custody" && custodyItems.length === 0) loadCustody();
    if (t === "requests" && empRequests.length === 0) loadRequests();
  }

  // ══════════════════ الموظفون ══════════════════

  function openCreateEmp() {
    setEmpForm({ ...EMPTY_EMP, branchId: branches[0]?.id || "" }); setEmpErr(""); setEmpModal({ mode: "create" });
  }
  function openEditEmp(e: Employee) {
    setEmpForm({
      branchId: e.branch_id || "", fullName: e.full_name, nationalId: e.national_id || "",
      nationality: e.nationality || "", isSaudi: e.is_saudi, phone: e.phone || "",
      jobTitle: e.job_title || "", techRole: (e as { tech_role?: string }).tech_role || "", contractType: e.contract_type, hireDate: e.hire_date,
      basicSalary: e.basic_salary ?? 0,
      allowances: e.allowances || 0,
      iban: e.iban || "",
      // حقل واحد للهوية/الإقامة — الصفوف القديمة اللي اتسجل فيها رقم الإقامة بس بتتقري برضو
      iqamaNumber: e.national_id || e.iqama_number || "",
      iqamaExpiryDate: e.iqama_expiry_date || "",
      approvalPin: (e as { approval_pin?: string | null }).approval_pin || "",
      linkedUserId: (e as { linked_user_id?: string | null }).linked_user_id || "",
      commissionType: e.commission_type || "none", commissionPct: e.commission_pct || 0,
      departmentId: e.department_id || "", positionId: e.position_id || "", managerId: e.manager_id || "", scheduleId: e.schedule_id || "",
      gender: e.gender || "", email: e.email || "", address: e.address || "", gosiNumber: e.gosi_number || "", gosiStatus: e.gosi_status || "",
      housingAllowance: e.housing_allowance || 0, transportAllowance: e.transport_allowance || 0,
      // بدلات قديمة مسجّلة كرقم واحد: تظهر في «أخرى» حتى لا تُصفَّر عند أول حفظ
      otherAllowance: (e.housing_allowance || 0) + (e.transport_allowance || 0) + (e.other_allowance || 0) === 0 ? (e.allowances || 0) : (e.other_allowance || 0),
    });
    setEmpErr(""); setEmpModal({ mode: "edit", emp: e });
  }
  async function saveEmp() {
    setEmpErr("");
    try {
      const nul = (v: string) => v || null;
      const payload: Record<string, unknown> = { ...empForm, nationalId: empForm.iqamaNumber, linkedUserId: empForm.linkedUserId || null,
        departmentId: nul(empForm.departmentId), positionId: nul(empForm.positionId), managerId: nul(empForm.managerId), scheduleId: nul(empForm.scheduleId),
        gender: nul(empForm.gender), email: nul(empForm.email), address: nul(empForm.address), gosiNumber: nul(empForm.gosiNumber), gosiStatus: nul(empForm.gosiStatus) };
      // الخادم يتجاهل ما لا يملك المستخدم صلاحيته؛ نحذفه هنا كي لا تُرسل قيم مُقنَّعة/فارغة أصلاً
      if (!canSalary) ["basicSalary", "allowances", "housingAllowance", "transportAllowance", "otherAllowance", "iban", "commissionType", "commissionPct"].forEach((k) => delete payload[k]);
      if (!canIdentity) ["nationalId", "iqamaNumber", "iqamaExpiryDate"].forEach((k) => delete payload[k]);
      delete payload.allowances;   // الإجمالي يحسبه الخادم من المكوّنات
      const body = JSON.stringify(payload);
      if (empModal?.mode === "create") {
        await api("/hr/employees", { method: "POST", body });
      } else if (empModal?.mode === "edit") {
        await api(`/hr/employees/${empModal.emp.id}`, { method: "PUT", body });
      }
      setEmpModal(null);
      await load();
    } catch (e: any) { setEmpErr(e.message); }
  }
  async function terminateEmp(e: Employee) {
    if (!await appConfirm(`إنهاء خدمة «${e.full_name}»؟`)) return;
    try {
      const res = await api<{ endOfServiceEstimate: { amount: number | null; totalYears: number; note: string } }>(
        `/hr/employees/${e.id}/terminate`, { method: "POST", body: JSON.stringify({}) }
      );
      await appAlert(`تم إنهاء الخدمة (${res.endOfServiceEstimate.totalYears} سنة خدمة).` + (res.endOfServiceEstimate.amount == null ? "" : `\nتقدير مكافأة نهاية الخدمة: ${money(res.endOfServiceEstimate.amount)} ر.س\n${res.endOfServiceEstimate.note}`));
      await load();
    } catch (e: any) { await appAlert(e.message); }
  }

  // ══════════════════ الحضور ══════════════════

  async function checkIn(employeeId: string) {
    try { await api("/hr/attendance/check-in", { method: "POST", body: JSON.stringify({ employeeId }) }); await loadAttendance(); }
    catch (e: any) { await appAlert(e.message); }
  }
  async function checkOut(employeeId: string) {
    try { await api("/hr/attendance/check-out", { method: "POST", body: JSON.stringify({ employeeId }) }); await loadAttendance(); }
    catch (e: any) { await appAlert(e.message); }
  }

  // ══════════════════ الإجازات ══════════════════

  function openLeaveModal() {
    setLeaveForm({ employeeId: employees[0]?.id || "", leaveType: "annual", startDate: "", endDate: "", reason: "" });
    setLeaveErr(""); setBalance(null); setLeaveModal(true);
  }
  async function checkBalance(employeeId: string) {
    if (!employeeId) { setBalance(null); return; }
    try { setBalance(await api<LeaveBalance>(`/hr/leave-balance/${employeeId}`)); } catch { setBalance(null); }
  }
  async function submitLeave() {
    setLeaveErr("");
    try {
      await api("/hr/leave-requests", { method: "POST", body: JSON.stringify(leaveForm) });
      setLeaveModal(false);
      await loadLeaves();
    } catch (e: any) { setLeaveErr(e.message); }
  }
  async function decideLeave(l: LeaveRequest, decision: "approved" | "rejected") {
    try { await api(`/hr/leave-requests/${l.id}/decision`, { method: "POST", body: JSON.stringify({ decision }) }); await loadLeaves(); }
    catch (e: any) { await appAlert(e.message); }
  }

  // ══════════════════ المخالفات ══════════════════

  function openViolModal() {
    setViolForm({ employeeId: employees[0]?.id || "", violationType: "", description: "", deductionAmount: 0 });
    setViolErr(""); setViolModal(true);
  }
  async function submitViolation() {
    setViolErr("");
    try {
      await api("/hr/violations", { method: "POST", body: JSON.stringify(violForm) });
      setViolModal(false);
      await loadViolations();
    } catch (e: any) { setViolErr(e.message); }
  }

  // ══════════════════ عهد الموظفين ══════════════════

  function openCustodyModal() {
    setCustodyForm({ employeeId: employees[0]?.id || "", itemName: "", description: "", estimatedValue: 0, assignedDate: "", notes: "" });
    setCustodyErr(""); setCustodyModal(true);
  }
  async function submitCustody() {
    setCustodyErr("");
    try {
      await api("/hr/custody", { method: "POST", body: JSON.stringify(custodyForm) });
      setCustodyModal(false);
      await loadCustody();
    } catch (e: any) { setCustodyErr(e.message); }
  }
  async function custodyReturn(c: CustodyItem, status: CustodyStatus) {
    if (!await appConfirm(status === "returned" ? `تسجيل إرجاع «${c.item_name}»؟` : `تسجيل «${c.item_name}» كمفقودة؟`)) return;
    try { await api(`/hr/custody/${c.id}/status`, { method: "PUT", body: JSON.stringify({ status }) }); await loadCustody(); }
    catch (e: any) { await appAlert(e.message); }
  }

  // ══════════════════ الطلبات الإلكترونية العامة ══════════════════

  function openReqModal() {
    setReqForm({ employeeId: employees[0]?.id || "", requestType: "supplies", targetBranchId: "", itemsText: "", reason: "" });
    setReqErr(""); setReqModal(true);
  }
  async function submitRequest() {
    setReqErr("");
    try {
      const details: Record<string, any> = { reason: reqForm.reason || undefined };
      if (reqForm.requestType === "branch_transfer") details.targetBranchId = reqForm.targetBranchId;
      if (reqForm.requestType === "supplies") details.items = reqForm.itemsText;
      if (reqForm.requestType === "malfunction_report") details.description = reqForm.reason;
      await api("/hr/requests", { method: "POST", body: JSON.stringify({
        employeeId: reqForm.employeeId, requestType: reqForm.requestType, details,
      }) });
      setReqModal(false);
      await loadRequests();
    } catch (e: any) { setReqErr(e.message); }
  }
  async function decideRequest(r: EmployeeRequest, decision: "approved" | "rejected") {
    try { await api(`/hr/requests/${r.id}/decision`, { method: "POST", body: JSON.stringify({ decision }) }); await loadRequests(); }
    catch (e: any) { await appAlert(e.message); }
  }

  // ══════════════════ الرواتب ══════════════════

  function openCommissionsPreview() {
    const now = new Date();
    const first = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
    const next = new Date(now.getFullYear(), now.getMonth() + 1, 1).toISOString().slice(0, 10);
    setCommFrom(first); setCommTo(next); setCommRows([]); setCommErr(""); setCommPreviewOpen(true);
  }
  async function loadCommissionsPreview() {
    setCommErr(""); setCommBusy(true);
    try {
      setCommRows(await api<CommissionPreviewRow[]>(`/hr/commissions-preview?from=${commFrom}&to=${commTo}`));
    } catch (e: any) { setCommErr(e.message); }
    finally { setCommBusy(false); }
  }

  async function submitPayroll() {
    setPayErr(""); setPayBusy(true);
    try {
      const res = await api<{ run: PayrollRun; payslips: Payslip[] }>("/hr/payroll-runs", {
        method: "POST", body: JSON.stringify({ periodMonth: payMonth, periodYear: payYear }),
      });
      setPayrollModal(false);
      setViewPayslips({ run: res.run, slips: res.payslips });
      await loadPayroll();
    } catch (e: any) { setPayErr(e.message); }
    finally { setPayBusy(false); }
  }
  async function openPayslips(run: PayrollRun) {
    try { setViewPayslips({ run, slips: await api<Payslip[]>(`/hr/payroll-runs/${run.id}/payslips`) }); }
    catch (e: any) { await appAlert(e.message); }
  }
  async function finalizeRun() {
    if (!viewPayslips) return;
    if (!await appConfirm("اعتماد دورة الرواتب دي نهائياً؟ مش هينفع تتعدّل بعد كده — هيُسجَّل قيد الرواتب في دفتر اليومية.")) return;
    try {
      await api(`/hr/payroll-runs/${viewPayslips.run.id}/finalize`, { method: "POST" });
      setViewPayslips(null);
      await loadPayroll();
    } catch (e: any) { await appAlert(e.message); }
  }
  /** قسيمة راتب — طباعة عبر محرك الطباعة المركزي؛ الأرقام كلها من الخادم كما هي */
  function printPayslip(s: Payslip, run: PayrollRun) {
    const period = `${MONTHS_AR[run.period_month - 1]} ${run.period_year}`;
    const rows: (string | number)[][] = [
      ["الراتب الأساسي", money(s.basic_salary)], ["البدلات", money(s.allowances)],
      ["العمولة", money(s.commission_amount)], ["خصم المخالفات", money(s.violations_deduction)],
      ["خصم السلف", money(s.advance_deduction)], ["التأمينات (حصة الموظف)", money(s.gosi_employee)],
    ];
    printReport(`قسيمة راتب — ${s.employee_name}`, `الفترة: ${period} · الحالة: ${run.status === "paid" ? "مدفوع" : run.status === "finalized" ? "معتمد" : "مسودة"}`,
      kpisHTML([{ label: "الموظف", value: s.employee_name }, { label: "المسمى", value: s.job_title || "—" }, { label: "صافي الراتب", value: money(s.net_pay) }]) +
      tableHTML(["البند", "المبلغ (ر.س)"], rows, { numericCols: [1] }));
  }
  const [payMethod, setPayMethod] = useState<"cash" | "card" | "transfer">("transfer");
  async function payRun() {
    if (!viewPayslips) return;
    if (!await appConfirm(`تسجيل صرف صافي الرواتب فعلياً (${money(viewPayslips.run.total_net || 0)} ر.س) عبر ${payMethod === "cash" ? "النقد" : payMethod === "card" ? "الشبكة" : "التحويل البنكي"}؟`)) return;
    try {
      await api(`/hr/payroll-runs/${viewPayslips.run.id}/pay`, { method: "POST", body: JSON.stringify({ method: payMethod }) });
      setViewPayslips(null);
      await loadPayroll();
    } catch (e: any) { await appAlert(e.message); }
  }

  // ══════════════════ الأعمدة ══════════════════

  const empCols: Column<Employee>[] = [
    { key: "full_name", title: "الموظف", render: (e) => (
      <Link href={`/hr/${e.id}`} className="flex items-center gap-2.5 hover:text-petrol">
        <Avatar name={e.full_name} size={34} />
        <span className="min-w-0"><span className="block font-extrabold">{e.full_name}</span><span className="block text-t-xs text-text-dim">{e.position_name || e.job_title || "—"}</span></span>
      </Link>
    ) },
    { key: "department_name", title: "القسم", width: "110px", render: (e) => e.department_name || "—" },
    { key: "branch_name", title: "الفرع", width: "100px", render: (e) => e.branch_name || "—" },
    { key: "is_saudi", title: "الجنسية", width: "100px", render: (e) => e.nationality || (e.is_saudi ? "سعودي" : "غير سعودي") },
    { key: "hire_date", title: "التعيين", width: "100px", render: (e) => <span className="tnum">{dateFmt(e.hire_date)}</span> },
    { key: "contract_type", title: "نوع العقد", width: "100px", render: (e) => CONTRACT_LABELS[e.contract_type] },
    ...(canSalary ? [{ key: "basic_salary", title: "الراتب الأساسي", width: "110px", render: (e: Employee) => <Hidden v={e.basic_salary} f={money} /> } satisfies Column<Employee>] : []),
    { key: "is_active", title: "الحالة", width: "90px", render: (e) => e.is_active ? <Badge tone="success">نشط</Badge> : <Badge tone="neutral">منتهي</Badge> },
    ...(canManage ? [{
      key: "actions", title: "", width: "180px",
      render: (e: Employee) => (
        <div className="flex justify-end gap-1.5">
          <Link href={`/hr/${e.id}`}><Button variant="ghost" size="xs">الملف</Button></Link>
          <Button variant="ghost" size="xs" onClick={() => openEditEmp(e)}>تعديل</Button>
          {e.is_active && <Button variant="danger" size="xs" onClick={() => terminateEmp(e)}>إنهاء خدمة</Button>}
        </div>
      ),
    } satisfies Column<Employee>] : []),
  ];

  const attCols: Column<Attendance>[] = [
    { key: "employee_name", title: "الموظف" },
    { key: "work_date", title: "التاريخ", width: "110px", render: (a) => dateFmt(a.work_date) },
    { key: "check_in", title: "الحضور", width: "90px", render: (a) => <span className="tnum">{timeFmt(a.check_in)}</span> },
    { key: "check_out", title: "الانصراف", width: "90px", render: (a) => <span className="tnum">{timeFmt(a.check_out)}</span> },
    { key: "worked_minutes", title: "ساعات العمل", width: "90px", render: (a) => <span className="tnum">{fmtMin(a.worked_minutes)}</span> },
    { key: "late_minutes", title: "التأخير", width: "80px", render: (a) => <span className="tnum">{a.late_minutes ? `${a.late_minutes} د` : "—"}</span> },
    { key: "overtime_minutes", title: "الإضافي", width: "80px", render: (a) => <span className="tnum">{a.overtime_minutes ? fmtMin(a.overtime_minutes) : "—"}</span> },
    { key: "day_status", title: "الحالة", width: "100px", render: (a) => <DayStatus s={a.day_status} /> },
  ];

  const leaveCols: Column<LeaveRequest>[] = [
    { key: "employee_name", title: "الموظف" },
    { key: "leave_type", title: "النوع", width: "90px", render: (l) => LEAVE_TYPE_LABELS[l.leave_type] ?? leaveTypes.find((t) => t.code === l.leave_type)?.name ?? l.leave_type },
    { key: "start_date", title: "من", width: "100px", render: (l) => dateFmt(l.start_date) },
    { key: "end_date", title: "إلى", width: "100px", render: (l) => dateFmt(l.end_date) },
    { key: "days_count", title: "الأيام", width: "70px", render: (l) => <span className="tnum">{l.days_count}</span> },
    { key: "status", title: "الحالة", width: "100px", render: (l) =>
      l.status === "approved" ? <Badge tone="good">معتمدة</Badge> : l.status === "rejected" ? <Badge tone="warn">مرفوضة</Badge> : <Badge tone="neutral">معلّقة</Badge> },
    ...(canLeaveApprove ? [{
      key: "actions", title: "", width: "150px",
      render: (l: LeaveRequest) => l.status === "pending" ? (
        <div className="flex justify-end gap-1.5">
          <Button variant="ghost" size="xs" onClick={() => decideLeave(l, "approved")}>اعتماد</Button>
          <Button variant="danger" size="xs" onClick={() => decideLeave(l, "rejected")}>رفض</Button>
        </div>
      ) : null,
    } satisfies Column<LeaveRequest>] : []),
  ];

  const violCols: Column<Violation>[] = [
    { key: "employee_name", title: "الموظف" },
    { key: "violation_date", title: "التاريخ", width: "110px", render: (v) => dateFmt(v.violation_date) },
    { key: "violation_type", title: "النوع" },
    { key: "deduction_amount", title: "الخصم", width: "100px", render: (v) => <Hidden v={v.deduction_amount} f={money} /> },
  ];

  const payrollCols: Column<PayrollRun>[] = [
    { key: "period_month", title: "الشهر", width: "100px", render: (r) => <span className="tnum">{r.period_month}/{r.period_year}</span> },
    { key: "status", title: "الحالة", width: "100px", render: (r) =>
      r.status === "paid" ? <Badge tone="good">مدفوعة</Badge>
      : r.status === "finalized" ? <Badge tone="info">معتمدة</Badge>
      : <Badge tone="warn">مسودة</Badge> },
    { key: "payslip_count", title: "عدد القسائم", width: "100px", render: (r) => <span className="tnum">{r.payslip_count}</span> },
    { key: "total_net", title: "إجمالي الصافي", width: "130px", render: (r) => <span className="tnum font-bold">{money(r.total_net || 0)}</span> },
    { key: "actions", title: "", width: "90px", render: (r) => <Button variant="ghost" size="xs" onClick={() => openPayslips(r)}>عرض</Button> },
  ];

  const custodyCols: Column<CustodyItem>[] = [
    { key: "employee_name", title: "الموظف" },
    { key: "item_name", title: "العنصر", render: (c) => (
      <div><div className="font-extrabold">{c.item_name}</div>{c.description && <div className="text-t-xs text-text-dim">{c.description}</div>}</div>
    ) },
    { key: "estimated_value", title: "القيمة التقديرية", width: "120px", render: (c) => <span className="tnum font-bold">{money(c.estimated_value)}</span> },
    { key: "assigned_date", title: "تاريخ التسليم", width: "110px", render: (c) => dateFmt(c.assigned_date) },
    { key: "status", title: "الحالة", width: "130px", render: (c) =>
      c.status === "returned" ? <Badge tone="good">{CUSTODY_STATUS_LABELS.returned}</Badge>
      : c.status === "lost" ? <Badge tone="warn">{CUSTODY_STATUS_LABELS.lost}</Badge>
      : <Badge tone="neutral">{CUSTODY_STATUS_LABELS.held}</Badge> },
    ...(canCustody ? [{
      key: "actions", title: "", width: "160px",
      render: (c: CustodyItem) => c.status === "held" ? (
        <div className="flex justify-end gap-1.5">
          <Button variant="ghost" size="xs" onClick={() => custodyReturn(c, "returned")}>إرجاع</Button>
          <Button variant="danger" size="xs" onClick={() => custodyReturn(c, "lost")}>فقد</Button>
        </div>
      ) : null,
    } satisfies Column<CustodyItem>] : []),
  ];

  const reqCols: Column<EmployeeRequest>[] = [
    { key: "employee_name", title: "الموظف" },
    { key: "request_type", title: "نوع الطلب", width: "110px", render: (r) => REQUEST_TYPE_LABELS[r.request_type] },
    { key: "title", title: "التفاصيل", render: (r) => (
      <div className="text-t-sm text-text-dim">
        {r.request_type === "branch_transfer" && <>نقل إلى فرع: {branches.find((b) => b.id === r.details?.targetBranchId)?.name || "—"}</>}
        {r.request_type === "supplies" && <>{r.details?.items || "—"}</>}
        {r.request_type === "malfunction_report" && <>{r.details?.description || "—"}</>}
        {r.details?.reason && <div className="text-t-xs">السبب: {r.details.reason}</div>}
      </div>
    ) },
    { key: "status", title: "الحالة", width: "100px", render: (r) =>
      r.status === "approved" ? <Badge tone="good">معتمد</Badge> : r.status === "rejected" ? <Badge tone="warn">مرفوض</Badge> : <Badge tone="neutral">معلّق</Badge> },
    ...(canRequestsApprove ? [{
      key: "actions", title: "", width: "150px",
      render: (r: EmployeeRequest) => r.status === "pending" ? (
        <div className="flex justify-end gap-1.5">
          <Button variant="ghost" size="xs" onClick={() => decideRequest(r, "approved")}>اعتماد</Button>
          <Button variant="danger" size="xs" onClick={() => decideRequest(r, "rejected")}>رفض</Button>
        </div>
      ) : null,
    } satisfies Column<EmployeeRequest>] : []),
  ];

  if (loading) return <LoadingScreen />;

  return (
    <div className="space-y-4">
      <PageHeader title="الموارد البشرية" description="إدارة الموظفين والحضور والرواتب والإجازات والعهد." />
      <ErrorNote msg={pageErr} />

      {canView && iqamaAlerts.length > 0 && (
        <div className="rounded-lg border border-ember/30 bg-ember-bg px-4 py-2.5 text-t-sm font-bold text-ember">
          {iqamaAlerts.length} إقامة قربت تنتهي: {iqamaAlerts.slice(0, 3).map((a) => `${a.full_name} (${a.days_remaining} يوم)`).join("، ")}
          {iqamaAlerts.length > 3 && " ..."}
        </div>
      )}

      <Card className="!p-0">
        <div className="px-5 pt-4">
          <Tabs value={tab} onChange={(t) => changeTab(t as Tab)} items={[
            ...(canView ? [{ key: "dashboard" as Tab, label: "لوحة الموارد البشرية" }, { key: "employees" as Tab, label: "الموظفون" }] : []),
            ...(canAttendance ? [{ key: "attendance" as Tab, label: "الحضور والانصراف" }] : []),
            { key: "leave" as Tab, label: "الإجازات" },
            ...(canViolations ? [{ key: "violations" as Tab, label: "المخالفات" }] : []),
            ...(canPayroll ? [{ key: "payroll" as Tab, label: "الرواتب" }] : []),
            ...(canCustody ? [{ key: "custody" as Tab, label: "العهد" }] : []),
            { key: "requests" as Tab, label: "الطلبات" },
            ...(canView ? [{ key: "contracts" as Tab, label: "العقود" }, { key: "documents" as Tab, label: "المستندات" }, { key: "org" as Tab, label: "الهيكل والدوام" }, { key: "settings" as Tab, label: "الإعدادات" }] : []),
          ]} />
        </div>

        <div className="p-5">
          {tab === "dashboard" && canView && <HrDashboard onGo={(t) => changeTab(t as Tab)} />}

          {tab === "contracts" && canView && <ContractsPanel canManage={canManage} employees={employees} />}
          {tab === "documents" && canView && <DocumentsPanel canManage={canManage} employees={employees} />}
          {tab === "org" && canView && <OrgPanel canManage={canManage} />}
          {tab === "settings" && canView && <HrSettingsPanel canManage={canManage} canEditRules={canPayroll} />}

          {tab === "employees" && canView && (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <input value={fSearch} onChange={(e) => setFSearch(e.target.value)} placeholder="بحث: اسم، جوال، بريد، هوية، قسم، وظيفة..."
                       className="h-9 min-w-[14rem] flex-1 rounded-lg border border-line bg-ink-2 px-3 text-t-sm focus:border-petrol focus:outline-none focus:ring-2 focus:ring-petrol/15" />
                <Select className="!w-36" value={fBranch} onChange={(e) => setFBranch(e.target.value)}><option value="">كل الفروع</option>{branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</Select>
                <Select className="!w-36" value={fDept} onChange={(e) => setFDept(e.target.value)}><option value="">كل الأقسام</option>{departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</Select>
                <Select className="!w-32" value={fNat} onChange={(e) => setFNat(e.target.value)}><option value="">كل الجنسيات</option><option value="saudi">سعودي</option><option value="non">غير سعودي</option></Select>
                <Select className="!w-32" value={fStatus} onChange={(e) => setFStatus(e.target.value)}><option value="">كل الحالات</option><option value="active">على رأس العمل</option><option value="ended">منتهي الخدمة</option></Select>
                <Select className="!w-32" value={fContract} onChange={(e) => setFContract(e.target.value)}><option value="">كل العقود</option>{Object.entries(CONTRACT_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select>
                {canManage && <Button onClick={openCreateEmp}>+ موظف جديد</Button>}
              </div>
              <p className="text-t-xs text-text-dim">{filteredEmployees.length} من {employees.length} موظف</p>
              {/* جدول على الشاشات الكبيرة */}
              <div className="hidden md:block"><DataTable columns={empCols} rows={filteredEmployees} emptyText="لا يوجد موظفون مطابقون للبحث" /></div>
              {/* بطاقات على الجوال */}
              <div className="space-y-2 md:hidden">
                {!filteredEmployees.length ? <p className="py-8 text-center text-t-sm text-text-dim">لا يوجد موظفون مطابقون للبحث</p> : filteredEmployees.map((e) => (
                  <div key={e.id} className="rounded-card border border-line bg-ink-2 p-3 shadow-card">
                    <Link href={`/hr/${e.id}`} className="flex items-center gap-3">
                      <Avatar name={e.full_name} size={44} />
                      <span className="min-w-0 flex-1"><span className="block font-extrabold">{e.full_name}</span>
                        <span className="block text-t-xs text-text-dim">{e.position_name || e.job_title || "—"} · {e.branch_name || "بدون فرع"}</span></span>
                      {e.is_active ? <Badge tone="success">نشط</Badge> : <Badge>منتهي</Badge>}
                    </Link>
                    <div className="mt-2 flex gap-2 text-t-xs font-bold">
                      <Link href={`/hr/${e.id}?tab=attendance`} className="text-petrol">الحضور</Link><span className="text-line">|</span>
                      {canSalary && <><Link href={`/hr/${e.id}?tab=salary`} className="text-petrol">الرواتب</Link><span className="text-line">|</span></>}
                      <Link href={`/hr/${e.id}?tab=leave`} className="text-petrol">الإجازات</Link>
                      {canManage && <button className="ms-auto text-petrol" onClick={() => openEditEmp(e)}>تعديل</button>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {tab === "attendance" && (
            <div className="space-y-3">
              {canAttendance && (
                <div className="flex flex-wrap items-center gap-2 rounded-lg bg-ink-3 p-3">
                  <Select className="!w-56" defaultValue="" onChange={(e) => e.target.value && checkIn(e.target.value)}>
                    <option value="">تسجيل حضور لموظف...</option>
                    {employees.filter((e) => e.is_active).map((e) => <option key={e.id} value={e.id}>{e.full_name}</option>)}
                  </Select>
                  <Select className="!w-56" defaultValue="" onChange={(e) => e.target.value && checkOut(e.target.value)}>
                    <option value="">تسجيل انصراف لموظف...</option>
                    {employees.filter((e) => e.is_active).map((e) => <option key={e.id} value={e.id}>{e.full_name}</option>)}
                  </Select>
                </div>
              )}
              <DataTable columns={attCols} rows={attendance} searchKeys={["employee_name"]}
                        searchPlaceholder="بحث بالموظف..." emptyText="لا توجد سجلات حضور" />
            </div>
          )}

          {tab === "leave" && (
            <DataTable columns={leaveCols} rows={leaves} searchKeys={["employee_name"]}
                      searchPlaceholder="بحث بالموظف..." emptyText="لا توجد طلبات إجازة"
                      toolbar={<Button onClick={openLeaveModal}>+ طلب إجازة</Button>} />
          )}

          {tab === "violations" && canViolations && (
            <DataTable columns={violCols} rows={violations} searchKeys={["employee_name", "violation_type"]}
                      searchPlaceholder="بحث بالموظف أو النوع..." emptyText="لا توجد مخالفات مسجّلة"
                      toolbar={<Button onClick={openViolModal}>+ تسجيل مخالفة</Button>} />
          )}

          {tab === "payroll" && canPayroll && (
            <DataTable columns={payrollCols} rows={payrollRuns} emptyText="لا توجد دورات رواتب بعد"
                      toolbar={
                        <div className="flex gap-2">
                          <Button variant="ghost" onClick={openCommissionsPreview}>معاينة العمولات</Button>
                          <Button onClick={() => { setPayErr(""); setPayrollModal(true); }}>+ تشغيل رواتب</Button>
                        </div>
                      } />
          )}

          {tab === "custody" && canCustody && (
            <DataTable columns={custodyCols} rows={custodyItems} searchKeys={["employee_name", "item_name"]}
                      searchPlaceholder="بحث بالموظف أو العنصر..." emptyText="لا توجد عهد مسجّلة"
                      toolbar={<Button onClick={openCustodyModal}>+ تسجيل عهدة</Button>} />
          )}

          {tab === "requests" && (
            <DataTable columns={reqCols} rows={empRequests} searchKeys={["employee_name"]}
                      searchPlaceholder="بحث بالموظف..." emptyText="لا توجد طلبات"
                      toolbar={canRequestsCreate && <Button onClick={openReqModal}>+ طلب جديد</Button>} />
          )}
        </div>
      </Card>

      {/* ══════════ إنشاء / تعديل موظف ══════════ */}
      <Modal open={!!empModal} size="lg" onClose={() => setEmpModal(null)} title={empModal?.mode === "create" ? "موظف جديد" : "تعديل بيانات الموظف"}>
        <div className="space-y-3">
          <div className="grid gap-2 sm:grid-cols-2">
            <Field label="الاسم الكامل"><Input value={empForm.fullName} autoFocus onChange={(e) => setEmpForm({ ...empForm, fullName: e.target.value })} /></Field>
            <Field label="الفرع">
              <Select value={empForm.branchId} onChange={(e) => setEmpForm({ ...empForm, branchId: e.target.value })}>
                <option value="">— بدون فرع محدد —</option>
                {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </Select>
            </Field>
          </div>
          <div className="grid gap-2 sm:grid-cols-3">
            <Field label="المسمى الوظيفي"><Input value={empForm.jobTitle} onChange={(e) => setEmpForm({ ...empForm, jobTitle: e.target.value })} /></Field>
            <Field label="الدور الفني بالورشة" hint="يظهر في قوائم اختيار أمر العمل">
              <select className="w-full rounded-lg border border-line bg-ink-2 px-3 py-2 text-t-md font-bold"
                      value={empForm.techRole}
                      onChange={(e) => setEmpForm({ ...empForm, techRole: e.target.value })}>
                <option value="">— ليس فنياً —</option>
                <option value="filling">فني تعبئة</option>
                <option value="fitting">فني فك وتركيب</option>
                <option value="checking">فني تشييك</option>
              </select>
            </Field>
            <Field label="نوع العقد">
              <Select value={empForm.contractType} onChange={(e) => setEmpForm({ ...empForm, contractType: e.target.value as any })}>
                {Object.entries(CONTRACT_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </Select>
            </Field>
          </div>
          <div className="grid gap-2 sm:grid-cols-4">
            <Field label="القسم"><Select value={empForm.departmentId} onChange={(e) => setEmpForm({ ...empForm, departmentId: e.target.value, positionId: "" })}>
              <option value="">— بدون —</option>{departments.filter((d) => d.is_active).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</Select></Field>
            <Field label="الوظيفة"><Select value={empForm.positionId} onChange={(e) => setEmpForm({ ...empForm, positionId: e.target.value })}>
              <option value="">— بدون —</option>{positions.filter((x) => x.is_active && (!empForm.departmentId || !x.department_id || x.department_id === empForm.departmentId)).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</Select></Field>
            <Field label="المدير المباشر"><Select value={empForm.managerId} onChange={(e) => setEmpForm({ ...empForm, managerId: e.target.value })}>
              <option value="">— بدون —</option>{employees.filter((x) => x.is_active && !(empModal?.mode === "edit" && empModal.emp.id === x.id)).map((x) => <option key={x.id} value={x.id}>{x.full_name}</option>)}</Select></Field>
            <Field label="جدول الدوام" hint="يُحسب التأخير والإضافي منه"><Select value={empForm.scheduleId} onChange={(e) => setEmpForm({ ...empForm, scheduleId: e.target.value })}>
              <option value="">— غير محدد —</option>{schedules.filter((x) => x.is_active).map((x) => <option key={x.id} value={x.id}>{x.name} ({x.start_time}–{x.end_time})</option>)}</Select></Field>
          </div>
          <div className="grid gap-2 sm:grid-cols-3">
            <Field label="رقم الجوال"><Input value={empForm.phone} className="tnum" onChange={(e) => setEmpForm({ ...empForm, phone: e.target.value })} /></Field>
            <Field label="الجنسية"><Input value={empForm.nationality} onChange={(e) => setEmpForm({ ...empForm, nationality: e.target.value })} /></Field>
            <Field label="تاريخ التعيين"><Input type="date" className="tnum" value={empForm.hireDate} onChange={(e) => setEmpForm({ ...empForm, hireDate: e.target.value })} /></Field>
          </div>
          <div className="grid gap-2 sm:grid-cols-3">
            <Field label="الجنس"><Select value={empForm.gender} onChange={(e) => setEmpForm({ ...empForm, gender: e.target.value })}><option value="">—</option><option value="male">ذكر</option><option value="female">أنثى</option></Select></Field>
            <Field label="البريد الإلكتروني"><Input type="email" dir="ltr" value={empForm.email} onChange={(e) => setEmpForm({ ...empForm, email: e.target.value })} /></Field>
            <Field label="العنوان"><Input value={empForm.address} onChange={(e) => setEmpForm({ ...empForm, address: e.target.value })} /></Field>
          </div>
          <label className="flex items-center gap-2 text-t-sm font-bold text-text-dim">
            <Switch checked={empForm.isSaudi} onChange={(v) => setEmpForm({ ...empForm, isSaudi: v })} />
            سعودي الجنسية (يحدد نسب التأمينات في الرواتب)
          </label>
          <div className="grid gap-2 sm:grid-cols-3">
            <Field label="رقم الهوية / الإقامة">
              <Input value={empForm.iqamaNumber} className="tnum" disabled={!canIdentity} onChange={(e) => setEmpForm({ ...empForm, iqamaNumber: e.target.value })} />
            </Field>
            {!empForm.isSaudi && (
              <Field label="تاريخ انتهاء الإقامة" hint="لتنبيهات التجديد المبكرة">
                <Input type="date" className="tnum" disabled={!canIdentity} value={empForm.iqamaExpiryDate} onChange={(e) => setEmpForm({ ...empForm, iqamaExpiryDate: e.target.value })} />
              </Field>
            )}
            <Field label="رمز اعتماد أوامر العمل" hint="4-6 أرقام فريدة — يدخله الموظف على التابلت. فارغ = بدون رمز">
              <Input value={empForm.approvalPin} className="tnum" maxLength={6} placeholder="مثال: 4512"
                     onChange={(e) => setEmpForm({ ...empForm, approvalPin: e.target.value.replace(/\D/g, "") })} />
            </Field>
          </div>
          {loginUsers.length > 0 && (
            <Field label="حساب الدخول المرتبط" hint="يربط سجل الموظف بحسابه في المنظومة — المدير العام غير قابل للربط">
              <Select value={empForm.linkedUserId}
                      onChange={(e) => setEmpForm({ ...empForm, linkedUserId: e.target.value })}>
                <option value="">— بدون حساب دخول —</option>
                {loginUsers.map((u) => {
                  // الحساب المرتبط بموظف تاني يظهر معطلاً — حساب واحد لموظف واحد
                  const takenBy = employees.find((emp) => (emp as { linked_user_id?: string | null }).linked_user_id === u.id &&
                    !(empModal?.mode === "edit" && empModal.emp.id === emp.id));
                  return (
                    <option key={u.id} value={u.id} disabled={!!takenBy}>
                      {u.full_name} ({u.email}){takenBy ? " — مرتبط بـ " + takenBy.full_name : ""}
                    </option>
                  );
                })}
              </Select>
            </Field>
          )}
          <div className="grid gap-2 sm:grid-cols-3">
            <Field label="رقم التسجيل في التأمينات" hint="للمتابعة فقط — لا يغيّر الحساب"><Input value={empForm.gosiNumber} className="tnum" onChange={(e) => setEmpForm({ ...empForm, gosiNumber: e.target.value })} /></Field>
            <Field label="حالة الاشتراك"><Select value={empForm.gosiStatus} onChange={(e) => setEmpForm({ ...empForm, gosiStatus: e.target.value })}>
              <option value="">غير محدد</option><option value="مسجّل">مسجّل</option><option value="غير مسجّل">غير مسجّل</option><option value="موقوف">موقوف</option></Select></Field>
          </div>
          {canSalary ? (<>
            <div className="grid gap-2 sm:grid-cols-3">
              <Field label="الراتب الأساسي"><Input type="number" min={0} step="0.01" className="tnum" value={empForm.basicSalary} onChange={(e) => setEmpForm({ ...empForm, basicSalary: +e.target.value || 0 })} /></Field>
              <Field label="رقم الآيبان"><Input value={empForm.iban} className="tnum" dir="ltr" onChange={(e) => setEmpForm({ ...empForm, iban: e.target.value })} /></Field>
            </div>
            <div className="grid gap-2 sm:grid-cols-3">
              <Field label="بدل السكن"><Input type="number" min={0} step="0.01" className="tnum" value={empForm.housingAllowance} onChange={(e) => setEmpForm({ ...empForm, housingAllowance: +e.target.value || 0 })} /></Field>
              <Field label="بدل النقل"><Input type="number" min={0} step="0.01" className="tnum" value={empForm.transportAllowance} onChange={(e) => setEmpForm({ ...empForm, transportAllowance: +e.target.value || 0 })} /></Field>
              <Field label="بدلات أخرى" hint="الإجمالي يُحسب في الخادم ويُضاف لصافي الراتب"><Input type="number" min={0} step="0.01" className="tnum" value={empForm.otherAllowance} onChange={(e) => setEmpForm({ ...empForm, otherAllowance: +e.target.value || 0 })} /></Field>
            </div>
            <div className="grid gap-2 sm:grid-cols-3">
              <Field label="عمولة المبيعات">
                <Select value={empForm.commissionType}
                        onChange={(e) => setEmpForm({ ...empForm, commissionType: e.target.value as CommissionType })}>
                  {Object.entries(COMMISSION_TYPE_LABELS).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
                </Select>
              </Field>
              {empForm.commissionType !== "none" && (
                <Field label="نسبة العمولة %" hint="تُحسب تلقائياً عند تشغيل الرواتب">
                  <Input type="number" min={0} max={100} step="0.1" className="tnum" value={empForm.commissionPct}
                         onChange={(e) => setEmpForm({ ...empForm, commissionPct: +e.target.value || 0 })} />
                </Field>
              )}
            </div>
          </>) : (
            <div className="rounded-lg bg-ink-3 p-2.5 text-t-xs font-bold text-text-dim">الراتب والبدلات والآيبان والعمولة محجوبة — تحتاج صلاحية «عرض الرواتب والبدلات والآيبان».</div>
          )}
          {canSalary && empForm.commissionType !== "none" && !empForm.linkedUserId && (
            <div className="rounded-lg bg-brass-soft p-2.5 text-t-xs font-bold text-brass">
              العمولة تُحسَب من فواتير الكاشير المرتبط بحساب دخول — اربط حساب دخول للموظف بالأعلى ليُحسب له شيء.
            </div>
          )}
          <ErrorNote msg={empErr} />
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="ghost" onClick={() => setEmpModal(null)}>إلغاء</Button>
            <Button onClick={saveEmp} disabled={empForm.fullName.trim().length < 2}>حفظ</Button>
          </div>
        </div>
      </Modal>

      {/* ══════════ طلب إجازة ══════════ */}
      <Modal open={leaveModal} onClose={() => setLeaveModal(false)} title="طلب إجازة جديد">
        <div className="space-y-3">
          <Field label="الموظف">
            <Select value={leaveForm.employeeId} onChange={(e) => { setLeaveForm({ ...leaveForm, employeeId: e.target.value }); checkBalance(e.target.value); }}>
              <option value="">— اختر الموظف —</option>
              {employees.filter((e) => e.is_active).map((e) => <option key={e.id} value={e.id}>{e.full_name}</option>)}
            </Select>
          </Field>
          {balance && (
            <div className="rounded-lg bg-ink-3 p-2.5 text-t-xs text-text-dim">
              رصيد الإجازة السنوية: <b className="tnum text-text">{balance.remaining}</b> من {balance.annualEntitlement} يوم (استُخدم {balance.used})
            </div>
          )}
          <div className="grid grid-cols-2 gap-2">
            <Field label="نوع الإجازة">
              <Select value={leaveForm.leaveType} onChange={(e) => setLeaveForm({ ...leaveForm, leaveType: e.target.value })}>
                {Object.entries(LEAVE_TYPE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                {leaveTypes.filter((t) => t.is_active).map((t) => <option key={t.code} value={t.code}>{t.name}</option>)}
              </Select>
            </Field>
            <Field label="عدد الأيام"><div className="pt-2 tnum text-t-md text-text-dim">
              {leaveForm.startDate && leaveForm.endDate ? Math.max(1, Math.round((new Date(leaveForm.endDate).getTime() - new Date(leaveForm.startDate).getTime()) / 86400000) + 1) : "—"}
            </div></Field>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Field label="من"><Input type="date" className="tnum" value={leaveForm.startDate} onChange={(e) => setLeaveForm({ ...leaveForm, startDate: e.target.value })} /></Field>
            <Field label="إلى"><Input type="date" className="tnum" value={leaveForm.endDate} onChange={(e) => setLeaveForm({ ...leaveForm, endDate: e.target.value })} /></Field>
          </div>
          <Field label="السبب"><Textarea value={leaveForm.reason} onChange={(e) => setLeaveForm({ ...leaveForm, reason: e.target.value })} /></Field>
          <ErrorNote msg={leaveErr} />
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="ghost" onClick={() => setLeaveModal(false)}>إلغاء</Button>
            <Button onClick={submitLeave} disabled={!leaveForm.employeeId || !leaveForm.startDate || !leaveForm.endDate}>تقديم الطلب</Button>
          </div>
        </div>
      </Modal>

      {/* ══════════ تسجيل مخالفة ══════════ */}
      <Modal open={violModal} onClose={() => setViolModal(false)} title="تسجيل مخالفة">
        <div className="space-y-3">
          <Field label="الموظف">
            <Select value={violForm.employeeId} onChange={(e) => setViolForm({ ...violForm, employeeId: e.target.value })}>
              <option value="">— اختر الموظف —</option>
              {employees.filter((e) => e.is_active).map((e) => <option key={e.id} value={e.id}>{e.full_name}</option>)}
            </Select>
          </Field>
          <Field label="نوع المخالفة"><Input value={violForm.violationType} onChange={(e) => setViolForm({ ...violForm, violationType: e.target.value })} /></Field>
          <Field label="الوصف"><Textarea value={violForm.description} onChange={(e) => setViolForm({ ...violForm, description: e.target.value })} /></Field>
          <Field label="مبلغ الخصم"><Input type="number" min={0} step="0.01" className="tnum" value={violForm.deductionAmount} onChange={(e) => setViolForm({ ...violForm, deductionAmount: +e.target.value || 0 })} /></Field>
          <ErrorNote msg={violErr} />
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="ghost" onClick={() => setViolModal(false)}>إلغاء</Button>
            <Button onClick={submitViolation} disabled={!violForm.employeeId || !violForm.violationType.trim()}>حفظ</Button>
          </div>
        </div>
      </Modal>

      {/* ══════════ تسجيل عهدة ══════════ */}
      <Modal open={custodyModal} onClose={() => setCustodyModal(false)} title="تسجيل عهدة جديدة">
        <div className="space-y-3">
          <Field label="الموظف">
            <Select value={custodyForm.employeeId} onChange={(e) => setCustodyForm({ ...custodyForm, employeeId: e.target.value })}>
              <option value="">— اختر الموظف —</option>
              {employees.filter((e) => e.is_active).map((e) => <option key={e.id} value={e.id}>{e.full_name}</option>)}
            </Select>
          </Field>
          <Field label="العنصر" hint="مثال: جهاز لابتوب، عدة فنية، يونيفورم">
            <Input value={custodyForm.itemName} onChange={(e) => setCustodyForm({ ...custodyForm, itemName: e.target.value })} />
          </Field>
          <Field label="الوصف"><Textarea value={custodyForm.description} onChange={(e) => setCustodyForm({ ...custodyForm, description: e.target.value })} /></Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="القيمة التقديرية">
              <Input type="number" min={0} step="0.01" className="tnum" value={custodyForm.estimatedValue}
                     onChange={(e) => setCustodyForm({ ...custodyForm, estimatedValue: +e.target.value || 0 })} />
            </Field>
            <Field label="تاريخ التسليم" hint="فارغ = اليوم">
              <Input type="date" className="tnum" value={custodyForm.assignedDate} onChange={(e) => setCustodyForm({ ...custodyForm, assignedDate: e.target.value })} />
            </Field>
          </div>
          <Field label="ملاحظات"><Textarea value={custodyForm.notes} onChange={(e) => setCustodyForm({ ...custodyForm, notes: e.target.value })} /></Field>
          <ErrorNote msg={custodyErr} />
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="ghost" onClick={() => setCustodyModal(false)}>إلغاء</Button>
            <Button onClick={submitCustody} disabled={!custodyForm.employeeId || !custodyForm.itemName.trim()}>حفظ</Button>
          </div>
        </div>
      </Modal>

      {/* ══════════ طلب عام جديد (نقل فرع / مستلزمات / بلاغ عطل) ══════════ */}
      <Modal open={reqModal} onClose={() => setReqModal(false)} title="طلب جديد">
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <Field label="الموظف">
              <Select value={reqForm.employeeId} onChange={(e) => setReqForm({ ...reqForm, employeeId: e.target.value })}>
                <option value="">— اختر الموظف —</option>
                {employees.filter((e) => e.is_active).map((e) => <option key={e.id} value={e.id}>{e.full_name}</option>)}
              </Select>
            </Field>
            <Field label="نوع الطلب">
              <Select value={reqForm.requestType} onChange={(e) => setReqForm({ ...reqForm, requestType: e.target.value as RequestType })}>
                {Object.entries(REQUEST_TYPE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </Select>
            </Field>
          </div>
          {reqForm.requestType === "branch_transfer" && (
            <Field label="الفرع المطلوب النقل إليه">
              <Select value={reqForm.targetBranchId} onChange={(e) => setReqForm({ ...reqForm, targetBranchId: e.target.value })}>
                <option value="">— اختر الفرع —</option>
                {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </Select>
            </Field>
          )}
          {reqForm.requestType === "supplies" && (
            <Field label="المستلزمات المطلوبة" hint="عدد وأصناف — نص حر">
              <Textarea value={reqForm.itemsText} onChange={(e) => setReqForm({ ...reqForm, itemsText: e.target.value })} />
            </Field>
          )}
          <Field label={reqForm.requestType === "malfunction_report" ? "وصف العطل" : "السبب"}>
            <Textarea value={reqForm.reason} onChange={(e) => setReqForm({ ...reqForm, reason: e.target.value })} />
          </Field>
          <ErrorNote msg={reqErr} />
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="ghost" onClick={() => setReqModal(false)}>إلغاء</Button>
            <Button onClick={submitRequest}
                    disabled={!reqForm.employeeId || (reqForm.requestType === "branch_transfer" && !reqForm.targetBranchId) || (reqForm.requestType === "supplies" && !reqForm.itemsText.trim()) || (reqForm.requestType === "malfunction_report" && !reqForm.reason.trim())}>
              تقديم الطلب
            </Button>
          </div>
        </div>
      </Modal>

      {/* ══════════ معاينة عمولات المبيعات ══════════ */}
      <Modal open={commPreviewOpen} size="lg" onClose={() => setCommPreviewOpen(false)} title="معاينة عمولات المبيعات">
        <div className="space-y-3">
          <p className="text-t-sm leading-5 text-text-dim">
            معاينة فقط — لا تُسجَّل ولا تؤثر على أي شيء. العمولة الفعلية تُحسَب تلقائياً عند تشغيل رواتب الشهر لنفس الفترة.
          </p>
          <div className="grid gap-2 sm:grid-cols-3">
            <Field label="من تاريخ"><Input type="date" className="tnum" value={commFrom} onChange={(e) => setCommFrom(e.target.value)} /></Field>
            <Field label="إلى تاريخ" hint="غير شامل">
              <Input type="date" className="tnum" value={commTo} onChange={(e) => setCommTo(e.target.value)} />
            </Field>
            <div className="flex items-end"><Button onClick={loadCommissionsPreview} disabled={commBusy || !commFrom || !commTo}>
              {commBusy ? "جارِ الحساب..." : "حساب"}
            </Button></div>
          </div>
          <ErrorNote msg={commErr} />
          <div className="overflow-x-auto rounded-lg border border-line">
            <table className="w-full border-collapse text-t-sm">
              <thead>
                <tr className="bg-ink-3 text-t-xs font-extrabold text-text-dim">
                  <th className="px-3 py-2 text-right">الموظف</th>
                  <th className="px-2 py-2 text-right">نوع العمولة</th>
                  <th className="px-2 py-2 text-right">النسبة</th>
                  <th className="px-2 py-2 text-right">الأساس</th>
                  <th className="px-2 py-2 text-right">العمولة</th>
                </tr>
              </thead>
              <tbody>
                {commRows.length === 0 ? (
                  <tr><td colSpan={5} className="px-3 py-6 text-center text-text-dim">اختر الفترة واضغط حساب</td></tr>
                ) : commRows.map((r) => (
                  <tr key={r.employee_id} className="border-t border-line/70">
                    <td className="px-3 py-1.5">{r.employee_name}</td>
                    <td className="px-2 py-1.5 text-text-dim">{COMMISSION_TYPE_LABELS[r.commission_type]}</td>
                    <td className="px-2 py-1.5 tnum">{r.commission_pct}%</td>
                    <td className="px-2 py-1.5 tnum text-text-dim">{money(r.commission_type === "pct_sales" ? r.sales_ex : r.gross_profit)}</td>
                    <td className="px-2 py-1.5 tnum font-bold text-emerald">{money(r.commission_amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex justify-end">
            <Button variant="ghost" onClick={() => setCommPreviewOpen(false)}>إغلاق</Button>
          </div>
        </div>
      </Modal>

      {/* ══════════ تشغيل رواتب ══════════ */}
      <Modal open={payrollModal} onClose={() => setPayrollModal(false)} title="تشغيل رواتب الشهر">
        <div className="space-y-3">
          <p className="text-t-sm leading-5 text-text-dim">
            هيتحسب لكل موظف نشط: الراتب الأساسي − خصومات المخالفات في هذا الشهر − حصة الموظف من التأمينات (للسعوديين فقط).
          </p>
          <div className="grid grid-cols-2 gap-2">
            <Field label="الشهر">
              <Select value={payMonth} onChange={(e) => setPayMonth(+e.target.value)}>
                {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => <option key={m} value={m}>{m}</option>)}
              </Select>
            </Field>
            <Field label="السنة"><Input type="number" className="tnum" value={payYear} onChange={(e) => setPayYear(+e.target.value)} /></Field>
          </div>
          <ErrorNote msg={payErr} />
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="ghost" onClick={() => setPayrollModal(false)}>إلغاء</Button>
            <Button onClick={submitPayroll} disabled={payBusy}>{payBusy ? "جارِ الحساب..." : "تشغيل الرواتب"}</Button>
          </div>
        </div>
      </Modal>

      {/* ══════════ قسائم الرواتب ══════════ */}
      <Modal open={!!viewPayslips} size="lg" onClose={() => setViewPayslips(null)} title={`رواتب ${viewPayslips?.run.period_month}/${viewPayslips?.run.period_year}`}>
        {viewPayslips && (
          <div className="space-y-3">
            <div className="overflow-x-auto rounded-lg border border-line">
              <table className="w-full border-collapse text-t-sm">
                <thead>
                  <tr className="bg-ink-3 text-t-xs font-extrabold text-text-dim">
                    <th className="px-3 py-2 text-right">الموظف</th>
                    <th className="px-2 py-2 text-right">الأساسي</th>
                    <th className="px-2 py-2 text-right">عمولة</th>
                    <th className="px-2 py-2 text-right">خصم مخالفات</th>
                    <th className="px-2 py-2 text-right">سلفة</th>
                    <th className="px-2 py-2 text-right">تأمينات (موظف)</th>
                    <th className="px-2 py-2 text-right">الصافي</th>
                    <th className="w-16 px-2 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {viewPayslips.slips.map((s) => (
                    <tr key={s.id} className="border-t border-line/70">
                      <td className="px-3 py-1.5">{s.employee_name}</td>
                      <td className="px-2 py-1.5 tnum">{money(s.basic_salary)}</td>
                      <td className="px-2 py-1.5 tnum text-emerald">{s.commission_amount > 0 ? `+${money(s.commission_amount)}` : "—"}</td>
                      <td className="px-2 py-1.5 tnum text-ember">{s.violations_deduction > 0 ? `-${money(s.violations_deduction)}` : "—"}</td>
                      <td className="px-2 py-1.5 tnum text-ember">{s.advance_deduction > 0 ? `-${money(s.advance_deduction)}` : "—"}</td>
                      <td className="px-2 py-1.5 tnum text-text-dim">{s.gosi_employee > 0 ? `-${money(s.gosi_employee)}` : "—"}</td>
                      <td className="px-2 py-1.5 tnum font-bold">{money(s.net_pay)}</td>
                      <td className="px-2 py-1.5"><Button variant="ghost" size="xs" onClick={() => printPayslip(s, viewPayslips.run)}>طباعة</Button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-t-sm font-bold text-text-dim">
                {viewPayslips.run.status === "paid" ? <Badge tone="good">مدفوعة {viewPayslips.run.payment_method ? `(${viewPayslips.run.payment_method === "cash" ? "نقد" : viewPayslips.run.payment_method === "card" ? "شبكة" : "تحويل"})` : ""}</Badge>
                 : viewPayslips.run.status === "finalized" ? <Badge tone="info">معتمدة — بانتظار الصرف</Badge>
                 : <Badge tone="warn">مسودة</Badge>}
              </span>
              <div className="flex items-center gap-2">
                <Button variant="ghost" onClick={() => setViewPayslips(null)}>إغلاق</Button>
                {canPayroll && viewPayslips.run.status === "draft" && <Button onClick={finalizeRun}>اعتماد نهائي</Button>}
                {canPayroll && viewPayslips.run.status === "finalized" && (
                  <>
                    <Select value={payMethod} onChange={(e) => setPayMethod(e.target.value as any)} className="!w-auto">
                      <option value="transfer">تحويل بنكي</option>
                      <option value="cash">نقد</option>
                      <option value="card">شبكة</option>
                    </Select>
                    <Button onClick={payRun}>تسجيل صرف الرواتب</Button>
                  </>
                )}
              </div>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
