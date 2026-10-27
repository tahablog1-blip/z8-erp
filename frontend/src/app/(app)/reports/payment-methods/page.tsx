"use client";
// المبيعات حسب طريقة الدفع — قراءة فقط من GET /reports/payment-methods (الخادم يجمّع ويحسب النِّسَب)
import { useState } from "react";
import { Donut } from "@/components/dashboard/charts/Donut";
import { Panel } from "@/components/hr/shared";
import { pdfParams, CompareToggle, type CompareMode, type Trend, Kpi, Money, ReportError, ReportFilters, ReportHeader, ReportSkeleton, ReportTable, ReportToolbar, SaveReportButton, cur, kpisHTML, num, tableHTML, useFilters, useReport } from "@/components/reports/ReportShell";

type R = { meta: { from: string; to: string; branchId: string | null; branchLocked: boolean; generatedAt: string }; totals: { amount: number; count: number };
           rows: { method: string; label: string; amount: number; count: number; sharePct: number }[];
           byBranch: { branch: string; total: number; byMethod: Record<string, number> }[]; note: string;
           compare?: { from: string; to: string; amount: Trend; count: Trend } };
const COLORS = ["var(--petrol)", "var(--emerald)", "var(--brass)", "var(--ember)", "var(--text-dim)"];

export default function PaymentMethodsReport() {
  const [f, setF] = useFilters();
  const [cmp, setCmp] = useState<CompareMode>("");
  const { data: d, loading, error, reload } = useReport<R>("/reports/payment-methods", f, { extra: cmp ? `&compare=${cmp}` : "" });
  const methods = d?.rows.map((r) => r.method) ?? [];
  const label = (m: string) => d?.rows.find((r) => r.method === m)?.label ?? m;
  return (
    <div className="space-y-4">
      <ReportHeader title="المبيعات حسب طريقة الدفع" description="القيمة وعدد العمليات والنسبة لكل طريقة دفع مسجّلة في النظام." meta={d?.meta}
        actions={<><SaveReportButton reportId="payment-methods" filters={f} />
          <ReportToolbar onRefresh={reload} pdf={{ id: "payment-methods", params: pdfParams(f) }}
            csv={d && { file: "payment-methods.csv", headers: ["طريقة الدفع", "القيمة", "العمليات", "النسبة %"], rows: d.rows.map((r) => [r.label, r.amount, r.count, r.sharePct]) }}
            print={d && { title: "المبيعات حسب طريقة الدفع", subtitle: `${d.meta.from} → ${d.meta.to}`, body: () => kpisHTML([{ label: "إجمالي المقبوض والآجل", value: cur(d.totals.amount) }, { label: "العمليات", value: num(d.totals.count) }]) + tableHTML(["طريقة الدفع", "القيمة", "العمليات", "النسبة %"], d.rows.map((r) => [r.label, cur(r.amount), num(r.count), r.sharePct]), { numericCols: [1, 2, 3] }) }} /></>} />
      <ReportFilters value={f} onChange={setF} lockedBranch={d?.meta.branchLocked} />
      <CompareToggle value={cmp} onChange={setCmp} />
      {error ? <ReportError msg={error} onRetry={reload} /> : loading || !d ? <ReportSkeleton /> : (<>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
          <Kpi label="الإجمالي" value={<Money v={d.totals.amount} />} sub="مدفوع عند الإصدار + آجل" trend={d.compare?.amount} />
          <Kpi label="عدد العمليات" value={num(d.totals.count)} trend={d.compare?.count} />
          <Kpi label="أعلى طريقة" value={d.rows[0]?.label ?? "—"} sub={d.rows[0] ? `${d.rows[0].sharePct}% من الإجمالي` : undefined} />
        </div>
        <div className="grid gap-4 lg:grid-cols-3">
          <Panel title="توزيع طرق الدفع" icon="donut_large">
            {d.rows.length ? <div className="flex justify-center"><Donut ariaLabel="توزيع طرق الدفع" centerValue={num(d.totals.count)} centerLabel="عملية"
              segments={d.rows.map((r, i) => ({ key: r.method, label: r.label, value: r.amount, color: COLORS[i % COLORS.length] }))} /></div> : null}
            <ul className="mt-3 space-y-1 text-t-sm">{d.rows.map((r, i) => <li key={r.method} className="flex items-center gap-2"><i className="h-2.5 w-2.5 rounded-full" style={{ background: COLORS[i % COLORS.length] }} />{r.label}<b className="ms-auto tnum">{r.sharePct}%</b></li>)}</ul>
          </Panel>
          <div className="lg:col-span-2"><Panel title="التفاصيل" icon="table_rows">
            <ReportTable cols={[{ key: "label", title: "طريقة الدفع" }, { key: "amount", title: "القيمة", num: true, render: (r) => <Money v={r.amount} /> }, { key: "count", title: "العمليات", num: true }, { key: "sharePct", title: "النسبة", num: true, render: (r) => `${r.sharePct}%` }]}
              rows={d.rows} footer={<tr><td className="p-2.5">الإجمالي</td><td className="p-2.5 text-end"><Money v={d.totals.amount} strong /></td><td className="tnum p-2.5 text-end">{num(d.totals.count)}</td><td /></tr>} />
          </Panel></div>
        </div>
        {d.byBranch.length > 0 && <Panel title="حسب الفرع" icon="storefront">
          <ReportTable cols={[{ key: "branch", title: "الفرع" }, ...methods.map((m) => ({ key: m, title: label(m), num: true, value: (r: R["byBranch"][number]) => r.byMethod[m] ?? 0, render: (r: R["byBranch"][number]) => <Money v={r.byMethod[m] ?? 0} /> })), { key: "total", title: "الإجمالي", num: true, render: (r) => <Money v={r.total} strong /> }]} rows={d.byBranch} />
        </Panel>}
        <p className="text-t-xs text-text-dim">{d.note}</p>
      </>)}
    </div>
  );
}
