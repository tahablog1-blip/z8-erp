"use client";
// تحليل المبيعات بأي بُعد (صنف، تصنيف، علامة، موظف، عميل، فرع، نوع السيارة، يوم، شهر) مع مقارنة بفترة أخرى.
// الربح والتكلفة تظهر فقط لمن يملك الصلاحية المالية (يقرّرها الخادم)، والنسب والمقارنة تُحسب في الخادم.
import Link from "next/link";
import { useState } from "react";
import { HBars } from "@/components/dashboard/charts/HBars";
import { Panel } from "@/components/hr/shared";
import { pdfParams, CompareToggle, type CompareMode, Kpi, Money, ReportError, ReportFilters, ReportHeader, ReportSkeleton, ReportTable, ReportToolbar, SaveReportButton, cur, kpisHTML, num, tableHTML, useFilters, useReport, type Trend } from "@/components/reports/ReportShell";

type Row = { key: string | null; label: string; revenue: number; vat: number; qty: number; invoices: number; avgInvoice: number; cogs?: number; grossProfit?: number; marginPct?: number | null };
type R = { meta: { from: string; to: string; branchId: string | null; branchLocked: boolean; generatedAt: string }; dim: string; rows: Row[]; canCost: boolean; truncated: boolean; note: string;
           totals: { revenue: number; qty: number; invoices: number; returnsEx: number; netRevenue: number; cogs?: number; grossProfit?: number };
           compare?: { mode: string; from: string; to: string; revenue: Trend; invoices: Trend; qty: Trend } };
const DIMS: [string, string][] = [["product", "الصنف"], ["category", "التصنيف"], ["brand", "العلامة التجارية"], ["branch", "الفرع"], ["employee", "الموظف"], ["customer", "العميل"], ["car_brand", "علامة السيارة"], ["car_model", "موديل السيارة"], ["day", "اليوم"], ["month", "الشهر"]];

export default function SalesBreakdown() {
  const [f, setF] = useFilters();
  const [dim, setDim] = useState("product");
  const [cmp, setCmp] = useState<CompareMode>("");
  const { data: d, loading, error, reload } = useReport<R>("/reports/sales-breakdown", f, { extra: `&dim=${dim}${cmp ? `&compare=${cmp}` : ""}` });
  const dimLabel = DIMS.find(([k]) => k === dim)?.[1] ?? "";
  const link = (r: Row) => {
    if (!r.key) return r.label;
    if (dim === "product") return <Link className="font-bold text-petrol hover:underline" href={`/products/${r.key}`}>{r.label}</Link>;
    if (dim === "customer") return <Link className="font-bold text-petrol hover:underline" href={`/customers/${r.key}`}>{r.label}</Link>;
    return r.label;
  };
  const cols = d ? [
    { key: "label", title: dimLabel, render: link },
    { key: "revenue", title: "المبيعات (قبل الضريبة)", num: true, render: (r: Row) => <Money v={r.revenue} strong /> },
    { key: "qty", title: "الكمية", num: true },
    { key: "invoices", title: "الفواتير", num: true },
    { key: "avgInvoice", title: "متوسط الفاتورة", num: true, render: (r: Row) => <Money v={r.avgInvoice} /> },
    { key: "vat", title: "الضريبة", num: true, render: (r: Row) => <Money v={r.vat} /> },
    ...(d.canCost ? [
      { key: "cogs", title: "التكلفة", num: true, render: (r: Row) => <Money v={r.cogs} /> },
      { key: "grossProfit", title: "مجمل الربح", num: true, render: (r: Row) => <Money v={r.grossProfit} strong /> },
      { key: "marginPct", title: "الهامش", num: true, value: (r: Row) => r.marginPct ?? -1, render: (r: Row) => (r.marginPct == null ? "—" : <span className={r.marginPct < 0 ? "text-ember" : ""}>{r.marginPct}%</span>) },
    ] : []),
  ] : [];
  return (
    <div className="space-y-4">
      <ReportHeader title="تحليل المبيعات" description="المبيعات بأي بُعد — اختر البُعد والفترة، وقارنها بفترة أخرى." meta={d?.meta}
        actions={<><SaveReportButton reportId="sales-breakdown" filters={f} />
          <ReportToolbar onRefresh={reload} pdf={{ id: "sales-breakdown", params: pdfParams(f, { dim, ...(cmp ? { compare: cmp } : {}) }) }}
            csv={d && { file: `sales-by-${dim}.csv`, headers: [dimLabel, "المبيعات", "الكمية", "الفواتير", ...(d.canCost ? ["التكلفة", "الربح"] : [])], rows: d.rows.map((r) => [r.label, r.revenue, r.qty, r.invoices, ...(d.canCost ? [r.cogs ?? 0, r.grossProfit ?? 0] : [])]) }}
            print={d && { title: `تحليل المبيعات حسب ${dimLabel}`, subtitle: `${d.meta.from} → ${d.meta.to}`, body: () => kpisHTML([{ label: "المبيعات", value: cur(d.totals.revenue) }, { label: "صافي بعد المرتجعات", value: cur(d.totals.netRevenue) }, { label: "الفواتير", value: num(d.totals.invoices) }]) + tableHTML([dimLabel, "المبيعات", "الكمية", "الفواتير"], d.rows.map((r) => [r.label, cur(r.revenue), num(r.qty), num(r.invoices)]), { numericCols: [1, 2, 3] }) }} /></>} />
      <ReportFilters value={f} onChange={setF} lockedBranch={d?.meta.branchLocked} />
      <div className="no-scrollbar flex gap-1.5 overflow-x-auto" role="tablist" aria-label="بُعد التحليل">
        {DIMS.map(([k, l]) => <button key={k} role="tab" aria-selected={dim === k} onClick={() => setDim(k)}
          className={`shrink-0 rounded-full border px-3 py-1.5 text-t-sm font-bold ${dim === k ? "border-petrol bg-petrol text-white" : "border-line text-text-dim hover:border-petrol"}`}>{l}</button>)}
      </div>
      <CompareToggle value={cmp} onChange={setCmp} />
      {error ? <ReportError msg={error} onRetry={reload} /> : loading || !d ? <ReportSkeleton /> : (<>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-5">
          <Kpi label="المبيعات (قبل الضريبة)" value={<Money v={d.totals.revenue} />} trend={d.compare?.revenue} />
          <Kpi label="مرتجعات جزئية" value={<Money v={d.totals.returnsEx} />} />
          <Kpi label="صافي المبيعات" value={<Money v={d.totals.netRevenue} strong />} sub="بعد المرتجعات الجزئية" />
          <Kpi label="عدد الفواتير" value={num(d.totals.invoices)} trend={d.compare?.invoices} />
          {d.canCost && d.totals.grossProfit != null ? <Kpi label="مجمل الربح" value={<Money v={d.totals.grossProfit} strong />} sub="بتكلفة الصنف الحالية" /> : <Kpi label="الكمية" value={num(d.totals.qty)} trend={d.compare?.qty} />}
        </div>
        {d.compare && <p className="text-t-xs text-text-dim">المقارنة مع {d.compare.from} → {d.compare.to}. لا تظهر نسبة التغيّر إذا كانت قيمة الفترة المقارنة صفراً.</p>}
        <div className="grid gap-4 lg:grid-cols-3">
          <Panel title={`أعلى 10 حسب ${dimLabel}`} icon="leaderboard">
            {d.rows.length ? <HBars rows={d.rows.slice(0, 10).map((r) => ({ key: r.key ?? r.label, label: r.label, value: r.revenue, display: cur(r.revenue) }))} /> : <p className="text-t-sm text-text-dim">لا توجد بيانات.</p>}
          </Panel>
          <div className="lg:col-span-2"><Panel title="التفاصيل" icon="table_rows">
            <ReportTable storageKey={`sales-breakdown-${dim}`} cols={cols} rows={d.rows} />
            {d.truncated && <p className="mt-2 text-t-xs text-text-dim">عُرض أعلى 500 صف فقط — ضيّق الفترة أو الفرع.</p>}
          </Panel></div>
        </div>
        <p className="text-t-xs text-text-dim">{d.note}</p>
      </>)}
    </div>
  );
}
