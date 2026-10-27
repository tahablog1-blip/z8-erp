"use client";
// منخفض / نافد / إعادة الطلب / راكد — قراءة فقط؛ إعادة الطلب تعتمد منطق /inventory/reorder-suggestions القائم (ضعف الحد الأدنى − الرصيد).
import { useState } from "react";
import Link from "next/link";
import { Button, EmptyState, ErrorNote, Tabs } from "@/components/ui";
import { Skeleton } from "@/components/dashboard/Widget";
import { MIcon } from "@/components/m-icon";
import { downloadCsv } from "@/lib/customers/format";
import { kpisHTML, printReport, tableHTML } from "@/lib/print";
import type { Overview } from "@/lib/inventory/types";
import { fmtD, fmtM, fmtN, qs, useFetch } from "./shared";

type LowRow = { locType: string; locId: string; locName: string; productId: string; name: string; barcode: string | null; qty: number; minQty: number; deficit: number; outOfStock: boolean };
type Reorder = { productId: string; name: string; barcode: string | null; onHand: number; minQty: number; suggestedQty: number; lastSupplier: string | null };

export function AlertsPanel({ loc, deadDays, canPurchase, canCost }: { loc: string; deadDays: number; canPurchase: boolean; canCost: boolean }) {
  const [tab, setTab] = useState<"low" | "out" | "reorder" | "dead">("low");
  const low = useFetch<LowRow[]>(tab === "low" ? "/inventory/low-stock-alerts" : null);
  const out = useFetch<Overview>(tab === "out" ? `/inventory/overview?${qs({ loc, status: "out", sort: "name", pageSize: 100 })}` : null);
  const reorder = useFetch<Reorder[]>(tab === "reorder" ? "/inventory/reorder-suggestions" : null);
  const dead = useFetch<Overview>(tab === "dead" ? `/inventory/overview?${qs({ loc, status: "dead", sort: "value", dir: "desc", pageSize: 100, deadDays })}` : null);

  const cur = tab === "low" ? low : tab === "out" ? out : tab === "reorder" ? reorder : dead;
  const lowRows = (low.data ?? []).filter((r) => !loc || (loc === "warehouse" ? r.locType === "warehouse" : r.locId === loc));

  function printCur() {
    if (tab === "low") printReport("تقرير منخفض المخزون", `${lowRows.length} رصيد`, tableHTML(["الصنف", "الموقع", "الحالي", "الحد الأدنى", "الفرق"], lowRows.map((r) => [r.name, r.locName, r.qty, r.minQty, r.deficit]), { numericCols: [2, 3, 4] }));
    else if (tab === "reorder" && reorder.data) printReport("إعادة الطلب", `${reorder.data.length} صنف`, tableHTML(["الصنف", "الرصيد", "نقطة إعادة الطلب", "الكمية المقترحة", "آخر مورد"], reorder.data.map((r) => [r.name, r.onHand, r.minQty, r.suggestedQty, r.lastSupplier || "—"]), { numericCols: [1, 2, 3] }));
    else if (tab === "out" && out.data) printReport("الأصناف النافدة", `${out.data.total} صنف`, tableHTML(["الصنف", "الباركود", "آخر بيع", "آخر حركة"], out.data.items.map((i) => [i.name, i.barcode || "—", fmtD(i.lastSale), fmtD(i.lastMove)])));
    else if (tab === "dead" && dead.data) printReport("المخزون الراكد", `لا حركة منذ ${deadDays} يوماً`, kpisHTML([{ label: "عدد الأصناف", value: String(dead.data.total) }]) + tableHTML(["الصنف", "الكمية", ...(canCost ? ["القيمة"] : []), "آخر حركة"], dead.data.items.map((i) => [i.name, i.stock, ...(canCost ? [fmtM(i.value)] : []), fmtD(i.lastMove)]), { numericCols: [1, 2] }));
  }
  function exportCur() {
    if (tab === "low") downloadCsv("low-stock.csv", ["الصنف", "الموقع", "الحالي", "الحد الأدنى", "الفرق"], lowRows.map((r) => [r.name, r.locName, r.qty, r.minQty, r.deficit]));
    else if (tab === "reorder" && reorder.data) downloadCsv("reorder.csv", ["الصنف", "الرصيد", "نقطة إعادة الطلب", "الكمية المقترحة", "آخر مورد"], reorder.data.map((r) => [r.name, r.onHand, r.minQty, r.suggestedQty, r.lastSupplier]));
    else if (tab === "out" && out.data) downloadCsv("out-of-stock.csv", ["الصنف", "الباركود", "آخر بيع", "آخر حركة"], out.data.items.map((i) => [i.name, i.barcode, i.lastSale, i.lastMove]));
    else if (tab === "dead" && dead.data) downloadCsv("dead-stock.csv", ["الصنف", "الكمية", "القيمة", "آخر حركة"], dead.data.items.map((i) => [i.name, i.stock, i.value, i.lastMove]));
  }

  return (
    <div className="space-y-3">
      <Tabs value={tab} onChange={setTab} items={[{ key: "low", label: "منخفض المخزون" }, { key: "out", label: "نافد" }, { key: "reorder", label: "إعادة الطلب" }, { key: "dead", label: `راكد (${deadDays} يوماً)` }]} />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-t-xs text-text-dim">
          {tab === "low" && "رصيد كل موقع على حدة مقابل حد الانخفاض المسجل للصنف."}
          {tab === "out" && "أصناف نشطة رصيدها صفر في النطاق المختار."}
          {tab === "reorder" && "الاقتراح = ضعف الحد الأدنى − الرصيد الحالي (منطق النظام القائم، على إجمالي المواقع)."}
          {tab === "dead" && `رصيد موجود ولا بيع ولا حركة مخزون منذ ${deadDays} يوماً — مرتب بالأعلى قيمة.`}
        </p>
        <span className="flex gap-2">
          {canPurchase && (tab === "reorder" || tab === "low") && <Link href="/purchases" className="m3 z8-anim-btn inline-flex items-center gap-1.5 rounded-lg bg-petrol px-3 py-1.5 text-t-sm font-semibold text-white">طلب توريد</Link>}
          <Button variant="tool" size="sm" onClick={exportCur}><MIcon name="download" className="!text-[16px]" />تصدير</Button>
          <Button variant="tool" size="sm" onClick={printCur}><MIcon name="print" className="!text-[16px]" />طباعة</Button>
        </span>
      </div>
      {cur.error && <div><ErrorNote msg={cur.error} /><Button size="sm" variant="outline" onClick={cur.reload}>إعادة المحاولة</Button></div>}
      {cur.loading && !cur.data ? <Skeleton className="w-full" height={220} /> : (
        <div className="overflow-x-auto rounded-card border border-line bg-ink-2 shadow-card">
          {tab === "low" && (lowRows.length === 0 ? <EmptyState icon="task_alt" title="لا أرصدة منخفضة" description="كل الأرصدة فوق حد الانخفاض." /> : (
            <table className="w-full min-w-[620px] text-t-sm"><thead className="bg-ink-3 text-t-xs text-text-dim"><tr>{["الصنف", "الموقع", "الحالي", "الحد الأدنى", "الفرق", "الحالة"].map((h) => <th key={h} className="p-2.5 text-start font-bold">{h}</th>)}</tr></thead>
              <tbody>{lowRows.map((r) => (
                <tr key={`${r.locType}${r.locId}${r.productId}`} className="border-t border-line"><td className="p-2.5 font-bold">{r.name}</td><td className="p-2.5 text-t-xs">{r.locName}</td>
                  <td className={`tnum p-2.5 font-black ${r.outOfStock ? "text-ember" : "text-brass"}`}>{fmtN(r.qty)}</td><td className="tnum p-2.5">{fmtN(r.minQty)}</td><td className="tnum p-2.5">{fmtN(r.deficit)}</td>
                  <td className="p-2.5"><span className={`rounded-full px-2 py-0.5 text-t-xs font-bold ${r.outOfStock ? "bg-ember-bg text-ember" : "bg-brass-bg text-brass"}`}>{r.outOfStock ? "نافد" : "منخفض"}</span></td></tr>))}</tbody></table>))}
          {tab === "out" && (!out.data || out.data.items.length === 0 ? <EmptyState icon="task_alt" title="لا أصناف نافدة" /> : (
            <table className="w-full min-w-[520px] text-t-sm"><thead className="bg-ink-3 text-t-xs text-text-dim"><tr>{["الصنف", "الباركود", "آخر بيع", "آخر حركة", "الحد الأدنى"].map((h) => <th key={h} className="p-2.5 text-start font-bold">{h}</th>)}</tr></thead>
              <tbody>{out.data.items.map((i) => <tr key={i.id} className="border-t border-line"><td className="p-2.5 font-bold">{i.name}</td><td className="p-2.5 text-t-xs" dir="ltr">{i.barcode || "—"}</td><td className="p-2.5 text-t-xs">{fmtD(i.lastSale)}</td><td className="p-2.5 text-t-xs">{fmtD(i.lastMove)}</td><td className="tnum p-2.5">{i.minQty || "—"}</td></tr>)}</tbody></table>))}
          {tab === "reorder" && (!reorder.data || reorder.data.length === 0 ? <EmptyState icon="task_alt" title="لا أصناف وصلت نقطة إعادة الطلب" /> : (
            <table className="w-full min-w-[560px] text-t-sm"><thead className="bg-ink-3 text-t-xs text-text-dim"><tr>{["الصنف", "المخزون الحالي", "نقطة إعادة الطلب", "الكمية المقترحة", "آخر مورد"].map((h) => <th key={h} className="p-2.5 text-start font-bold">{h}</th>)}</tr></thead>
              <tbody>{reorder.data.map((r) => <tr key={r.productId} className="border-t border-line"><td className="p-2.5 font-bold">{r.name}</td><td className="tnum p-2.5 font-black text-ember">{fmtN(r.onHand)}</td><td className="tnum p-2.5">{fmtN(r.minQty)}</td><td className="tnum p-2.5 font-black text-emerald">+{fmtN(r.suggestedQty)}</td><td className="p-2.5 text-t-xs">{r.lastSupplier || "—"}</td></tr>)}</tbody></table>))}
          {tab === "dead" && (!dead.data || dead.data.items.length === 0 ? <EmptyState icon="task_alt" title="لا مخزون راكد" description={`كل الأصناف ذات الرصيد تحركت خلال ${deadDays} يوماً.`} /> : (
            <table className="w-full min-w-[520px] text-t-sm"><thead className="bg-ink-3 text-t-xs text-text-dim"><tr>{["الصنف", "الكمية", ...(canCost ? ["القيمة"] : []), "آخر حركة"].map((h) => <th key={h} className="p-2.5 text-start font-bold">{h}</th>)}</tr></thead>
              <tbody>{dead.data.items.map((i) => <tr key={i.id} className="border-t border-line"><td className="p-2.5 font-bold">{i.name}</td><td className="tnum p-2.5">{fmtN(i.stock)}</td>{canCost && <td className="tnum p-2.5 font-bold">{fmtM(i.value)}</td>}<td className="p-2.5 text-t-xs">{i.lastMove ? fmtD(i.lastMove) : "لا حركة مسجلة"}</td></tr>)}</tbody></table>))}
        </div>
      )}
    </div>
  );
}
