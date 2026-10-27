"use client";
// الأرصدة: شريط أوامر + مؤشرات + حالة المخزون + جدول مُصفّح من السيرفر + درج تفاصيل الصنف.
// قراءة وعرض فقط — الاستلام والتحويل والتسوية تمر عبر مسارات المخزون القائمة بصلاحياتها.
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { MIcon } from "@/components/m-icon";
import { Button, EmptyState, ErrorNote, Input, Select } from "@/components/ui";
import { KpiCard, KpiSkeleton } from "@/components/dashboard/KpiCard";
import { Skeleton } from "@/components/dashboard/Widget";
import { Thumb } from "@/components/products/parts";
import { appAlert } from "@/components/dialog";
import { downloadCsv } from "@/lib/customers/format";
import { kpisHTML, printReport, tableHTML } from "@/lib/print";
import {
  MOVE_TONE, STATUS_LABEL, type InvItem, type ItemStatus, type Loc, type Overview, type ProductInv,
} from "@/lib/inventory/types";
import { Panel, StatusPill, fmtD, fmtM, fmtN, qs, useDebounced, useFetch, type Period } from "./shared";

type ColKey = "product" | "sku" | "qty" | "wh" | "br" | "min" | "cost" | "value" | "last" | "sold" | "status";
type Density = "comfortable" | "compact" | "dense";
const COLS: { key: ColKey; label: string; sort?: string; cost?: boolean; def: boolean; num?: boolean }[] = [
  { key: "product", label: "الصنف", sort: "name", def: true },
  { key: "sku", label: "SKU / الباركود", def: true },
  { key: "qty", label: "الكمية", sort: "qty", def: true, num: true },
  { key: "wh", label: "المستودع", def: false, num: true },
  { key: "br", label: "الفروع", def: false, num: true },
  { key: "min", label: "الحد الأدنى", sort: "min", def: true, num: true },
  { key: "cost", label: "التكلفة", sort: "cost", cost: true, def: true, num: true },
  { key: "value", label: "القيمة", sort: "value", cost: true, def: true, num: true },
  { key: "last", label: "آخر حركة", sort: "last", def: false },
  { key: "sold", label: "مبيعات الفترة", sort: "sales", def: false, num: true },
  { key: "status", label: "الحالة", def: true },
];
const PAD: Record<Density, string> = { comfortable: "py-3", compact: "py-1.5", dense: "py-0.5" };
const CHIPS: { key: string; label: string; patch: { status?: string; movement?: string } }[] = [
  { key: "all", label: "الكل", patch: {} },
  { key: "ok", label: "متوفر", patch: { status: "ok" } },
  { key: "low", label: "منخفض", patch: { status: "low" } },
  { key: "out", label: "نافد", patch: { status: "out" } },
  { key: "dead", label: "راكد", patch: { status: "dead" } },
  { key: "fast", label: "سريع الحركة", patch: { movement: "fast" } },
  { key: "none", label: "بلا حركة", patch: { movement: "none" } },
];
const COL_KEY = "z8_inv_cols";

export function StockCenter({ loc, locs, onLoc, period, deadDays, canTransfer, canStocktake, onTransfer, onShowMoves }: {
  loc: string; locs: Loc[]; onLoc: (v: string) => void; period: Period; deadDays: number;
  canTransfer: boolean; canStocktake: boolean;
  onTransfer: (lines: { productId: string; productLabel: string; barcode: string | null }[], fromLoc?: string) => void;
  onShowMoves: (productId: string, label: string) => void;
}) {
  const [q, setQ] = useState("");
  const dq = useDebounced(q);
  const [chip, setChip] = useState("all");
  const [category, setCategory] = useState("");
  const [sort, setSort] = useState("name");
  const [dir, setDir] = useState<"asc" | "desc">("asc");
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(25);
  const [density, setDensity] = useState<Density>("comfortable");
  const [cols, setCols] = useState<Set<ColKey>>(new Set(COLS.filter((c) => c.def).map((c) => c.key)));
  const [colsOpen, setColsOpen] = useState(false);
  const [sel, setSel] = useState<Map<string, InvItem>>(new Map());
  const [drawer, setDrawer] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [cats, setCats] = useState<string[]>([]);

  useEffect(() => { try { const s = localStorage.getItem(COL_KEY); if (s) setCols(new Set(JSON.parse(s))); } catch { /* */ } }, []);
  useEffect(() => { api<string[]>("/products/cascade/categories").then(setCats).catch(() => undefined); }, []);
  useEffect(() => setPage(1), [dq, chip, category, loc, sort, dir, size, period.from, period.to, deadDays]);

  const patch = CHIPS.find((c) => c.key === chip)?.patch ?? {};
  const query = useMemo(() => qs({
    loc, q: dq, category, sort, dir, page, pageSize: size, from: period.from, to: period.to, deadDays, ...patch,
  }), [loc, dq, category, sort, dir, page, size, period.from, period.to, deadDays, patch]);
  const { data, loading, error, reload } = useFetch<Overview>(`/inventory/overview?${query}`);
  const ov = data;
  const canCost = ov?.canCost ?? true;
  const pages = ov ? Math.max(1, Math.ceil(ov.total / ov.pageSize)) : 1;
  const visibleCols = COLS.filter((c) => cols.has(c.key) && (!c.cost || canCost));

  function toggleCol(k: ColKey) {
    setCols((o) => { const n = new Set(o); if (n.has(k)) n.delete(k); else n.add(k); try { localStorage.setItem(COL_KEY, JSON.stringify([...n])); } catch { /* */ } return n; });
  }
  function toggleSort(s?: string) {
    if (!s) return;
    if (sort === s) setDir((d) => (d === "asc" ? "desc" : "asc")); else { setSort(s); setDir("asc"); }
  }
  function toggleSel(it: InvItem) { setSel((o) => { const n = new Map(o); if (n.has(it.id)) n.delete(it.id); else n.set(it.id, it); return n; }); }

  // تصدير/طباعة بنفس الفلاتر الحالية: نمرّ على صفحات السيرفر (حتى 3000 صنف)
  const fetchAll = useCallback(async () => {
    const out: InvItem[] = [];
    for (let p = 1; p <= 30; p++) {
      const r = await api<Overview>(`/inventory/overview?${qs({ loc, q: dq, category, sort, dir, page: p, pageSize: 100, from: period.from, to: period.to, deadDays, ...patch })}`);
      out.push(...r.items);
      if (out.length >= r.total) break;
    }
    return out;
  }, [loc, dq, category, sort, dir, period.from, period.to, deadDays, patch]);

  async function exportCsv(selectedOnly = false) {
    setExporting(true);
    try {
      const rows = selectedOnly ? [...sel.values()] : await fetchAll();
      downloadCsv(`inventory-${new Date().toISOString().slice(0, 10)}.csv`,
        ["الصنف", "SKU", "الباركود", "التصنيف", "الكمية", "المستودع", "الفروع", "الحد الأدنى", ...(canCost ? ["التكلفة", "القيمة"] : []), "آخر حركة", "الحالة"],
        rows.map((i) => [`${i.name}${i.spec ? ` — ${i.spec}` : ""}`, i.sku, i.barcode, i.category, i.stock, i.stockWarehouse, i.stockBranches, i.minQty, ...(canCost ? [i.cost, i.value] : []), i.lastMove ? fmtD(i.lastMove) : "", STATUS_LABEL[i.status]]));
    } catch (e) { await appAlert(e instanceof Error ? e.message : "تعذر التصدير"); } finally { setExporting(false); }
  }
  async function printList(selectedOnly = false) {
    setExporting(true);
    try {
      const rows = selectedOnly ? [...sel.values()] : await fetchAll();
      const body = kpisHTML([
        { label: "الموقع", value: ov?.scope.name ?? "—" }, { label: "عدد الأصناف", value: String(rows.length) },
        { label: "إجمالي الكمية", value: fmtN(rows.reduce((a, i) => a + i.stock, 0)) },
        ...(canCost ? [{ label: "القيمة", value: fmtM(rows.reduce((a, i) => a + (i.value ?? 0), 0)) }] : []),
      ]) + tableHTML(["الصنف", "الباركود", "الكمية", "الحد الأدنى", ...(canCost ? ["التكلفة", "القيمة"] : []), "الحالة"],
        rows.map((i) => [`${i.name}${i.spec ? ` — ${i.spec}` : ""}`, i.barcode || "—", i.stock, i.minQty || "—", ...(canCost ? [fmtM(i.cost), fmtM(i.value)] : []), STATUS_LABEL[i.status]]),
        { numericCols: [2, 3, ...(canCost ? [4, 5] : [])] });
      printReport("تقرير المخزون", `${ov?.scope.name ?? ""} · ${new Date().toLocaleDateString("en-GB")}`, body);
    } catch (e) { await appAlert(e instanceof Error ? e.message : "تعذرت الطباعة"); } finally { setExporting(false); }
  }

  const k = ov?.kpis;
  const h = ov?.health;
  const healthTotal = h ? Math.max(1, h.ok + h.low + h.out + h.dead) : 1;
  const locSel = locs.find((l) => l.value === loc);
  const HSEG: { key: ItemStatus; color: string }[] = [{ key: "ok", color: "bg-emerald" }, { key: "low", color: "bg-brass" }, { key: "out", color: "bg-ember" }, { key: "dead", color: "bg-text-dim/60" }];

  return (
    <div className="space-y-4">
      {/* شريط الأوامر */}
      <div className="sticky top-0 z-20 -mx-1 flex flex-wrap items-center gap-2 rounded-card border border-line bg-ink-2/95 p-2.5 shadow-card backdrop-blur">
        <Select value={loc} onChange={(e) => onLoc(e.target.value)} aria-label="الموقع" className="!w-auto min-w-[170px]" disabled={locs.length <= 1}>
          {locs.length > 1 && <option value="">كل المواقع</option>}
          {locs.map((l) => <option key={l.value} value={l.value}>{l.name}</option>)}
        </Select>
        <div className="relative min-w-[220px] flex-1">
          <MIcon name="search" className="pointer-events-none absolute top-1/2 -translate-y-1/2 text-text-dim rtl:right-3 ltr:left-3 !text-[18px]" />
          <Input className="rtl:!pr-9 ltr:!pl-9" value={q} onChange={(e) => setQ(e.target.value)} placeholder="بحث بالاسم / SKU / الباركود / التصنيف / المورد" aria-label="بحث في المخزون"
            onKeyDown={(e) => { if (e.key === "Enter" && ov && ov.items.length === 1) setDrawer(ov.items[0].id); }} />
        </div>
        {cats.length > 0 && (
          <Select value={category} onChange={(e) => setCategory(e.target.value)} aria-label="التصنيف" className="!w-auto max-w-[170px]">
            <option value="">كل التصنيفات</option>{cats.map((c) => <option key={c} value={c}>{c}</option>)}
          </Select>
        )}
        <div className="relative">
          <Button variant="tool" size="sm" onClick={() => setColsOpen((o) => !o)} aria-expanded={colsOpen}><MIcon name="view_column" className="!text-[16px]" />الأعمدة</Button>
          {colsOpen && (
            <div className="absolute z-30 mt-1 w-52 rounded-lg border border-line bg-ink-2 p-2 shadow-lg rtl:left-0 ltr:right-0">
              {COLS.filter((c) => !c.cost || canCost).map((c) => (
                <label key={c.key} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-t-sm hover:bg-ink-3">
                  <input type="checkbox" checked={cols.has(c.key)} disabled={c.key === "product"} onChange={() => toggleCol(c.key)} />{c.label}
                </label>
              ))}
              <div className="mt-1 border-t border-line pt-1">
                {(["comfortable", "compact", "dense"] as Density[]).map((d) => (
                  <button key={d} onClick={() => setDensity(d)} className={`block w-full rounded px-2 py-1 text-start text-t-xs ${density === d ? "font-black text-petrol" : "text-text-dim"}`}>{d === "comfortable" ? "عرض مريح" : d === "compact" ? "عرض مضغوط" : "عرض كثيف"}</button>
                ))}
              </div>
            </div>
          )}
        </div>
        <Button variant="tool" size="sm" onClick={() => exportCsv()} disabled={exporting || !ov?.total}><MIcon name="download" className="!text-[16px]" />تصدير</Button>
        <Button variant="tool" size="sm" onClick={() => printList()} disabled={exporting || !ov?.total}><MIcon name="print" className="!text-[16px]" />طباعة</Button>
        <Button variant="tool" size="sm" onClick={reload} aria-label="تحديث"><MIcon name="refresh" className={`!text-[16px] ${loading ? "animate-spin" : ""}`} /></Button>
      </div>

      {error && <div><ErrorNote msg={error} /><Button size="sm" variant="outline" onClick={reload}>إعادة المحاولة</Button></div>}

      {/* قفل الجرد */}
      {ov && ov.stocktakeLocks.length > 0 && (
        <div role="status" className="flex flex-wrap items-center gap-2 rounded-lg border border-brass/40 bg-brass-soft p-3 text-t-sm font-bold text-brass">
          <MIcon name="lock_clock" className="!text-[18px]" />
          جرد قائم: {ov.stocktakeLocks.map((s) => `${s.loc} (${s.status === "review" ? "قيد المراجعة" : "جاري"})`).join("، ")} — لا يُعتمد الجرد إن تغيّر رصيد صنف معدود أثناءه.
          {canStocktake && <Link href="/inventory/stocktake" className="underline">فتح الجرد</Link>}
        </div>
      )}

      {/* ملخص الموقع */}
      {locSel && <p className="text-t-sm text-text-dim"><b className="text-text">{locSel.name}</b> · {locSel.type === "warehouse" ? "مستودع" : "فرع"} — {k ? `${fmtN(k.skus)} صنف · ${fmtN(k.units)} وحدة${k.value != null ? ` · قيمة ${fmtM(k.value)}` : ""} · ${fmtN(k.low)} منخفض · ${fmtN(k.out)} نافد` : "…"}</p>}

      {/* المؤشرات */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 2xl:grid-cols-8">
        {loading && !k ? Array.from({ length: 8 }).map((_, i) => <KpiSkeleton key={i} />) : k && (<>
          <KpiCard label="أصناف بمخزون" icon="category" value={fmtN(k.skus)} sub={`من ${fmtN(k.catalog)} في الكتالوج`} />
          <KpiCard label="إجمالي الكمية" icon="inventory_2" value={fmtN(k.units)} />
          {k.value != null && <KpiCard label="قيمة المخزون" icon="payments" value={fmtM(k.value)} accent="var(--emerald)" tip="الكمية × تكلفة الصنف الحالية (نفس تعريف تقرير تقييم المخزون)" />}
          <KpiCard label="منخفض المخزون" icon="trending_down" value={fmtN(k.low)} accent="var(--brass)" subTone={k.low ? "warning" : "neutral"} sub={k.low ? "يحتاج إعادة طلب" : undefined} />
          <KpiCard label="نافد" icon="block" value={fmtN(k.out)} accent="var(--ember)" subTone={k.out ? "danger" : "neutral"} />
          <KpiCard label="أصناف بحركة اليوم" icon="bolt" value={fmtN(k.movedToday)} tip="أصناف تحركت اليوم (حركة مخزون أو بيع)" />
          <KpiCard label="الداخل (الفترة)" icon="south" value={fmtN(k.in)} accent="var(--emerald)" tip="استلام + تحويل وارد + تسوية جرد (زيادة)" />
          <KpiCard label="الخارج (الفترة)" icon="north" value={fmtN(k.out_qty)} accent="var(--ember)" sub={`الصافي ${k.net > 0 ? "+" : ""}${fmtN(k.net)}`} tip="بيع + تحويل صادر + تسوية جرد (عجز) — المرتجعات غير محسوبة" />
        </>)}
      </div>

      {/* حالة المخزون */}
      <Panel title="حالة المخزون" icon="monitor_heart">
        {!h ? <Skeleton className="w-full" height={44} /> : (
          <div>
            <div className="flex h-3 overflow-hidden rounded-full bg-ink-3" role="img" aria-label="توزيع حالة المخزون">
              {HSEG.map((s) => h[s.key] > 0 && <div key={s.key} className={s.color} style={{ width: `${(h[s.key] / healthTotal) * 100}%` }} title={`${STATUS_LABEL[s.key]}: ${h[s.key]}`} />)}
            </div>
            <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1">
              {HSEG.map((s) => (
                <button key={s.key} onClick={() => setChip(chip === s.key ? "all" : s.key)} className={`inline-flex items-center gap-1.5 text-t-sm font-bold ${chip === s.key ? "text-petrol" : "text-text-dim hover:text-text"}`}>
                  <i className={`h-2.5 w-2.5 rounded-full ${s.color}`} />{STATUS_LABEL[s.key]} <span className="tnum text-text">{fmtN(h[s.key])}</span>
                  <span className="tnum text-t-xs">({Math.round((h[s.key] / healthTotal) * 100)}%)</span>
                </button>
              ))}
            </div>
            <p className="mt-2 text-t-xs text-text-dim">«راكد»: رصيد موجود ولا بيع ولا حركة مخزون خلال {deadDays} يوماً. «فائض» غير معروض لأن النظام لا يحفظ حداً أقصى للمخزون.</p>
          </div>
        )}
      </Panel>

      {/* التصفية السريعة */}
      <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="تصفية الحالة">
        {CHIPS.map((c) => (
          <button key={c.key} aria-pressed={chip === c.key} onClick={() => setChip(c.key)}
            className={`rounded-full border px-3 py-1 text-t-xs font-bold ${chip === c.key ? "border-petrol bg-petrol text-white" : "border-line bg-ink-2 text-text-dim hover:border-petrol"}`}>{c.label}</button>
        ))}
        {sel.size > 0 && (
          <span className="ms-auto flex flex-wrap items-center gap-1.5 rounded-lg bg-petrol-soft px-2 py-1 text-t-xs font-bold text-petrol">
            محدد {sel.size}
            <Button size="xs" variant="outline" onClick={() => exportCsv(true)}>تصدير</Button>
            <Button size="xs" variant="outline" onClick={() => printList(true)}>طباعة</Button>
            {canTransfer && <Button size="xs" variant="outline" onClick={() => onTransfer([...sel.values()].map((i) => ({ productId: i.id, productLabel: i.name, barcode: i.barcode })))}>تحويل</Button>}
            <Button size="xs" variant="ghost" onClick={() => setSel(new Map())}>إلغاء التحديد</Button>
          </span>
        )}
      </div>

      {/* الجدول */}
      {loading && !ov ? <Skeleton className="w-full" height={320} /> : !ov || ov.items.length === 0 ? (
        <EmptyState icon="inventory_2" title="لا توجد بيانات مخزون مطابقة" description={locSel ? `لا توجد أصناف مطابقة في ${locSel.name}.` : "غيّر البحث أو التصفية أو الموقع."}
          action={loc ? <Button variant="outline" onClick={() => onLoc("")}>تغيير الموقع</Button> : undefined} />
      ) : (
        <>
          {/* جدول (تابلت/ديسكتوب) */}
          <div className="hidden overflow-x-auto rounded-card border border-line bg-ink-2 shadow-card md:block">
            <table className="w-full min-w-[760px] border-separate border-spacing-0 text-t-sm">
              <thead>
                <tr>
                  <th className="w-8 border-b border-line bg-ink-3 px-2 py-2"><input type="checkbox" aria-label="تحديد صفحة" checked={ov.items.every((i) => sel.has(i.id))} onChange={(e) => setSel((o) => { const n = new Map(o); ov.items.forEach((i) => (e.target.checked ? n.set(i.id, i) : n.delete(i.id))); return n; })} /></th>
                  {visibleCols.map((c) => (
                    <th key={c.key} scope="col" aria-sort={c.sort && sort === c.sort ? (dir === "asc" ? "ascending" : "descending") : undefined}
                      className={`whitespace-nowrap border-b border-line bg-ink-3 px-3 py-2 text-t-xs font-extrabold text-text-dim ${c.num ? "text-end" : "text-start"}`}>
                      {c.sort ? <button onClick={() => toggleSort(c.sort)} className="inline-flex items-center gap-0.5 hover:text-petrol">{c.label}{sort === c.sort && <MIcon name={dir === "asc" ? "arrow_upward" : "arrow_downward"} className="!text-[13px]" />}</button> : c.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {ov.items.map((it) => (
                  <tr key={it.id} onClick={() => setDrawer(it.id)} className="cursor-pointer hover:bg-ink-3/50">
                    <td className={`border-b border-line/60 px-2 ${PAD[density]}`} onClick={(e) => e.stopPropagation()}><input type="checkbox" aria-label={`تحديد ${it.name}`} checked={sel.has(it.id)} onChange={() => toggleSel(it)} /></td>
                    {visibleCols.map((c) => (
                      <td key={c.key} className={`border-b border-line/60 px-3 ${PAD[density]} ${c.num ? "tnum text-end" : ""}`}>{cell(c.key, it)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {/* بطاقات (جوال) */}
          <ul className="space-y-2 md:hidden">
            {ov.items.map((it) => (
              <li key={it.id}>
                <button onClick={() => setDrawer(it.id)} className="flex w-full items-center gap-3 rounded-card border border-line bg-ink-2 p-3 text-start shadow-card">
                  <Thumb id={it.id} has={it.hasImage} name={it.name} />
                  <span className="min-w-0 flex-1"><b className="block truncate text-t-sm">{it.name}{it.spec ? ` — ${it.spec}` : ""}</b>
                    <span className="text-t-xs text-text-dim" dir="ltr">{it.barcode || it.sku || ""}</span></span>
                  <span className="text-end"><b className="tnum block text-t-lg">{fmtN(it.stock)}</b><StatusPill s={it.status} /></span>
                </button>
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap items-center justify-between gap-2 text-t-sm">
            <span className="tnum text-text-dim">{(ov.page - 1) * ov.pageSize + 1}–{Math.min(ov.page * ov.pageSize, ov.total)} من {fmtN(ov.total)}</span>
            <span className="flex items-center gap-2">
              <Select value={String(size)} onChange={(e) => setSize(Number(e.target.value))} aria-label="عدد الصفوف" className="!w-auto"><option value="25">25</option><option value="50">50</option><option value="100">100</option></Select>
              <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage(page - 1)}>السابق</Button>
              <span className="tnum">{page} / {pages}</span>
              <Button size="sm" variant="outline" disabled={page >= pages} onClick={() => setPage(page + 1)}>التالي</Button>
            </span>
          </div>
        </>
      )}

      {drawer && <ProductDrawer id={drawer} canTransfer={canTransfer} onClose={() => setDrawer(null)} onTransfer={onTransfer} onShowMoves={(id, l) => { setDrawer(null); onShowMoves(id, l); }} />}
    </div>
  );

  function cell(key: ColKey, it: InvItem) {
    switch (key) {
      case "product": return (
        <div className="flex items-center gap-2.5">
          <Thumb id={it.id} has={it.hasImage} size={density === "dense" ? 24 : 36} name={it.name} />
          <span className="min-w-0"><b className="block max-w-[260px] truncate">{it.name}{it.spec ? ` — ${it.spec}` : ""}</b>
            {density !== "dense" && <span className="text-t-xs text-text-dim">{[it.category, it.brand].filter(Boolean).join(" · ")}</span>}</span>
        </div>);
      case "sku": return <span className="text-t-xs text-text-dim" dir="ltr">{it.sku && <>SKU: {it.sku}<br /></>}{it.barcode || "—"}</span>;
      case "qty": return <b className={it.status === "out" ? "text-ember" : it.status === "low" ? "text-brass" : ""}>{fmtN(it.stock)}{it.unit ? <small className="ms-1 font-normal text-text-dim">{it.unit}</small> : null}</b>;
      case "wh": return fmtN(it.stockWarehouse);
      case "br": return fmtN(it.stockBranches);
      case "min": return it.minQty ? fmtN(it.minQty) : <span className="text-text-dim">—</span>;
      case "cost": return fmtM(it.cost);
      case "value": return <b>{fmtM(it.value)}</b>;
      case "last": return <span className="text-t-xs text-text-dim">{it.lastMove ? fmtD(it.lastMove) : "—"}</span>;
      case "sold": return fmtN(it.soldPeriod);
      case "status": return <StatusPill s={it.status} />;
    }
  }
}

function ProductDrawer({ id, canTransfer, onClose, onTransfer, onShowMoves }: {
  id: string; canTransfer: boolean; onClose: () => void;
  onTransfer: (lines: { productId: string; productLabel: string; barcode: string | null }[], fromLoc?: string) => void;
  onShowMoves: (id: string, label: string) => void;
}) {
  const { data, loading, error, reload } = useFetch<ProductInv>(`/inventory/overview/product/${id}`);
  const [shelfErr, setShelfErr] = useState("");
  useEffect(() => { const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); }; window.addEventListener("keydown", h); return () => window.removeEventListener("keydown", h); }, [onClose]);

  async function saveShelf(s: ProductInv["stock"][number], value: string) {
    if (value === (s.shelf || "")) return;
    try {
      await api("/inventory/shelf-location", { method: "PUT", body: JSON.stringify({ locType: s.locType, locId: s.locId, productId: id, shelfLocation: value || null }) });
      setShelfErr(""); reload();
    } catch (e) { setShelfErr(e instanceof Error ? e.message : "تعذر حفظ موقع الرف"); }
  }
  const p = data?.product;
  const label = p ? `${p.name}${p.spec ? ` — ${p.spec}` : ""}` : "";
  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label="مخزون الصنف">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <aside className="absolute inset-y-0 w-full max-w-md overflow-y-auto border-line bg-ink-2 p-4 shadow-xl rtl:left-0 rtl:border-r ltr:right-0 ltr:border-l">
        <div className="mb-3 flex items-start justify-between gap-2">
          <h2 className="text-t-lg font-black">مخزون الصنف</h2>
          <button onClick={onClose} aria-label="إغلاق" className="grid h-8 w-8 place-items-center rounded-lg border border-line hover:border-petrol"><MIcon name="close" className="!text-[18px]" /></button>
        </div>
        {loading && !data ? <Skeleton className="w-full" height={240} /> : error ? <div><ErrorNote msg={error} /><Button size="sm" variant="outline" onClick={reload}>إعادة المحاولة</Button></div> : data && p && (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <Thumb id={p.id} has={p.hasImage} size={56} name={p.name} />
              <div className="min-w-0"><b className="block text-t-md">{label}</b>
                <span className="text-t-xs text-text-dim" dir="ltr">{[p.sku && `SKU: ${p.sku}`, p.barcode && `Barcode: ${p.barcode}`].filter(Boolean).join(" · ")}</span>
                <span className="block text-t-xs text-text-dim">{[p.category, p.brand, p.unit].filter(Boolean).join(" · ")}</span></div>
            </div>
            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="rounded-lg border border-line p-2"><p className="text-t-xs text-text-dim">الرصيد</p><p className="tnum text-t-xl font-black">{fmtN(data.total)}</p></div>
              <div className="rounded-lg border border-line p-2"><p className="text-t-xs text-text-dim">الحد الأدنى</p><p className="tnum text-t-xl font-black">{p.minQty || "—"}</p></div>
              <div className="rounded-lg border border-line p-2"><p className="text-t-xs text-text-dim">القيمة</p><p className="tnum text-t-md font-black">{data.value != null ? fmtM(data.value) : "—"}</p></div>
            </div>
            {data.canCost && <p className="text-t-xs text-text-dim">تكلفة الوحدة {fmtM(p.cost)} · سعر البيع (شامل الضريبة) {fmtM(p.price)}</p>}

            <section>
              <h3 className="mb-1.5 text-t-sm font-black">المخزون حسب المواقع</h3>
              {data.stock.length === 0 ? <p className="text-t-sm text-text-dim">لا يوجد رصيد مسجل لهذا الصنف.</p> : (
                <ul className="divide-y divide-line rounded-lg border border-line">
                  {data.stock.map((s) => (
                    <li key={s.value} className="flex flex-wrap items-center gap-2 p-2.5">
                      <span className="min-w-0 flex-1"><b className="block text-t-sm">{s.name}</b>
                        <input defaultValue={s.shelf || ""} placeholder="موقع الرف" aria-label={`موقع الرف في ${s.name}`} onBlur={(e) => saveShelf(s, e.target.value.trim())} className="mt-1 w-28 rounded-md border border-line bg-ink-2 px-1.5 py-0.5 text-t-xs" /></span>
                      <b className={`tnum text-t-lg ${s.qty <= 0 ? "text-ember" : s.low ? "text-brass" : ""}`}>{fmtN(s.qty)}</b>
                      {canTransfer && s.qty > 0 && <Button size="xs" variant="outline" onClick={() => onTransfer([{ productId: p.id, productLabel: label, barcode: p.barcode }], `${s.locType}:${s.locId}`)}>تحويل</Button>}
                    </li>
                  ))}
                </ul>
              )}
              {shelfErr && <ErrorNote msg={shelfErr} />}
            </section>

            <section className="grid grid-cols-2 gap-2 text-t-sm">
              <div className="rounded-lg border border-line p-2.5"><p className="text-t-xs text-text-dim">آخر بيع</p>
                {data.lastSale ? <Link href="/sales/history" className="font-bold text-petrol hover:underline">{data.lastSale.invoiceNo}</Link> : "—"}
                <p className="text-t-xs text-text-dim">{data.lastSale ? fmtD(data.lastSale.at) : ""}</p></div>
              <div className="rounded-lg border border-line p-2.5"><p className="text-t-xs text-text-dim">آخر استلام</p>
                <b>{data.lastReceive ? fmtD(data.lastReceive.at) : "—"}</b>
                <p className="text-t-xs text-text-dim">{data.lastReceive?.supplier || ""}{data.lastReceive?.unitCost != null ? ` · ${fmtM(data.lastReceive.unitCost)}` : ""}</p></div>
            </section>

            <section>
              <h3 className="mb-1.5 text-t-sm font-black">آخر الحركات</h3>
              {data.moves.length === 0 ? <p className="text-t-sm text-text-dim">لا حركات مخزون مسجلة.</p> : (
                <ul className="space-y-1.5">
                  {data.moves.map((m, i) => (
                    <li key={i} className="flex items-center gap-2 rounded-lg bg-ink-3/60 p-2 text-t-xs">
                      <span className={`rounded-full px-2 py-0.5 font-bold ${MOVE_TONE[m.type] || "bg-ink-3 text-text-dim"}`}>{m.typeLabel}</span>
                      <span className="tnum font-black">{fmtN(m.qty)}</span>
                      <span className="min-w-0 flex-1 truncate text-text-dim">{m.from} ← {m.to}</span>
                      <span className="text-text-dim">{fmtD(m.at)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <div className="flex flex-wrap gap-2 border-t border-line pt-3">
              <Link href={`/products/${p.id}`} className="m3 z8-anim-btn inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-t-sm font-semibold text-text-dim hover:border-petrol hover:text-petrol">فتح الصنف</Link>
              <Button size="sm" variant="outline" onClick={() => onShowMoves(p.id, label)}>حركة المخزون</Button>
              {canTransfer && <Button size="sm" variant="outline" onClick={() => onTransfer([{ productId: p.id, productLabel: label, barcode: p.barcode }])}>تحويل</Button>}
                          </div>
          </div>
        )}
      </aside>
    </div>
  );
}
