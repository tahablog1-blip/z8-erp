"use client";
// تقارير الموارد البشرية — قراءة فقط من GET /reports/hr (الرواتب لمن يملك hr.payroll + hr.salary.view وعلى مستوى الشركة)
import { HBars } from "@/components/dashboard/charts/HBars";
import { Panel, MONTHS_AR, fmtMin } from "@/components/hr/shared";
import { LEAVE_TYPE_LABELS } from "@/modules/hr/types";
import { pdfParams, Kpi, Money, ReportError, ReportFilters, ReportHeader, ReportSkeleton, ReportTable, ReportToolbar, num, useFilters, useReport } from "@/components/reports/ReportShell";

type R = { meta: { from: string; to: string; branchId: string | null; branchLocked: boolean; generatedAt: string }; note: string;
           headcount: { total: number; saudi: number; nonSaudi: number; byBranch: { name: string; count: number }[]; byDepartment: { name: string; count: number }[] };
           attendance: { daysPresent: number; lateDays: number; lateMinutes: number; overtimeMinutes: number; workedMinutes: number };
           leave: { type: string; requests: number; days: number }[]; contracts: { expired: number; d30: number; d90: number };
           payroll: { year: number; month: number; status: string; slips: number; basic: number; allowances: number; deductions: number; advances: number; net: number }[] | null };

export default function HrReport() {
  const [f, setF] = useFilters();
  const { data: d, loading, error, reload } = useReport<R>("/reports/hr", f);
  return (
    <div className="space-y-4">
      <ReportHeader title="تقارير الموارد البشرية" description="الموظفون والحضور والإجازات والعقود، والرواتب لمن يملك صلاحيتها." meta={d?.meta}
        actions={<ReportToolbar onRefresh={reload} pdf={{ id: "hr-report", params: pdfParams(f) }} csv={d && { file: "hr-headcount.csv", headers: ["الفرع", "عدد الموظفين"], rows: d.headcount.byBranch.map((r) => [r.name, r.count]) }} />} />
      <ReportFilters value={f} onChange={setF} lockedBranch={d?.meta.branchLocked} />
      {error ? <ReportError msg={error} onRetry={reload} /> : loading || !d ? <ReportSkeleton /> : (<>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-6">
          <Kpi label="الموظفون النشطون" value={num(d.headcount.total)} sub={`${num(d.headcount.saudi)} سعودي · ${num(d.headcount.nonSaudi)} غير سعودي`} />
          <Kpi label="أيام الحضور" value={num(d.attendance.daysPresent)} sub={`ساعات العمل ${fmtMin(d.attendance.workedMinutes)}`} />
          <Kpi label="أيام التأخير" value={num(d.attendance.lateDays)} sub={`${fmtMin(d.attendance.lateMinutes)} ساعة`} tone={d.attendance.lateDays ? "danger" : "neutral"} />
          <Kpi label="الإضافي" value={`${fmtMin(d.attendance.overtimeMinutes)} ساعة`} />
          <Kpi label="عقود منتهية" value={num(d.contracts.expired)} tone={d.contracts.expired ? "danger" : "neutral"} />
          <Kpi label="تنتهي خلال 90 يوماً" value={num(d.contracts.d30 + d.contracts.d90)} sub={`${num(d.contracts.d30)} خلال 30 يوماً`} />
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          <Panel title="الموظفون حسب الفرع" icon="storefront">{d.headcount.byBranch.length ? <HBars rows={d.headcount.byBranch.map((r) => ({ key: r.name, label: r.name, value: r.count, display: num(r.count) }))} /> : <p className="text-t-sm text-text-dim">لا توجد بيانات.</p>}</Panel>
          <Panel title="الموظفون حسب القسم" icon="account_tree">{d.headcount.byDepartment.length ? <HBars rows={d.headcount.byDepartment.map((r) => ({ key: r.name, label: r.name, value: r.count, display: num(r.count) }))} color="var(--emerald)" /> : <p className="text-t-sm text-text-dim">لا توجد بيانات.</p>}</Panel>
        </div>
        <Panel title="الإجازات المعتمدة في الفترة" icon="beach_access">
          <ReportTable cols={[{ key: "type", title: "النوع", render: (r) => LEAVE_TYPE_LABELS[r.type] ?? r.type }, { key: "requests", title: "الطلبات", num: true }, { key: "days", title: "الأيام", num: true }]} rows={d.leave} />
        </Panel>
        {d.payroll && (
          <Panel title="مسيرات الرواتب" icon="request_page">
            <ReportTable cols={[{ key: "m", title: "الشهر", render: (r) => <bdi>{MONTHS_AR[r.month - 1]} {r.year}</bdi> }, { key: "status", title: "الحالة", render: (r) => (r.status === "paid" ? "مدفوع" : r.status === "finalized" ? "معتمد" : "مسودة") },
              { key: "slips", title: "القسائم", num: true }, { key: "basic", title: "الأساسي", num: true, render: (r) => <Money v={r.basic} /> }, { key: "allowances", title: "البدلات", num: true, render: (r) => <Money v={r.allowances} /> },
              { key: "deductions", title: "الخصومات", num: true, render: (r) => <Money v={r.deductions} /> }, { key: "advances", title: "السلف", num: true, render: (r) => <Money v={r.advances} /> }, { key: "net", title: "الصافي", num: true, render: (r) => <Money v={r.net} strong /> }]} rows={d.payroll} />
          </Panel>)}
        <p className="text-t-xs text-text-dim">{d.note}</p>
      </>)}
    </div>
  );
}
