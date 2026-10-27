"use client";
// حركة الخزينة — قراءة فقط من GET /reports/treasury (سندات القبض والصرف غير الملغاة)
import { useState } from "react";
import { Panel } from "@/components/hr/shared";
import { pdfParams, CompareToggle, type CompareMode, type Trend, Kpi, Money, ReportError, ReportFilters, ReportHeader, ReportSkeleton, ReportTable, ReportToolbar, SaveReportButton, cur, kpisHTML, num, tableHTML, useFilters, useReport } from "@/components/reports/ReportShell";

type R = { meta: { from: string; to: string; branchId: string | null; branchLocked: boolean; generatedAt: string };
           totals: { receipts: number; payments: number; net: number; count: number };
           byMethod: { type: string; method: string; label: string; count: number; amount: number }[];
           byCategory: { type: string; category: string; count: number; amount: number }[];
           byBranch: { branch: string; receipts: number; payments: number; net: number }[]; note: string;
           compare?: { from: string; to: string; receipts: Trend; payments: Trend; count: Trend } };
const T = (t: string) => (t === "receipt" ? "قبض" : "صرف");

export default function TreasuryReport() {
  const [f, setF] = useFilters();
  const [cmp, setCmp] = useState<CompareMode>("");
  const { data: d, loading, error, reload } = useReport<R>("/reports/treasury", f, { extra: cmp ? `&compare=${cmp}` : "" });
  return (
    <div className="space-y-4">
      <ReportHeader title="حركة الخزينة" description="المقبوضات والمدفوعات بالطريقة والتصنيف والفرع وصافي الحركة." meta={d?.meta}
        actions={<><SaveReportButton reportId="treasury-report" filters={f} />
          <ReportToolbar onRefresh={reload} pdf={{ id: "treasury-report", params: pdfParams(f) }}
            csv={d && { file: "treasury.csv", headers: ["النوع", "التصنيف", "العدد", "المبلغ"], rows: d.byCategory.map((r) => [T(r.type), r.category, r.count, r.amount]) }}
            print={d && { title: "حركة الخزينة", subtitle: `${d.meta.from} → ${d.meta.to}`, body: () => kpisHTML([{ label: "المقبوضات", value: cur(d.totals.receipts) }, { label: "المدفوعات", value: cur(d.totals.payments) }, { label: "الصافي", value: cur(d.totals.net) }]) + tableHTML(["النوع", "التصنيف", "العدد", "المبلغ"], d.byCategory.map((r) => [T(r.type), r.category, num(r.count), cur(r.amount)]), { numericCols: [2, 3] }) }} /></>} />
      <ReportFilters value={f} onChange={setF} lockedBranch={d?.meta.branchLocked} />
      <CompareToggle value={cmp} onChange={setCmp} />
      {error ? <ReportError msg={error} onRetry={reload} /> : loading || !d ? <ReportSkeleton /> : (<>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Kpi label="المقبوضات" value={<Money v={d.totals.receipts} />} trend={d.compare?.receipts} /><Kpi label="المدفوعات" value={<Money v={d.totals.payments} />} trend={d.compare?.payments} goodWhenUp={false} />
          <Kpi label="صافي الحركة" value={<Money v={d.totals.net} strong />} /><Kpi label="عدد السندات" value={num(d.totals.count)} />
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          <Panel title="حسب طريقة الدفع" icon="credit_card"><ReportTable cols={[{ key: "type", title: "النوع", render: (r) => T(r.type) }, { key: "label", title: "الطريقة" }, { key: "count", title: "العدد", num: true }, { key: "amount", title: "المبلغ", num: true, render: (r) => <Money v={r.amount} /> }]} rows={d.byMethod} /></Panel>
          <Panel title="حسب الفرع" icon="storefront"><ReportTable cols={[{ key: "branch", title: "الفرع" }, { key: "receipts", title: "المقبوضات", num: true, render: (r) => <Money v={r.receipts} /> }, { key: "payments", title: "المدفوعات", num: true, render: (r) => <Money v={r.payments} /> }, { key: "net", title: "الصافي", num: true, render: (r) => <Money v={r.net} strong /> }]} rows={d.byBranch} /></Panel>
        </div>
        <Panel title="حسب التصنيف" icon="category"><ReportTable cols={[{ key: "type", title: "النوع", render: (r) => T(r.type) }, { key: "category", title: "التصنيف" }, { key: "count", title: "العدد", num: true }, { key: "amount", title: "المبلغ", num: true, render: (r) => <Money v={r.amount} /> }]} rows={d.byCategory} /></Panel>
        <p className="text-t-xs text-text-dim">{d.note}</p>
      </>)}
    </div>
  );
}
