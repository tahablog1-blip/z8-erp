"use client";
// سجل حركات المخزون (stock_moves) — فلترة وترقيم من السيرفر. لا رصيد بعد الحركة لأن النظام لا يحفظه.
import { useEffect, useState } from "react";
import { MIcon } from "@/components/m-icon";
import { Button, EmptyState, ErrorNote, Input, Modal, Select } from "@/components/ui";
import { Skeleton } from "@/components/dashboard/Widget";
import { api } from "@/lib/api";
import { downloadCsv } from "@/lib/customers/format";
import { MOVE_TONE, type Movement, type MovementsRes } from "@/lib/inventory/types";
import { fmtDT, fmtM, fmtN, qs, useDebounced, useFetch, type Period } from "./shared";

export function MovementsPanel({ loc, period, product, onClearProduct, canCost }: {
  loc: string; period: Period; product: { id: string; label: string } | null; onClearProduct: () => void; canCost: boolean;
}) {
  const [type, setType] = useState("");
  const [q, setQ] = useState("");
  const dq = useDebounced(q);
  const [page, setPage] = useState(1);
  const [detail, setDetail] = useState<Movement | null>(null);
  useEffect(() => setPage(1), [type, dq, loc, period.from, period.to, product?.id]);
  const { data, loading, error, reload } = useFetch<MovementsRes>(`/inventory/movements?${qs({ loc, type, q: dq, product: product?.id, from: period.from, to: period.to, page, pageSize: 25 })}`);
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  async function exportCsv() {
    const rows: Movement[] = [];
    for (let p = 1; p <= 30; p++) {
      const r = await api<MovementsRes>(`/inventory/movements?${qs({ loc, type, q: dq, product: product?.id, from: period.from, to: period.to, page: p, pageSize: 100 })}`);
      rows.push(...r.items); if (rows.length >= r.total) break;
    }
    downloadCsv("stock-movements.csv", ["التاريخ", "النوع", "الصنف", "الكمية", "من", "إلى", "المستند", "المستخدم", "ملاحظة"],
      rows.map((m) => [fmtDT(m.at), m.typeLabel, m.label, m.qty, m.from, m.to, m.moveNo, m.user, m.note]));
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Select value={type} onChange={(e) => setType(e.target.value)} aria-label="نوع الحركة" className="!w-auto"><option value="">كل الأنواع</option><option value="receive">استلام</option><option value="transfer">تحويل</option><option value="adjust">تسوية جرد</option></Select>
        <div className="relative min-w-[200px] flex-1"><MIcon name="search" className="pointer-events-none absolute top-1/2 -translate-y-1/2 text-text-dim rtl:right-3 ltr:left-3 !text-[18px]" />
          <Input className="rtl:!pr-9 ltr:!pl-9" value={q} onChange={(e) => setQ(e.target.value)} placeholder="بحث بالصنف / المستند / المورد / الملاحظة" aria-label="بحث في الحركات" /></div>
        <Button variant="tool" size="sm" onClick={exportCsv} disabled={!data?.total}><MIcon name="download" className="!text-[16px]" />تصدير</Button>
      </div>
      {product && <p className="flex items-center gap-2 rounded-lg bg-petrol-soft p-2 text-t-sm font-bold text-petrol">حركات الصنف: {product.label}<button onClick={onClearProduct} className="underline">إزالة التصفية</button></p>}
      <p className="text-t-xs text-text-dim">يعرض حركات الاستلام والتحويل وتسويات الجرد. المبيعات تُعرض في ملف الصنف وسجل الفواتير. الفترة: {period.from} → {period.to}.</p>
      {error && <div><ErrorNote msg={error} /><Button size="sm" variant="outline" onClick={reload}>إعادة المحاولة</Button></div>}
      {loading && !data ? <Skeleton className="w-full" height={260} /> : !data || data.items.length === 0 ? <EmptyState icon="swap_vert" title="لا توجد حركات في هذه الفترة" description="غيّر الفترة أو الموقع أو النوع." /> : (
        <>
          <div className="overflow-x-auto rounded-card border border-line bg-ink-2 shadow-card">
            <table className="w-full min-w-[760px] text-t-sm">
              <thead className="bg-ink-3 text-t-xs text-text-dim"><tr>{["التاريخ", "الصنف", "النوع", "الكمية", "من", "إلى", "المستند", "المستخدم"].map((h) => <th key={h} className="p-2.5 text-start font-bold">{h}</th>)}</tr></thead>
              <tbody>{data.items.map((m) => (
                <tr key={m.id} onClick={() => setDetail(m)} className="cursor-pointer border-t border-line hover:bg-ink-3/50">
                  <td className="p-2.5 text-t-xs text-text-dim">{fmtDT(m.at)}</td>
                  <td className="p-2.5 font-bold">{m.label}</td>
                  <td className="p-2.5"><span className={`rounded-none px-2 py-0.5 text-t-xs font-bold ${MOVE_TONE[m.type] || "bg-ink-3"}`}>{m.typeLabel}</span></td>
                  <td className="tnum p-2.5 font-black">{fmtN(m.qty)}</td>
                  <td className="p-2.5 text-t-xs">{m.from}</td><td className="p-2.5 text-t-xs">{m.to}</td>
                  <td className="tnum p-2.5 text-t-xs">{m.moveNo || "—"}</td><td className="p-2.5 text-t-xs">{m.user || "—"}</td>
                </tr>))}</tbody>
            </table>
          </div>
          <div className="flex items-center justify-between text-t-sm"><span className="tnum text-text-dim">{fmtN(data.total)} حركة</span>
            <span className="flex items-center gap-2"><Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage(page - 1)}>السابق</Button><span className="tnum">{page} / {pages}</span><Button size="sm" variant="outline" disabled={page >= pages} onClick={() => setPage(page + 1)}>التالي</Button></span></div>
        </>
      )}
      <Modal open={!!detail} title="تفاصيل حركة المخزون" onClose={() => setDetail(null)}>
        {detail && (
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-t-sm">
            {([["المرجع", detail.moveNo], ["التاريخ", fmtDT(detail.at)], ["الصنف", detail.label], ["النوع", detail.typeLabel], ["الكمية", fmtN(detail.qty)], ["المصدر", detail.from], ["الوجهة", detail.to],
              ["المورد", detail.supplier], ...(canCost && detail.unitCost != null ? [["تكلفة الوحدة", fmtM(detail.unitCost)]] : []), ["المستخدم", detail.user], ["ملاحظات", detail.note]] as [string, string | null][])
              .map(([k, v]) => <div key={k} className="contents"><dt className="font-bold text-text-dim">{k}</dt><dd>{v || "—"}</dd></div>)}
          </dl>
        )}
      </Modal>
    </div>
  );
}
