"use client";
// تقرير المرتجعات (جزئية + كاملة) — قراءة فقط
import Link from "next/link";
import { Badge } from "@/components/ui";
import { Panel } from "@/components/hr/shared";
import { Kpi, Money, ReportError, ReportFilters, ReportHeader, ReportSkeleton, ReportTable, ReportToolbar, cur, dateAr, kpisHTML, num, tableHTML, useFilters, useReport } from "@/components/reports/ReportShell";

type Row = { kind: "partial" | "full"; no: string | null; invoiceNo: string; at: string; branch: string; totalEx: number; vat: number; totalInc: number; note: string | null };
type R = { meta: { from: string; to: string; branchId: string | null; branchLocked: boolean; generatedAt: string }; rows: Row[]; note: string;
           totals: { partialCount: number; partialInc: number; fullCount: number; fullInc: number; totalInc: number } };

export default function ReturnsReport() {
  const [f, setF] = useFilters();
  const { data: d, loading, error, reload } = useReport<R>("/reports/returns", f);
  return (
    <div className="space-y-4">
      <ReportHeader title="تقرير المرتجعات" description="المرتجعات الجزئية والكاملة بالفرع والفترة." meta={d?.meta}
        actions={<ReportToolbar onRefresh={reload}
          csv={d && { file: "returns.csv", headers: ["النوع", "رقم المرتجع", "الفاتورة", "التاريخ", "الفرع", "قبل الضريبة", "الإجمالي"], rows: d.rows.map((r) => [r.kind === "full" ? "كامل" : "جزئي", r.no ?? "", r.invoiceNo, r.at, r.branch, r.totalEx, r.totalInc]) }}
          print={d && { title: "تقرير المرتجعات", subtitle: `${d.meta.from} → ${d.meta.to}`, body: () => kpisHTML([{ label: "إجمالي المرتجعات", value: cur(d.totals.totalInc) }]) + tableHTML(["النوع", "الفاتورة", "التاريخ", "الفرع", "الإجمالي"], d.rows.map((r) => [r.kind === "full" ? "كامل" : "جزئي", r.invoiceNo, dateAr(r.at), r.branch, cur(r.totalInc)]), { numericCols: [4] }) }} />} />
      <ReportFilters value={f} onChange={setF} lockedBranch={d?.meta.branchLocked} />
      {error ? <ReportError msg={error} onRetry={reload} /> : loading || !d ? <ReportSkeleton /> : (<>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Kpi label="إجمالي المرتجعات" value={<Money v={d.totals.totalInc} strong />} />
          <Kpi label="مرتجعات جزئية" value={<Money v={d.totals.partialInc} />} sub={`${num(d.totals.partialCount)} عملية`} />
          <Kpi label="مرتجعات كاملة" value={<Money v={d.totals.fullInc} />} sub={`${num(d.totals.fullCount)} فاتورة`} />
        </div>
        <Panel title="التفاصيل" icon="assignment_return">
          <ReportTable storageKey="returns" cols={[
            { key: "kind", title: "النوع", render: (r) => <Badge tone={r.kind === "full" ? "danger" : "warning"}>{r.kind === "full" ? "كامل" : "جزئي"}</Badge> },
            { key: "no", title: "رقم المرتجع", render: (r) => r.no ?? "—" },
            { key: "invoiceNo", title: "الفاتورة", render: (r) => <Link className="font-bold text-petrol hover:underline" href={`/sales/history?invoiceNo=${encodeURIComponent(r.invoiceNo)}`}>{r.invoiceNo}</Link> },
            { key: "at", title: "التاريخ", render: (r) => dateAr(r.at) }, { key: "branch", title: "الفرع" },
            { key: "totalEx", title: "قبل الضريبة", num: true, render: (r) => <Money v={r.totalEx} /> }, { key: "totalInc", title: "الإجمالي", num: true, render: (r) => <Money v={r.totalInc} strong /> },
            { key: "note", title: "ملاحظة", render: (r) => r.note ?? "—" }]} rows={d.rows} />
        </Panel>
        <p className="text-t-xs text-text-dim">{d.note}</p>
      </>)}
    </div>
  );
}
