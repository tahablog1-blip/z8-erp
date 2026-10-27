"use client";
// فحص التسوية: إيرادات/ضريبة/تكلفة الفواتير مقابل دفتر الأستاذ. لا يعدّل شيئاً، ولا يُخفي أي فرق.
import { Badge } from "@/components/ui";
import { Panel } from "@/components/hr/shared";
import { Money, ReportError, ReportFilters, ReportHeader, ReportSkeleton, ReportTable, ReportToolbar, num, useFilters, useReport } from "@/components/reports/ReportShell";

type R = { meta: { from: string; to: string; branchId: string | null; branchLocked: boolean; generatedAt: string }; status: "ok" | "mismatch"; warning: string | null; note: string; fullReturnsInPeriod: number;
           checks: { key: string; label: string; invoices: number; ledger: number; diff: number; ok: boolean; note: string }[] };

export default function ReconciliationReport() {
  const [f, setF] = useFilters();
  const { data: d, loading, error, reload } = useReport<R>("/reports/reconciliation", f);
  return (
    <div className="space-y-4">
      <ReportHeader title="فحص التسوية: الفواتير مقابل دفتر الأستاذ" description="يقارن الأرقام التشغيلية بالمحاسبية للفترة ويُظهر أي فرق." meta={d?.meta}
        actions={<ReportToolbar onRefresh={reload} csv={d && { file: "reconciliation.csv", headers: ["البند", "الفواتير", "الأستاذ", "الفرق"], rows: d.checks.map((c) => [c.label, c.invoices, c.ledger, c.diff]) }} />} />
      <ReportFilters value={f} onChange={setF} lockedBranch={d?.meta.branchLocked} />
      {error ? <ReportError msg={error} onRetry={reload} /> : loading || !d ? <ReportSkeleton /> : (<>
        {d.warning ? <div role="alert" className="rounded-lg border border-ember/30 bg-ember-bg px-4 py-3 text-t-sm font-bold text-ember">⚠ تحذير سلامة بيانات: {d.warning}</div>
                    : <div className="rounded-lg border border-emerald/30 bg-emerald-bg px-4 py-3 text-t-sm font-bold text-emerald">الأرقام التشغيلية تطابق دفتر الأستاذ للفترة (ضمن هامش 0.05 ر.س).</div>}
        <Panel title="نتيجة الفحص" icon="rule">
          <ReportTable cols={[{ key: "label", title: "البند" }, { key: "invoices", title: "من الفواتير", num: true, render: (r) => <Money v={r.invoices} /> }, { key: "ledger", title: "من الأستاذ", num: true, render: (r) => <Money v={r.ledger} /> },
            { key: "diff", title: "الفرق", num: true, render: (r) => <Money v={r.diff} strong /> }, { key: "ok", title: "الحالة", render: (r) => (r.ok ? <Badge tone="success">مطابق</Badge> : <Badge tone="danger">فرق</Badge>) }]} rows={d.checks} />
        </Panel>
        <ul className="space-y-1 text-t-xs text-text-dim">{d.checks.map((c) => <li key={c.key}><b className="text-text">{c.label}:</b> {c.note}</li>)}</ul>
        {d.fullReturnsInPeriod > 0 && <p className="text-t-xs text-text-dim">في الفترة {num(d.fullReturnsInPeriod)} فاتورة مرتجعة بالكامل، وقيودها العكسية قد تقع بتاريخ مختلف عن تاريخ الفاتورة وتفسّر جزءاً من أي فرق.</p>}
        <p className="text-t-xs text-text-dim">{d.note}</p>
      </>)}
    </div>
  );
}
