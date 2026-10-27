"use client";
// حالة الفواتير الضريبية — ما هو مسجّل في الفواتير (حالة + QR). ليس اعتماداً ولا امتثالاً من الهيئة.
import Link from "next/link";
import { Badge } from "@/components/ui";
import { Panel } from "@/components/hr/shared";
import { pdfParams, Kpi, ReportError, ReportFilters, ReportHeader, ReportSkeleton, ReportTable, ReportToolbar, Money, dateAr, num, useFilters, useReport } from "@/components/reports/ReportShell";

type R = { meta: { from: string; to: string; branchId: string | null; branchLocked: boolean; generatedAt: string };
           totals: { invoices: number; withQr: number; withoutQr: number }; byStatus: { status: string; n: number }[];
           missingQr: { id: string; invoiceNo: string; issuedAt: string; total: number; status: string }[]; note: string };

export default function ZatcaStatusReport() {
  const [f, setF] = useFilters();
  const { data: d, loading, error, reload } = useReport<R>("/reports/zatca-status", f);
  return (
    <div className="space-y-4">
      <ReportHeader title="حالة الفواتير الضريبية" description="الفواتير حسب الحالة المسجّلة ووجود رمز QR." meta={d?.meta}
        actions={<ReportToolbar onRefresh={reload} pdf={{ id: "zatca-status", params: pdfParams(f) }} csv={d && { file: "invoice-status.csv", headers: ["رقم الفاتورة", "التاريخ", "الإجمالي", "الحالة"], rows: d.missingQr.map((r) => [r.invoiceNo, r.issuedAt, r.total, r.status]) }} />} />
      <ReportFilters value={f} onChange={setF} lockedBranch={d?.meta.branchLocked} />
      {error ? <ReportError msg={error} onRetry={reload} /> : loading || !d ? <ReportSkeleton /> : (<>
        <div className="rounded-lg border border-brass/30 bg-brass-bg px-4 py-2.5 text-t-sm font-bold text-brass">{d.note}</div>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
          <Kpi label="الفواتير" value={num(d.totals.invoices)} /><Kpi label="رمز QR موجود" value={num(d.totals.withQr)} tone="success" />
          <Kpi label="رمز QR غير موجود" value={num(d.totals.withoutQr)} tone={d.totals.withoutQr ? "danger" : "neutral"} />
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          <Panel title="حسب الحالة المسجّلة" icon="list_alt"><ReportTable cols={[{ key: "status", title: "الحالة" }, { key: "n", title: "الفواتير", num: true }]} rows={d.byStatus} /></Panel>
          <Panel title="فواتير بلا رمز QR (آخر 50)" icon="warning">
            <ReportTable cols={[{ key: "invoiceNo", title: "الفاتورة", render: (r) => <Link className="font-bold text-petrol hover:underline" href={`/sales/history?invoiceNo=${encodeURIComponent(r.invoiceNo)}`}>{r.invoiceNo}</Link> },
              { key: "issuedAt", title: "التاريخ", render: (r) => dateAr(r.issuedAt) }, { key: "total", title: "الإجمالي", num: true, render: (r) => <Money v={r.total} /> }, { key: "status", title: "الحالة", render: (r) => <Badge tone="warning">{r.status}</Badge> }]} rows={d.missingQr} empty={false} />
            {!d.missingQr.length && <p className="text-t-sm text-text-dim">كل فواتير الفترة لها رمز QR.</p>}
          </Panel>
        </div>
      </>)}
    </div>
  );
}
