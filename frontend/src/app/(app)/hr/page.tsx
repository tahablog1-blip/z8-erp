"use client";
// شاشة الموارد البشرية — الموظفون، الحضور والانصراف، الإجازات، المخالفات، الرواتب
import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { DataTable, Column } from "@/components/DataTable";
import { Badge, Button, Card, ErrorNote, Field, Input, Modal, Select, Tabs, Textarea } from "@/components/ui";
import { appAlert, appConfirm } from "@/components/dialog";
import {
  Attendance, CONTRACT_LABELS, Employee, IqamaAlert, LEAVE_TYPE_LABELS, LeaveBalance,
  LeaveRequest, LeaveType, PayrollRun, Payslip, Violation, money,
} from "@/modules/hr/types";

type Branch = { id: string; name: string };
type Tab = "employees" | "attendance" | "leave" | "violations" | "payroll";

const dateFmt = (s: string) =>
  new Date(s).toLocaleDateString("ar-SA-u-nu-latn", { year: "numeric", month: "2-digit", day: "2-digit" });
const timeFmt = (s: string | null) =>
  s ? new Date(s).toLocaleTimeString("ar-SA-u-nu-latn", { hour: "2-digit", minute: "2-digit" }) : "—";

const EMPTY_EMP = {
  branchId: "", fullName: "", nationalId: "", nationality: "", isSaudi: false, phone: "",
  jobTitle: "", techRole: "", contractType: "full_time" as Employee["contract_type"], hireDate: "",
  basicSalary: 0, allowances: 0, iban: "", iqamaNumber: "", iqamaExpiryDate: "", approvalPin: "",
  linkedUserId: "",
};

export default function HrPage() {
  const { hasPerm } = useAuth();
  const canView = hasPerm("hr.view", "hr.manage");
  const canManage = hasPerm("hr.manage");
  const canAttendance = hasPerm("hr.attendance");
  const canLeaveApprove = hasPerm("hr.leave_approve");
  const canViolations = hasPerm("hr.violations");
  const canPayroll = hasPerm("hr.payroll");

  const [tab, setTab] = useState<Tab>(canView ? "employees" : "attendance");
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  // ── حسابات الدخول للربط بالموظفين — المدير العام (admin) مستبعد عمداً ──
  type LoginUser = { id: string; email: string; full_name: string; role: string; is_active: boolean };
  const [loginUsers, setLoginUsers] = useState<LoginUser[]>([]);
  const [iqamaAlerts, setIqamaAlerts] = useState<IqamaAlert[]>([]);
  const [attendance, setAttendance] = useState<Attendance[]>([]);
  const [leaves, setLeaves] = useState<LeaveRequest[]>([]);
  const [violations, setViolations] = useState<Violation[]>([]);
  const [payrollRuns, setPayrollRuns] = useState<PayrollRun[]>([]);
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
  const [leaveForm, setLeaveForm] = useState({ employeeId: "", leaveType: "annual" as LeaveType, startDate: "", endDate: "", reason: "" });
  const [leaveErr, setLeaveErr] = useState("");
  const [balance, setBalance] = useState<LeaveBalance | null>(null);

  // ── نموذج مخالفة ──
  const [violModal, setViolModal] = useState(false);
  const [violForm, setViolForm] = useState({ employeeId: "", violationType: "", description: "", deductionAmount: 0 });
  const [violErr, setViolErr] = useState("");

  // ── الرواتب ──
  const [payrollModal, setPayrollModal] = useState(false);
  const [payMonth, setPayMonth] = useState(new Date().getMonth() + 1);
  const [payYear, setPayYear] = useState(new Date().getFullYear());
  const [payErr, setPayErr] = useState("");
  const [payBusy, setPayBusy] = useState(false);
  const [viewPayslips, setViewPayslips] = useState<{ run: PayrollRun; slips: Payslip[] } | null>(null);

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

  function changeTab(t: Tab) {
    setTab(t);
    if (t === "attendance" && attendance.length === 0) loadAttendance();
    if (t === "leave" && leaves.length === 0) loadLeaves();
    if (t === "violations" && violations.length === 0) loadViolations();
    if (t === "payroll" && payrollRuns.length === 0) loadPayroll();
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
      basicSalary: e.basic_salary,
      allowances: (e as { allowances?: number }).allowances || 0,
      iban: e.iban || "",
      // حقل واحد للهوية/الإقامة — الصفوف القديمة اللي اتسجل فيها رقم الإقامة بس بتتقري برضو
      iqamaNumber: e.national_id || e.iqama_number || "",
      iqamaExpiryDate: e.iqama_expiry_date || "",
      approvalPin: (e as { approval_pin?: string | null }).approval_pin || "",
      linkedUserId: (e as { linked_user_id?: string | null }).linked_user_id || "",
    });
    setEmpErr(""); setEmpModal({ mode: "edit", emp: e });
  }
  async function saveEmp() {
    setEmpErr("");
    try {
      const body = JSON.stringify({ ...empForm, nationalId: empForm.iqamaNumber,
                                    linkedUserId: empForm.linkedUserId || null });
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
      const res = await api<{ endOfServiceEstimate: { amount: number; totalYears: number; note: string } }>(
        `/hr/employees/${e.id}/terminate`, { method: "POST", body: JSON.stringify({}) }
      );
      await appAlert(`تقدير مكافأة نهاية الخدمة: ${money(res.endOfServiceEstimate.amount)} ر.س (${res.endOfServiceEstimate.totalYears} سنة)\n${res.endOfServiceEstimate.note}`);
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

  // ══════════════════ الرواتب ══════════════════

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
    if (!await appConfirm("اعتماد دورة الرواتب دي نهائياً؟ مش هينفع تتعدّل بعد كده.")) return;
    try {
      await api(`/hr/payroll-runs/${viewPayslips.run.id}/finalize`, { method: "POST" });
      setViewPayslips(null);
      await loadPayroll();
    } catch (e: any) { await appAlert(e.message); }
  }

  // ══════════════════ الأعمدة ══════════════════

  const empCols: Column<Employee>[] = [
    { key: "full_name", title: "الاسم", render: (e) => (
      <div><div className="font-extrabold">{e.full_name}</div><div className="text-[11px] text-text-dim">{e.job_title || "—"}</div></div>
    ) },
    { key: "branch_name", title: "الفرع", width: "110px", render: (e) => e.branch_name || "—" },
    { key: "linked_email", title: "حساب الدخول", width: "160px", render: (e) => {
      const mail = (e as { linked_email?: string | null }).linked_email;
      return mail
        ? <span className="tnum text-[11px] font-bold text-petrol" dir="ltr">{mail}</span>
        : <span className="text-[11px] text-text-dim">غير مرتبط</span>;
    } },
    { key: "contract_type", title: "نوع العقد", width: "100px", render: (e) => CONTRACT_LABELS[e.contract_type] },
    { key: "basic_salary", title: "الراتب الأساسي", width: "110px", render: (e) => <span className="tnum font-bold">{money(e.basic_salary)}</span> },
    { key: "is_active", title: "الحالة", width: "90px", render: (e) => e.is_active ? <Badge tone="good">نشط</Badge> : <Badge tone="neutral">منتهي</Badge> },
    ...(canManage ? [{
      key: "actions", title: "", width: "180px",
      render: (e: Employee) => (
        <div className="flex justify-end gap-1.5">
          <Button variant="ghost" className="!px-2.5 !py-1 !text-[11.5px]" onClick={() => openEditEmp(e)}>تعديل</Button>
          {e.is_active && <Button variant="danger" className="!px-2.5 !py-1 !text-[11.5px]" onClick={() => terminateEmp(e)}>إنهاء خدمة</Button>}
        </div>
      ),
    } satisfies Column<Employee>] : []),
  ];

  const attCols: Column<Attendance>[] = [
    { key: "employee_name", title: "الموظف" },
    { key: "work_date", title: "التاريخ", width: "110px", render: (a) => dateFmt(a.work_date) },
    { key: "check_in", title: "الحضور", width: "90px", render: (a) => <span className="tnum">{timeFmt(a.check_in)}</span> },
    { key: "check_out", title: "الانصراف", width: "90px", render: (a) => <span className="tnum">{timeFmt(a.check_out)}</span> },
  ];

  const leaveCols: Column<LeaveRequest>[] = [
    { key: "employee_name", title: "الموظف" },
    { key: "leave_type", title: "النوع", width: "90px", render: (l) => LEAVE_TYPE_LABELS[l.leave_type] },
    { key: "start_date", title: "من", width: "100px", render: (l) => dateFmt(l.start_date) },
    { key: "end_date", title: "إلى", width: "100px", render: (l) => dateFmt(l.end_date) },
    { key: "days_count", title: "الأيام", width: "70px", render: (l) => <span className="tnum">{l.days_count}</span> },
    { key: "status", title: "الحالة", width: "100px", render: (l) =>
      l.status === "approved" ? <Badge tone="good">معتمدة</Badge> : l.status === "rejected" ? <Badge tone="warn">مرفوضة</Badge> : <Badge tone="neutral">معلّقة</Badge> },
    ...(canLeaveApprove ? [{
      key: "actions", title: "", width: "150px",
      render: (l: LeaveRequest) => l.status === "pending" ? (
        <div className="flex justify-end gap-1.5">
          <Button variant="ghost" className="!px-2.5 !py-1 !text-[11.5px]" onClick={() => decideLeave(l, "approved")}>اعتماد</Button>
          <Button variant="danger" className="!px-2.5 !py-1 !text-[11.5px]" onClick={() => decideLeave(l, "rejected")}>رفض</Button>
        </div>
      ) : null,
    } satisfies Column<LeaveRequest>] : []),
  ];

  const violCols: Column<Violation>[] = [
    { key: "employee_name", title: "الموظف" },
    { key: "violation_date", title: "التاريخ", width: "110px", render: (v) => dateFmt(v.violation_date) },
    { key: "violation_type", title: "النوع" },
    { key: "deduction_amount", title: "الخصم", width: "100px", render: (v) => <span className="tnum font-bold text-ember">{money(v.deduction_amount)}</span> },
  ];

  const payrollCols: Column<PayrollRun>[] = [
    { key: "period_month", title: "الشهر", width: "100px", render: (r) => <span className="tnum">{r.period_month}/{r.period_year}</span> },
    { key: "status", title: "الحالة", width: "100px", render: (r) => r.status === "finalized" ? <Badge tone="good">معتمدة</Badge> : <Badge tone="warn">مسودة</Badge> },
    { key: "payslip_count", title: "عدد القسائم", width: "100px", render: (r) => <span className="tnum">{r.payslip_count}</span> },
    { key: "total_net", title: "إجمالي الصافي", width: "130px", render: (r) => <span className="tnum font-bold">{money(r.total_net || 0)}</span> },
    { key: "actions", title: "", width: "90px", render: (r) => <Button variant="ghost" className="!px-2.5 !py-1 !text-[11.5px]" onClick={() => openPayslips(r)}>عرض</Button> },
  ];

  if (loading) return <div className="text-text-dim">جارِ التحميل...</div>;

  return (
    <div className="space-y-4">
      <h1 className="text-[19px] font-extrabold">الموارد البشرية</h1>
      <ErrorNote msg={pageErr} />

      {canView && iqamaAlerts.length > 0 && (
        <div className="rounded-lg border border-ember/30 bg-ember-bg px-4 py-2.5 text-[12.5px] font-bold text-ember">
          {iqamaAlerts.length} إقامة قربت تنتهي: {iqamaAlerts.slice(0, 3).map((a) => `${a.full_name} (${a.days_remaining} يوم)`).join("، ")}
          {iqamaAlerts.length > 3 && " ..."}
        </div>
      )}

      <Card className="!p-0">
        <div className="px-5 pt-4">
          <Tabs value={tab} onChange={(t) => changeTab(t as Tab)} items={[
            ...(canView ? [{ key: "employees" as Tab, label: "الموظفون" }] : []),
            ...(canAttendance ? [{ key: "attendance" as Tab, label: "الحضور والانصراف" }] : []),
            { key: "leave" as Tab, label: "الإجازات" },
            ...(canViolations ? [{ key: "violations" as Tab, label: "المخالفات" }] : []),
            ...(canPayroll ? [{ key: "payroll" as Tab, label: "الرواتب" }] : []),
          ]} />
        </div>

        <div className="p-5">
          {tab === "employees" && canView && (
            <DataTable columns={empCols} rows={employees} searchKeys={["full_name", "job_title"]}
                      searchPlaceholder="بحث بالاسم أو الوظيفة..." emptyText="لا يوجد موظفون بعد"
                      toolbar={canManage && <Button onClick={openCreateEmp}>+ موظف جديد</Button>} />
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
                      toolbar={<Button onClick={() => { setPayErr(""); setPayrollModal(true); }}>+ تشغيل رواتب</Button>} />
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
              <select className="w-full rounded-xl border border-line bg-ink-2 px-3 py-2 text-[13px] font-bold"
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
          <div className="grid gap-2 sm:grid-cols-3">
            <Field label="رقم الجوال"><Input value={empForm.phone} className="tnum" onChange={(e) => setEmpForm({ ...empForm, phone: e.target.value })} /></Field>
            <Field label="الجنسية"><Input value={empForm.nationality} onChange={(e) => setEmpForm({ ...empForm, nationality: e.target.value })} /></Field>
            <Field label="تاريخ التعيين"><Input type="date" className="tnum" value={empForm.hireDate} onChange={(e) => setEmpForm({ ...empForm, hireDate: e.target.value })} /></Field>
          </div>
          <label className="flex items-center gap-2 text-[12.5px] font-bold text-text-dim">
            <input type="checkbox" className="accent-petrol" checked={empForm.isSaudi} onChange={(e) => setEmpForm({ ...empForm, isSaudi: e.target.checked })} />
            سعودي الجنسية (يحدد نسب التأمينات في الرواتب)
          </label>
          <div className="grid gap-2 sm:grid-cols-3">
            <Field label="رقم الهوية / الإقامة">
              <Input value={empForm.iqamaNumber} className="tnum" onChange={(e) => setEmpForm({ ...empForm, iqamaNumber: e.target.value })} />
            </Field>
            {!empForm.isSaudi && (
              <Field label="تاريخ انتهاء الإقامة" hint="لتنبيهات التجديد المبكرة">
                <Input type="date" className="tnum" value={empForm.iqamaExpiryDate} onChange={(e) => setEmpForm({ ...empForm, iqamaExpiryDate: e.target.value })} />
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
            <Field label="الراتب الأساسي"><Input type="number" min={0} step="0.01" className="tnum" value={empForm.basicSalary} onChange={(e) => setEmpForm({ ...empForm, basicSalary: +e.target.value || 0 })} /></Field>
            <Field label="البدلات الشهرية" hint="سكن/نقل/أخرى — تُضاف لصافي الراتب">
              <Input type="number" min={0} step="0.01" className="tnum" value={empForm.allowances} onChange={(e) => setEmpForm({ ...empForm, allowances: +e.target.value || 0 })} />
            </Field>
            <Field label="رقم الآيبان"><Input value={empForm.iban} className="tnum" onChange={(e) => setEmpForm({ ...empForm, iban: e.target.value })} /></Field>
          </div>
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
            <div className="rounded-lg bg-ink-3 p-2.5 text-[11.5px] text-text-dim">
              رصيد الإجازة السنوية: <b className="tnum text-text">{balance.remaining}</b> من {balance.annualEntitlement} يوم (استُخدم {balance.used})
            </div>
          )}
          <div className="grid grid-cols-2 gap-2">
            <Field label="نوع الإجازة">
              <Select value={leaveForm.leaveType} onChange={(e) => setLeaveForm({ ...leaveForm, leaveType: e.target.value as LeaveType })}>
                {Object.entries(LEAVE_TYPE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </Select>
            </Field>
            <Field label="عدد الأيام"><div className="pt-2 tnum text-[13px] text-text-dim">
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

      {/* ══════════ تشغيل رواتب ══════════ */}
      <Modal open={payrollModal} onClose={() => setPayrollModal(false)} title="تشغيل رواتب الشهر">
        <div className="space-y-3">
          <p className="text-[12px] leading-5 text-text-dim">
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
              <table className="w-full border-collapse text-[12px]">
                <thead>
                  <tr className="bg-ink-3 text-[11px] font-extrabold text-text-dim">
                    <th className="px-3 py-2 text-right">الموظف</th>
                    <th className="px-2 py-2 text-right">الأساسي</th>
                    <th className="px-2 py-2 text-right">خصم مخالفات</th>
                    <th className="px-2 py-2 text-right">تأمينات (موظف)</th>
                    <th className="px-2 py-2 text-right">الصافي</th>
                  </tr>
                </thead>
                <tbody>
                  {viewPayslips.slips.map((s) => (
                    <tr key={s.id} className="border-t border-line/70">
                      <td className="px-3 py-1.5">{s.employee_name}</td>
                      <td className="px-2 py-1.5 tnum">{money(s.basic_salary)}</td>
                      <td className="px-2 py-1.5 tnum text-ember">{s.violations_deduction > 0 ? `-${money(s.violations_deduction)}` : "—"}</td>
                      <td className="px-2 py-1.5 tnum text-text-dim">{s.gosi_employee > 0 ? `-${money(s.gosi_employee)}` : "—"}</td>
                      <td className="px-2 py-1.5 tnum font-bold">{money(s.net_pay)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[12.5px] font-bold text-text-dim">
                {viewPayslips.run.status === "finalized" ? <Badge tone="good">معتمدة نهائياً</Badge> : <Badge tone="warn">مسودة</Badge>}
              </span>
              <div className="flex gap-2">
                <Button variant="ghost" onClick={() => setViewPayslips(null)}>إغلاق</Button>
                {canPayroll && viewPayslips.run.status === "draft" && <Button onClick={finalizeRun}>اعتماد نهائي</Button>}
              </div>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
