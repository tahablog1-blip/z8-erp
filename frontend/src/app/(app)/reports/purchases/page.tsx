"use client";
// تقرير المشتريات — قراءة فقط من GET /reports/purchases
import { useState } from "react";
import { Panel } from "@/components/hr/shared";
import { HBars } from "@/components/dashboard/charts/HBars";
import { CompareToggle, type CompareMode, type Trend, Kpi, Money, ReportError, ReportFilters, ReportHeader, ReportSkeleton, ReportTable, ReportToolbar, SaveReportButton, cur, kpisHTML, num, tableHTML, useFilters, useReport } from "@/components/reports/ReportShell";

type Row = { supplier_id: string | null; name: string; n: number; subtotal: number; vat: number; total: number; paid: number; remaining: number };
type R = { meta: { from: string; to: string; branchId: string | null; branchLocked: boolean; generatedAt: string };
           totals: { n: number; subtotal: number; vat: number; total: number; paid: number; remaining: number }; bySupplier: Row[]; byMonth: { month: string; n: number; total: number; vat: number }[]; note: string;
           compare?: { from: string; to: string; total: Trend; vat: Trend; paid: Trend; n: Trend } };

export default function PurchasesReport() {
  const [f, setF] = useFilters();
  const [cmp, setCmp] = useState<CompareMode>("");
  const { data: d, loading, error, reload } = useReport<R>("/reports/purchases", f, { branch: false, extra: cmp ? `&compare=${cmp}` : "" });
  return (
    <div className="space-y-4">
      <ReportHeader title="تقرير المشتريات" description="المشتريات بالمورد والشهر: الإجمالي والضريبة والمدفوع والمتبقي." meta={d?.meta}
        actions={<><SaveReportButton reportId="purchases" filters={f} />
          <ReportToolbar onRefresh={reload}
            csv={d && { file: "purchases.csv", headers: ["المورد", "الفواتير", "قبل الضريبة", "الضريبة", "الإجمالي", "المدفوع", "المتبقي"], rows: d.bySupplier.map((r) => [r.name, r.n, r.subtotal, r.vat, r.total, r.paid, r.remaining]) }}
            print={d && { title: "تقرير المشتريات", subtitle: `${d.meta.from} → ${d.meta.to}`, body: () => kpisHTML([{ label: "إجمالي المشتريات", value: cur(d.totals.total) }, { label: "المدفوع", value: cur(d.totals.paid) }, { label: "المتبقي", value: cur(d.totals.remaining) }]) + tableHTML(["المورد", "الفواتير", "الإجمالي", "المدفوع", "المتبقي"], d.bySupplier.map((r) => [r.name, num(r.n), cur(r.total), cur(r.paid), cur(r.remaining)]), { numericCols: [1, 2, 3, 4] }) }} /></>} />
      <ReportFilters value={f} onChange={setF} branches={false} />
      <CompareToggle value={cmp} onChange={setCmp} />
      {error ? <ReportError msg={error} onRetry={reload} /> : loading || !d ? <ReportSkeleton /> : (<>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          <Kpi label="إجمالي المشتريات" value={<Money v={d.totals.total} />} sub={`${num(d.totals.n)} فاتورة`} trend={d.compare?.total} goodWhenUp={false} />
          <Kpi label="قبل الضريبة" value={<Money v={d.totals.subtotal} />} />
          <Kpi label="ضريبة المدخلات" value={<Money v={d.totals.vat} />} trend={d.compare?.vat} />
          <Kpi label="المدفوع" value={<Money v={d.totals.paid} />} />
          <Kpi label="المتبقي" value={<Money v={d.totals.remaining} />} tone={d.totals.remaining > 0 ? "danger" : "neutral"} />
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          <Panel title="أعلى الموردين شراءً" icon="local_shipping">
            {d.bySupplier.length ? <HBars rows={d.bySupplier.slice(0, 8).map((r) => ({ key: r.name, label: r.name, value: r.total, display: cur(r.total) }))} /> : <p className="text-t-sm text-text-dim">لا توجد بيانات.</p>}
          </Panel>
          <Panel title="حسب الشهر" icon="calendar_month">
            <ReportTable cols={[{ key: "month", title: "الشهر" }, { key: "n", title: "الفواتير", num: true }, { key: "vat", title: "الضريبة", num: true, render: (r) => <Money v={r.vat} /> }, { key: "total", title: "الإجمالي", num: true, render: (r) => <Money v={r.total} /> }]} rows={d.byMonth} />
          </Panel>
        </div>
        <Panel title="حسب المورد" icon="table_rows">
          <ReportTable cols={[{ key: "name", title: "المورد" }, { key: "n", title: "الفواتير", num: true }, { key: "subtotal", title: "قبل الضريبة", num: true, render: (r) => <Money v={r.subtotal} /> }, { key: "vat", title: "الضريبة", num: true, render: (r) => <Money v={r.vat} /> },
            { key: "total", title: "الإجمالي", num: true, render: (r) => <Money v={r.total} strong /> }, { key: "paid", title: "المدفوع", num: true, render: (r) => <Money v={r.paid} /> }, { key: "remaining", title: "المتبقي", num: true, render: (r) => <Money v={r.remaining} /> }]} rows={d.bySupplier} />
        </Panel>
        <p className="text-t-xs text-text-dim">{d.note}</p>
      </>)}
    </div>
  );
}
