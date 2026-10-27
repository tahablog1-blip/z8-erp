"use client";
// حركة المخزون (وارد/تحويلات/تسويات) — قراءة فقط
import Link from "next/link";
import { AreaChart } from "@/components/dashboard/charts/AreaChart";
import { Panel } from "@/components/hr/shared";
import { pdfParams, Kpi, Money, ReportError, ReportFilters, ReportHeader, ReportSkeleton, ReportTable, ReportToolbar, num, useFilters, useReport } from "@/components/reports/ReportShell";

type R = { meta: { from: string; to: string; branchId: string | null; branchLocked: boolean; generatedAt: string }; canCost: boolean; note: string; totals: { count: number };
           byType: { type: string; label: string; count: number; qty: number; value: number | null; adjustIn: number | null; adjustOut: number | null }[];
           topProducts: { productId: string | null; name: string; count: number; qty: number }[]; daily: { date: string; count: number; qty: number }[] };

export default function StockMovementsReport() {
  const [f, setF] = useFilters();
  const { data: d, loading, error, reload } = useReport<R>("/reports/stock-movements", f);
  return (
    <div className="space-y-4">
      <ReportHeader title="حركة المخزون" description="الوارد والتحويلات والتسويات بالنوع واليوم والأصناف الأكثر حركة." meta={d?.meta}
        actions={<ReportToolbar onRefresh={reload} pdf={{ id: "stock-movements", params: pdfParams(f) }} csv={d && { file: "stock-movements.csv", headers: ["الصنف", "عدد الحركات", "الكمية"], rows: d.topProducts.map((r) => [r.name, r.count, r.qty]) }} />} />
      <ReportFilters value={f} onChange={setF} lockedBranch={d?.meta.branchLocked} />
      {error ? <ReportError msg={error} onRetry={reload} /> : loading || !d ? <ReportSkeleton /> : (<>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Kpi label="إجمالي الحركات" value={num(d.totals.count)} />
          {d.byType.map((t) => <Kpi key={t.type} label={t.label} value={num(t.count)} sub={`الكمية: ${num(t.qty)}`} />)}
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          <Panel title="الحركة اليومية (عدد الحركات)" icon="show_chart">
            {d.daily.length > 1 ? <AreaChart ariaLabel="الحركة اليومية" formatValue={(n) => num(n)} formatTick={(n) => num(n)} series={[{ key: "count", label: "الحركات", color: "var(--petrol)", values: d.daily.map((x) => x.count) }]} labels={d.daily.map((x) => x.date.slice(5))} /> : <p className="text-t-sm text-text-dim">يلزم يومان على الأقل لعرض الاتجاه.</p>}
          </Panel>
          <Panel title="حسب النوع" icon="swap_horiz">
            <ReportTable cols={[{ key: "label", title: "النوع" }, { key: "count", title: "الحركات", num: true }, { key: "qty", title: "الكمية", num: true },
              ...(d.canCost ? [{ key: "value", title: "القيمة (حيث التكلفة مسجّلة)", num: true, render: (r: R["byType"][number]) => <Money v={r.value} /> }] : []),
              { key: "adj", title: "تسوية: زيادة / نقص", num: true, render: (r) => (r.type === "adjust" ? `+${num(r.adjustIn)} / -${num(r.adjustOut)}` : "—") }]} rows={d.byType} />
          </Panel>
        </div>
        <Panel title="الأصناف الأكثر حركة" icon="inventory_2">
          <ReportTable storageKey="stock-top" cols={[{ key: "name", title: "الصنف", render: (r) => (r.productId ? <Link className="font-bold text-petrol hover:underline" href={`/products/${r.productId}`}>{r.name}</Link> : r.name) }, { key: "count", title: "الحركات", num: true }, { key: "qty", title: "إجمالي الكمية", num: true }]} rows={d.topProducts} />
        </Panel>
        <p className="text-t-xs text-text-dim">{d.note}</p>
      </>)}
    </div>
  );
}
