"use client";
// الأصناف — مركز قيادة الأصناف: مؤشرات + بحث/فلاتر/فرز/ترقيم من السيرفر + جدول احترافي (بطاقات على الجوال).
// قراءة وعرض فقط؛ التعديلات تمر عبر مسارات الأصناف/المخزون القائمة. التكلفة والمبيعات تُحجب عمّن لا يملك الصلاحية.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { printReport, tableHTML, kpisHTML } from "@/lib/print";
import { MIcon } from "@/components/m-icon";
import { Button, EmptyState, Input, PageHeader, Badge } from "@/components/ui";
import { appAlert, appConfirm } from "@/components/dialog";
import { GlobalFilters, type FilterState } from "@/components/dashboard/GlobalFilters";
import { KpiCard, KpiSkeleton } from "@/components/dashboard/KpiCard";
import { Skeleton } from "@/components/dashboard/Widget";
import { ComboSelect } from "@/components/ComboSelect";
import { ProductForm } from "@/components/products/ProductForm";
import { ProductFilters } from "@/components/products/ProductFilters";
import { BarcodeLabels, type LabelItem } from "@/components/products/BarcodeLabels";
import { StockBadge, StockCell, Thumb, TypeChips } from "@/components/products/parts";
import { PERIODS, rangeFor, type PeriodKey } from "@/lib/dashboard/periods";
import { ago, downloadCsv, fmtCurrency, fmtMoney } from "@/lib/customers/format";
import { EMPTY_PFILTERS, type PFilters, type ProductRow, type ProductsOverview } from "@/lib/products/types";
import { Modal } from "@/components/ui";

type ColKey = "product" | "sku" | "barcode" | "category" | "price" | "cost" | "stock" | "profit" | "sales" | "last" | "status";
type SortKey = "name" | "category" | "price" | "cost" | "stock" | "sales" | "margin" | "created";
type Density = "comfortable" | "compact" | "dense";
const COLS: { key: ColKey; label: string; sort?: SortKey; cost?: boolean; sales?: boolean; def: boolean; num?: boolean }[] = [
  { key: "product", label: "الصنف", sort: "name", def: true },
  { key: "sku", label: "SKU", def: true },
  { key: "barcode", label: "الباركود", def: true },
  { key: "category", label: "التصنيف", sort: "category", def: true },
  { key: "price", label: "سعر البيع", sort: "price", def: true, num: true },
  { key: "cost", label: "التكلفة", sort: "cost", cost: true, def: true, num: true },
  { key: "stock", label: "المخزون", sort: "stock", def: true, num: true },
  { key: "profit", label: "الربح / الهامش", sort: "margin", cost: true, def: true, num: true },
  { key: "sales", label: "مبيعات الفترة", sort: "sales", sales: true, def: false, num: true },
  { key: "last", label: "آخر بيع", def: false },
  { key: "status", label: "الحالة", def: true },
];
const PAD: Record<Density, string> = { comfortable: "py-3", compact: "py-1.5", dense: "py-0.5" };
const QUICK: { key: string; label: string; icon: string; patch: Partial<PFilters> }[] = [
  { key: "all", label: "الكل", icon: "list", patch: {} },
  { key: "low", label: "منخفض المخزون", icon: "trending_down", patch: { stock: "low" } },
  { key: "out", label: "نافد", icon: "block", patch: { stock: "out" } },
  { key: "fast", label: "سريع الحركة", icon: "bolt", patch: { movement: "fast" } },
  { key: "dead", label: "راكد", icon: "hourglass_empty", patch: { movement: "dead" } },
];
const cache = new Map<string, { at: number; data: ProductsOverview }>();

function fromUrl() {
  const base = { q: "", page: 1, sort: "name" as SortKey, dir: "asc" as "asc" | "desc", filters: EMPTY_PFILTERS, period: { period: "month", ...rangeFor("month"), branchId: null } as FilterState };
  if (typeof window === "undefined") return base;
  const sp = new URLSearchParams(window.location.search);
  try { const f = sp.get("f"); if (f) base.filters = { ...EMPTY_PFILTERS, ...JSON.parse(f) }; } catch { /* */ }
  base.q = sp.get("q") ?? ""; base.page = Math.max(1, Number(sp.get("page")) || 1);
  const s = sp.get("sort") as SortKey | null; if (s && COLS.some((c) => c.sort === s)) base.sort = s;
  if (sp.get("dir") === "desc") base.dir = "desc";
  const p = sp.get("p") as PeriodKey | null;
  if (p === "custom" && sp.get("from") && sp.get("to")) base.period = { period: "custom", from: sp.get("from")!, to: sp.get("to")!, branchId: null };
  else if (p && PERIODS.some((x) => x.key === p)) base.period = { period: p, ...rangeFor(p as Exclude<PeriodKey, "custom">), branchId: null };
  return base;
}

function buildQs(o: { q: string; page: number; size: number; sort: SortKey; dir: string; f: PFilters; from: string; to: string }) {
  const sp = new URLSearchParams({ page: String(o.page), pageSize: String(o.size), sort: o.sort, dir: o.dir, from: o.from, to: o.to });
  if (o.q.trim()) sp.set("q", o.q.trim());
  (Object.keys(o.f) as (keyof PFilters)[]).forEach((k) => { const v = o.f[k]; if (v && !(k === "status" && v === "active")) sp.set(k, String(v)); });
  return sp.toString();
}

export default function ProductsPage() {
  const { hasPerm } = useAuth();
  const router = useRouter();
  const canCreate = hasPerm("products.create");
  const canEdit = hasPerm("products.edit");
  const canDelete = hasPerm("products.delete");
  const canStock = hasPerm("inventory.stocktake", "products.view_stock");
  const canPurchase = hasPerm("purchasing.invoices");
  const canSell = hasPerm("invoices.create", "invoices.create_direct");

  const init = useRef(fromUrl()).current;
  const [period, setPeriod] = useState<FilterState>(init.period);
  const [qInput, setQInput] = useState(init.q); const [q, setQ] = useState(init.q);
  const [filters, setFilters] = useState<PFilters>(init.filters);
  const [sort, setSort] = useState<SortKey>(init.sort); const [dir, setDir] = useState<"asc" | "desc">(init.dir);
  const [page, setPage] = useState(init.page); const [size, setSize] = useState(25);
  const [data, setData] = useState<ProductsOverview | null>(null);
  const [loading, setLoading] = useState(true); const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(""); const [updated, setUpdated] = useState<Date | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [form, setForm] = useState<null | { product: Parameters<typeof ProductForm>[0]["product"] }>(null);
  const [labels, setLabels] = useState<LabelItem[] | null>(null);
  const [selected, setSelected] = useState<Map<string, ProductRow>>(new Map());
  const [density, setDensity] = useState<Density>("comfortable");
  const [cols, setCols] = useState<ColKey[]>(COLS.filter((x) => x.def).map((x) => x.key));
  const [menu, setMenu] = useState<"" | "cols" | "export" | "bulk" | `row:${string}`>("");
  const [busy, setBusy] = useState(false);
  const [catModal, setCatModal] = useState(false); const [bulkCat, setBulkCat] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    try {
      const sv = JSON.parse(localStorage.getItem("z8_px_cols") || "null"); if (Array.isArray(sv) && sv.length) setCols(sv);
      const d = localStorage.getItem("z8_px_density") as Density | null; if (d && PAD[d]) setDensity(d);
    } catch { /* */ }
  }, []);
  useEffect(() => { try { localStorage.setItem("z8_px_cols", JSON.stringify(cols)); localStorage.setItem("z8_px_density", density); } catch { /* */ } }, [cols, density]);
  // اختصار "/" للتركيز على البحث (Ctrl+K للبحث الشامل في كل النظام)
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "/" && !/INPUT|TEXTAREA|SELECT/.test((e.target as HTMLElement).tagName)) { e.preventDefault(); searchRef.current?.focus(); } };
    window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k);
  }, []);
  useEffect(() => { const t = setTimeout(() => setQ((p) => { if (p !== qInput) setPage(1); return qInput; }), 300); return () => clearTimeout(t); }, [qInput]);

  const qs = useMemo(() => buildQs({ q, page, size, sort, dir, f: filters, from: period.from, to: period.to }), [q, page, size, sort, dir, filters, period.from, period.to]);
  const ctl = useRef<AbortController | null>(null);
  const load = useCallback(async (silent = false) => {
    ctl.current?.abort(); const ac = new AbortController(); ctl.current = ac;
    const hit = cache.get(qs);
    if (hit && !silent) { setData(hit.data); setLoading(false); } else if (!hit) setLoading(true);
    setRefreshing(true); setError("");
    try {
      const d = await api<ProductsOverview>(`/products/overview?${qs}`, { signal: ac.signal });
      cache.set(qs, { at: Date.now(), data: d }); setData(d); setUpdated(new Date());
    } catch (e) { if ((e as Error).name === "AbortError") return; setError(e instanceof Error ? e.message : String(e)); }
    finally { if (ctl.current === ac) { setLoading(false); setRefreshing(false); } }
  }, [qs]);
  useEffect(() => { load(); return () => ctl.current?.abort(); }, [load]);

  useEffect(() => {
    const sp = new URLSearchParams();
    if (q.trim()) sp.set("q", q.trim()); if (page > 1) sp.set("page", String(page));
    if (sort !== "name" || dir !== "asc") { sp.set("sort", sort); sp.set("dir", dir); }
    const diff = Object.fromEntries(Object.entries(filters).filter(([k, v]) => v !== (EMPTY_PFILTERS as Record<string, unknown>)[k]));
    if (Object.keys(diff).length) sp.set("f", JSON.stringify(diff));
    sp.set("p", period.period); if (period.period === "custom") { sp.set("from", period.from); sp.set("to", period.to); }
    window.history.replaceState(null, "", `?${sp}`);
  }, [q, page, sort, dir, filters, period]);

  const canCost = data?.canCost ?? true, canSales = data?.canSales ?? true;
  const visibleCols = COLS.filter((x) => cols.includes(x.key) && (!x.cost || canCost) && (!x.sales || canSales));
  const rows = data?.items ?? [];
  const pages = Math.max(1, Math.ceil((data?.total ?? 0) / size));
  const activeCount = Object.entries(filters).filter(([k, v]) => v !== (EMPTY_PFILTERS as Record<string, unknown>)[k]).length;
  const filtered = activeCount > 0 || q.trim() !== "";
  const k = data?.kpis;
  const quickKey = QUICK.find((x) => x.key !== "all" && Object.entries(x.patch).every(([a, b]) => (filters as Record<string, unknown>)[a] === b))?.key ?? (activeCount === 0 ? "all" : "");
  const categories = data?.facets.categories.map((c) => c.name).filter((n) => n !== "غير مصنّف") ?? [];

  function toggleSort(s: SortKey) { if (sort === s) setDir(dir === "asc" ? "desc" : "asc"); else { setSort(s); setDir(s === "name" || s === "category" ? "asc" : "desc"); } setPage(1); }
  function clearAll() { setFilters(EMPTY_PFILTERS); setQInput(""); setQ(""); setPage(1); }
  const toggleRow = (r: ProductRow) => setSelected((p) => { const n = new Map(p); if (n.has(r.id)) n.delete(r.id); else n.set(r.id, r); return n; });
  const allOnPage = rows.length > 0 && rows.every((r) => selected.has(r.id));
  const toggleAll = () => setSelected((p) => { const n = new Map(p); if (allOnPage) rows.forEach((r) => n.delete(r.id)); else rows.forEach((r) => n.set(r.id, r)); return n; });

  const exportHeaders = ["الصنف", "المواصفة", "SKU", "الباركود", "التصنيف", "سعر البيع (قبل الضريبة)", "سعر البيع (شامل الضريبة)", ...(canCost ? ["التكلفة", "الهامش %", "قيمة المخزون"] : []), "المخزون", "الحالة"];
  const exportRow = (r: ProductRow) => [r.name, r.spec, r.sku, r.barcode, r.category, r.price, r.priceVat, ...(canCost ? [r.cost, r.margin, r.stockValue] : []), r.stock, r.isActive ? (r.stockStatus === "out" ? "نافد" : r.stockStatus === "low" ? "منخفض" : "نشط") : "غير نشط"];
  async function fetchAll(): Promise<ProductRow[]> {
    const out: ProductRow[] = [];
    for (let p = 1; p <= 50; p++) {
      const d = await api<ProductsOverview>(`/products/overview?${buildQs({ q, page: p, size: 100, sort, dir, f: filters, from: period.from, to: period.to })}`);
      out.push(...d.items); if (out.length >= d.total || !d.items.length) break;
    }
    return out;
  }
  async function doExport(kind: "csv" | "pdf", only?: ProductRow[]) {
    setMenu(""); setBusy(true);
    try {
      const list = only ?? await fetchAll();
      if (kind === "csv") downloadCsv(`products-${new Date().toISOString().slice(0, 10)}.csv`, exportHeaders, list.map(exportRow));
      else printReport("تقرير الأصناف", `${list.length} صنف`,
        (canCost && k?.stockValue != null ? kpisHTML([{ label: "قيمة المخزون", value: fmtCurrency(k.stockValue, 2) }]) : "") + tableHTML(exportHeaders, list.map((r) => exportRow(r).map((v) => v ?? ""))));
    } catch (e) { await appAlert(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  }
  async function bulk(kind: "activate" | "deactivate" | "category") {
    const ids = [...selected.keys()];
    if (kind === "deactivate" && !await appConfirm(`تعطيل ${ids.length} صنف؟ (حذف ناعم — الفواتير والحركات التاريخية تبقى، ويمكن إعادة التفعيل)`)) return;
    setBusy(true); setMenu("");
    try {
      if (kind === "category") await api("/products/bulk-category", { method: "POST", body: JSON.stringify({ ids, category: bulkCat }) });
      else await api("/products/bulk-status", { method: "POST", body: JSON.stringify({ ids, active: kind === "activate" }) });
      setSelected(new Map()); setCatModal(false); cache.clear(); await load(true);
    } catch (e) { await appAlert(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  }
  async function deactivateOne(r: ProductRow) {
    setMenu("");
    if (!await appConfirm(`تعطيل الصنف «${r.name}»؟ الفواتير والحركات القديمة تبقى محفوظة.`)) return;
    try { await api(`/products/${r.id}`, { method: "DELETE" }); cache.clear(); await load(true); } catch (e) { await appAlert(e instanceof Error ? e.message : String(e)); }
  }
  async function openEdit(r: ProductRow) {
    setMenu("");
    try {
      const p = await api<{ product: NonNullable<Parameters<typeof ProductForm>[0]["product"]> }>(`/products/${r.id}/profile`);
      setForm({ product: p.product });
    } catch (e) { await appAlert(e instanceof Error ? e.message : String(e)); }
  }
  const labelOf = (r: ProductRow): LabelItem => ({ id: r.id, name: r.name, spec: r.spec, sku: r.sku, barcode: r.barcode, priceVat: r.priceVat });

  const SortIcon = ({ s }: { s?: SortKey }) => !s ? null : <MIcon name={sort === s ? (dir === "asc" ? "arrow_upward" : "arrow_downward") : "unfold_more"} className={`!text-[14px] ${sort === s ? "text-petrol" : "opacity-40"}`} />;
  const kpiLoading = loading && !data;
  const pad = PAD[density];

  const RowMenu = ({ r }: { r: ProductRow }) => (
    <div className="relative" onClick={(e) => e.stopPropagation()}>
      <button aria-label={`المزيد: ${r.name}`} aria-haspopup="menu" aria-expanded={menu === `row:${r.id}`} onClick={() => setMenu(menu === `row:${r.id}` ? "" : `row:${r.id}`)} className="grid h-8 w-8 place-items-center rounded-md text-text-dim hover:bg-petrol-soft hover:text-petrol"><MIcon name="more_horiz" className="!text-[19px]" /></button>
      {menu === `row:${r.id}` && (
        <div role="menu" className="absolute end-0 top-full z-30 mt-1 w-52 overflow-hidden rounded-card border border-line bg-ink-2 shadow-xl">
          {[
            canSell && !r.isService ? { l: "بيع الصنف", i: "point_of_sale", href: "/sales/direct" } : null,
            canPurchase && !r.isService ? { l: "شراء", i: "shopping_bag", href: "/purchases" } : null,
            canStock && !r.isService ? { l: "تحويل / استلام", i: "swap_horiz", href: "/inventory" } : null,
            canStock && !r.isService ? { l: "جرد", i: "fact_check", href: "/inventory/stocktake" } : null,
          ].filter(Boolean).map((a) => <Link key={a!.l} role="menuitem" href={a!.href} className="flex items-center gap-2 px-3 py-2.5 text-t-sm font-bold hover:bg-ink-3"><MIcon name={a!.i} className="!text-[18px] text-petrol" />{a!.l}</Link>)}
          <button role="menuitem" onClick={() => { setMenu(""); setLabels([labelOf(r)]); }} className="flex w-full items-center gap-2 px-3 py-2.5 text-start text-t-sm font-bold hover:bg-ink-3"><MIcon name="barcode" className="!text-[18px] text-petrol" />طباعة باركود</button>
          {canDelete && r.isActive && <button role="menuitem" onClick={() => deactivateOne(r)} className="flex w-full items-center gap-2 border-t border-line px-3 py-2.5 text-start text-t-sm font-bold text-ember hover:bg-ink-3"><MIcon name="block" className="!text-[18px]" />تعطيل</button>}
        </div>)}
    </div>
  );

  function cell(key: ColKey, r: ProductRow) {
    switch (key) {
      case "product": return (
        <div className="flex items-center gap-3">
          <Thumb id={r.id} has={r.hasImage} size={density === "comfortable" ? 44 : density === "compact" ? 34 : 26} name={r.name} />
          <div className="min-w-0">
            <Link href={`/products/${r.id}`} className="block max-w-[280px] truncate font-extrabold hover:text-petrol hover:underline">{r.name}{r.spec ? <bdi dir="ltr" className="ms-2 font-bold text-text-dim">{r.spec}</bdi> : null}</Link>
            <div className="flex flex-wrap items-center gap-1.5 text-t-xs text-text-dim">{r.brand && <span>{r.brand}</span>}<TypeChips p={r} />{r.isFast && <span className="rounded-md bg-petrol-soft px-1.5 py-0.5 font-bold text-petrol">سريع الحركة</span>}</div>
          </div>
        </div>);
      case "sku": return <span dir="ltr" className="tnum text-text-dim">{r.sku || "—"}</span>;
      case "barcode": return <span dir="ltr" className="tnum text-text-dim">{r.barcode || "—"}</span>;
      case "category": return <span className="text-text-dim">{r.category || "—"}</span>;
      case "price": return <div className="tnum"><b>{fmtCurrency(r.price, 2)}</b><div className="text-t-xs text-text-dim">شامل: {fmtMoney(r.priceVat, 2)}</div></div>;
      case "cost": return <span className="tnum text-text-dim">{r.cost == null ? "—" : fmtCurrency(r.cost, 2)}</span>;
      case "stock": return <StockCell stock={r.stock} status={r.stockStatus} unit={r.unit} />;
      case "profit": return r.unitProfit == null ? <span className="text-text-dim">—</span> : <div className="tnum"><b className={r.unitProfit < 0 ? "text-ember" : ""}>{fmtCurrency(r.unitProfit, 2)}</b><div className={`text-t-xs ${(r.margin ?? 0) < 0 ? "text-ember" : "text-text-dim"}`}>{r.margin}%</div></div>;
      case "sales": return r.periodRevenue == null ? "—" : <div className="tnum"><b>{fmtCurrency(r.periodRevenue, 2)}</b><div className="text-t-xs text-text-dim">{fmtMoney(r.periodQty, 0)} وحدة</div></div>;
      case "last": return <span className="whitespace-nowrap text-text-dim">{ago(r.lastSaleAt)}</span>;
      case "status": return r.isActive ? (r.stockStatus === "service" ? <Badge tone="success">نشط</Badge> : <StockBadge status={r.stockStatus} />) : <Badge tone="neutral">غير نشط</Badge>;
    }
  }

  return (
    <div className="cx-enter mx-auto w-full max-w-[1600px] space-y-4 pb-8" onClick={() => menu && setMenu("")}>
      <PageHeader title="الأصناف" description="إدارة المنتجات والمخزون والأسعار والتكلفة والربحية." actions={<><div className="flex flex-wrap items-center gap-2" onClick={(e) => e.stopPropagation()}>
          <Link href="/products/manage" className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-ink-2 px-3.5 py-2 text-t-md font-semibold hover:border-petrol hover:text-petrol"><MIcon name="build" className="!text-[17px]" />استيراد وأدوات متقدمة</Link>
          <div className="relative">
            <Button variant="outline" loading={busy} aria-haspopup="menu" aria-expanded={menu === "export"} onClick={() => setMenu(menu === "export" ? "" : "export")}><MIcon name="download" className="!text-[18px]" />تصدير / طباعة</Button>
            {menu === "export" && (
              <div role="menu" className="absolute end-0 top-full z-30 mt-1 w-52 overflow-hidden rounded-card border border-line bg-ink-2 shadow-xl">
                <button role="menuitem" onClick={() => doExport("csv")} className="flex w-full items-center gap-2 px-3 py-2.5 text-start text-t-sm font-bold hover:bg-ink-3"><MIcon name="table_view" className="!text-[18px] text-petrol" />Excel / CSV</button>
                <button role="menuitem" onClick={() => doExport("pdf")} className="flex w-full items-center gap-2 px-3 py-2.5 text-start text-t-sm font-bold hover:bg-ink-3"><MIcon name="picture_as_pdf" className="!text-[18px] text-petrol" />طباعة / PDF</button>
              </div>)}
          </div>
          {canCreate && <Button onClick={() => setForm({ product: null })}><MIcon name="add" className="!text-[18px]" />إضافة صنف</Button>}
        </div></>} />

      <GlobalFilters value={period} branches={null} onChange={(v) => setPeriod(v.period === "custom" ? v : { ...v, ...rangeFor(v.period) })} onRefresh={() => load(true)} refreshing={refreshing} lastUpdated={updated} />

      <section aria-label="KPI" className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {kpiLoading ? Array.from({ length: 8 }).map((_, i) => <KpiSkeleton key={i} />) : k && <>
          <KpiCard label="إجمالي الأصناف" icon="inventory_2" value={fmtMoney(k.total, 0)} accent="var(--petrol)" sub={`${k.stocked} بمخزون · ${k.services} خدمة`} />
          {k.stockValue != null && <KpiCard label="قيمة المخزون" tip="الكمية × التكلفة المعتمدة (نفس تقرير تقييم المخزون)" icon="account_balance_wallet" value={fmtCurrency(k.stockValue)} accent="var(--chart-revenue)" href="/inventory" />}
          <KpiCard label="منخفض المخزون" icon="trending_down" value={fmtMoney(k.lowStock, 0)} accent="var(--brass)" subTone={k.lowStock ? "warning" : "neutral"} sub={k.lowStock ? "عرض الأصناف" : undefined} />
          <KpiCard label="نافد" icon="block" value={fmtMoney(k.outOfStock, 0)} accent="var(--ember)" subTone={k.outOfStock ? "danger" : "neutral"} sub={k.outOfStock ? "عرض الأصناف" : undefined} />
          <KpiCard label="الأصناف النشطة" icon="check_circle" value={fmtMoney(k.total, 0)} accent="var(--chart-profit)" sub={`${k.inactive} غير نشط`} />
          {k.sales != null && <KpiCard label="مبيعات الفترة" tip="مبيعات الأصناف قبل الضريبة" icon="payments" value={fmtCurrency(k.sales)} accent="var(--chart-revenue)" sub={k.salesQty != null ? `${fmtMoney(k.salesQty, 0)} وحدة` : undefined} href={`/sales/history?from=${period.from}&to=${period.to}`} />}
          {k.grossProfit != null && <KpiCard label="إجمالي الربح" tip="من الفواتير: صافي المبيعات − تكلفة البضاعة المباعة (المصدر المحاسبي)" icon="trending_up" value={fmtCurrency(k.grossProfit)} accent="var(--chart-profit)" />}
          {k.margin != null && <KpiCard label="هامش الربح" icon="percent" value={`${k.margin}%`} accent="var(--petrol)" />}
        </>}
      </section>

      <div role="tablist" aria-label="عروض سريعة" className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1 [scrollbar-width:none]">
        {QUICK.map((v) => (
          <button key={v.key} role="tab" aria-selected={quickKey === v.key} onClick={() => { setFilters(v.key === "all" ? EMPTY_PFILTERS : { ...EMPTY_PFILTERS, ...v.patch }); setPage(1); }}
            className={`inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-3 py-1.5 text-t-sm font-bold transition ${quickKey === v.key ? "border-petrol bg-petrol text-white" : "border-line bg-ink-2 text-text-dim hover:border-petrol hover:text-petrol"}`}>
            <MIcon name={v.icon} className="!text-[16px]" />{v.label}</button>))}
      </div>

      <div className="flex flex-wrap items-center gap-2" onClick={(e) => e.stopPropagation()}>
        <div className="relative min-w-[240px] flex-1">
          <MIcon name="search" className="pointer-events-none absolute top-1/2 -translate-y-1/2 !text-[19px] text-text-dim rtl:right-3 ltr:left-3" />
          <Input ref={searchRef} type="search" value={qInput} onChange={(e) => setQInput(e.target.value)} aria-label="بحث" className="!ps-10" placeholder="ابحث باسم الصنف أو SKU أو الباركود أو التصنيف أو المورد… (اضغط / للتركيز، أو امسح الباركود)"
            onKeyDown={(e) => { if (e.key === "Enter" && data?.total === 1 && data.items[0]) router.push(`/products/${data.items[0].id}`); }} />
        </div>
        {data && data.facets.locations.length > 1 && (
          <select value={filters.loc} onChange={(e) => { setFilters({ ...filters, loc: e.target.value }); setPage(1); }} aria-label="الموقع" className="h-10 rounded-card border border-line bg-ink-2 px-3 text-t-sm font-bold">
            <option value="">كل المواقع</option>{data.facets.locations.map((l) => <option key={l.id} value={l.type === "warehouse" ? "warehouse" : l.id}>{l.name}</option>)}</select>)}
        <Button variant="outline" onClick={() => setFiltersOpen(true)}><MIcon name="tune" className="!text-[18px]" />فلاتر متقدمة{activeCount > 0 && <span className="tnum grid h-5 min-w-5 place-items-center rounded-full bg-petrol px-1 text-t-xs font-black text-white">{activeCount}</span>}</Button>
        {filtered && <button onClick={clearAll} className="text-t-sm font-bold text-petrol hover:underline">مسح الكل</button>}
        <div className="ms-auto flex items-center gap-1.5">
          <select value={density} onChange={(e) => setDensity(e.target.value as Density)} aria-label="كثافة الجدول" className="hidden h-9 rounded-lg border border-line bg-ink-2 px-2 text-t-sm md:block"><option value="comfortable">مريح</option><option value="compact">مضغوط</option><option value="dense">كثيف</option></select>
          <div className="relative hidden md:block">
            <button onClick={() => setMenu(menu === "cols" ? "" : "cols")} aria-haspopup="menu" aria-expanded={menu === "cols"} className="flex h-9 items-center gap-1.5 rounded-lg border border-line px-3 text-t-sm font-bold text-text-dim hover:border-petrol hover:text-petrol"><MIcon name="view_column" className="!text-[18px]" />الأعمدة</button>
            {menu === "cols" && (
              <div role="menu" className="absolute end-0 top-full z-30 mt-1 w-48 rounded-card border border-line bg-ink-2 p-2 shadow-xl">
                {COLS.filter((x) => x.key !== "product" && (!x.cost || canCost) && (!x.sales || canSales)).map((x) => (
                  <label key={x.key} className="flex min-h-[34px] cursor-pointer items-center gap-2 rounded-md px-2 text-t-sm hover:bg-ink-3"><input type="checkbox" className="accent-[var(--petrol)]" checked={cols.includes(x.key)} onChange={(e) => setCols((p) => e.target.checked ? [...p, x.key] : p.filter((y) => y !== x.key))} />{x.label}</label>))}
              </div>)}
          </div>
        </div>
      </div>

      {selected.size > 0 && (
        <div role="region" aria-label="إجراءات جماعية" className="cx-enter flex flex-wrap items-center gap-2 rounded-card border border-petrol/30 bg-petrol-soft px-3 py-2">
          <b className="tnum text-t-sm">{selected.size} محدد</b><span className="mx-1 h-4 w-px bg-line" />
          <Button size="sm" variant="outline" onClick={() => doExport("csv", [...selected.values()])}><MIcon name="download" className="!text-[16px]" />تصدير</Button>
          <Button size="sm" variant="outline" onClick={() => doExport("pdf", [...selected.values()])}><MIcon name="print" className="!text-[16px]" />طباعة</Button>
          <Button size="sm" variant="outline" onClick={() => setLabels([...selected.values()].map(labelOf))}><MIcon name="barcode" className="!text-[16px]" />ملصقات الباركود</Button>
          {canEdit && <Button size="sm" variant="outline" onClick={() => { setBulkCat(""); setCatModal(true); }}><MIcon name="category" className="!text-[16px]" />تعيين فئة</Button>}
          {canEdit && filters.status !== "active" && <Button size="sm" variant="outline" onClick={() => bulk("activate")}><MIcon name="check_circle" className="!text-[16px]" />تفعيل</Button>}
          {canDelete && <Button size="sm" variant="outline" onClick={() => bulk("deactivate")}><MIcon name="block" className="!text-[16px]" />تعطيل</Button>}
          <button onClick={() => setSelected(new Map())} className="ms-auto text-t-sm font-bold text-text-dim hover:text-text">إلغاء التحديد</button>
        </div>)}

      <div className="overflow-hidden rounded-card border border-line bg-ink-2 shadow-card" aria-busy={loading || refreshing}>
        {error && !data ? (
          <div role="alert" className="flex flex-col items-center gap-2 py-14 text-center"><MIcon name="cloud_off" className="!text-[36px] text-ember" /><div className="text-t-md font-black">تعذر تحميل بيانات الأصناف</div><div className="text-t-sm text-text-dim">{error}</div><Button onClick={() => load()}>إعادة المحاولة</Button></div>
        ) : loading && !data ? (
          <div className="space-y-2 p-4">{Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} height={52} />)}</div>
        ) : rows.length === 0 ? (
          filtered ? <EmptyState icon="search_off" title="لم يتم العثور على نتائج" description="جرب تغيير كلمات البحث أو الفلاتر." action={<Button variant="outline" onClick={clearAll}>مسح الكل</Button>} />
            : <EmptyState icon="inventory_2" title="لا توجد أصناف حتى الآن" description="أضف أول صنف لبدء إدارة المخزون والمبيعات." action={canCreate ? <Button onClick={() => setForm({ product: null })}><MIcon name="add" className="!text-[18px]" />إضافة أول صنف</Button> : undefined} />
        ) : (
          <>
            {error && <div role="alert" className="border-b border-ember/30 bg-ember-bg px-4 py-2 text-t-sm text-ember">تعذر تحديث البيانات — <button className="font-bold underline" onClick={() => load()}>إعادة المحاولة</button></div>}
            <div className={`hidden max-h-[68vh] overflow-auto md:block ${refreshing ? "opacity-80" : ""} transition-opacity`}>
              <table className="w-full border-separate border-spacing-0 text-t-sm">
                <thead className="sticky top-0 z-10 bg-ink-3 text-t-xs text-text-dim">
                  <tr>
                    <th className="w-10 border-b border-line px-3 py-2.5"><input type="checkbox" aria-label="تحديد الكل" className="accent-[var(--petrol)]" checked={allOnPage} onChange={toggleAll} /></th>
                    {visibleCols.map((c) => (
                      <th key={c.key} scope="col" aria-sort={c.sort && sort === c.sort ? (dir === "asc" ? "ascending" : "descending") : undefined} className={`whitespace-nowrap border-b border-line px-3 py-2.5 font-extrabold ${c.num ? "text-end" : "text-start"}`}>
                        {c.sort ? <button onClick={() => toggleSort(c.sort!)} className="inline-flex items-center gap-1 hover:text-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-petrol">{c.label}<SortIcon s={c.sort} /></button> : c.label}</th>))}
                    <th className="border-b border-line px-3 py-2.5 text-end font-extrabold">الإجراءات</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id} tabIndex={0} onKeyDown={(e) => { if (e.key === "Enter" && e.target === e.currentTarget) router.push(`/products/${r.id}`); }}
                      onClick={(e) => { if ((e.target as HTMLElement).closest("a,button,input,label,[role=menu]")) return; router.push(`/products/${r.id}`); }}
                      className={`group cursor-pointer border-b border-line/60 outline-none transition-colors hover:bg-ink-3/60 focus-visible:bg-ink-3 ${selected.has(r.id) ? "bg-petrol-soft/60" : ""} ${r.isActive ? "" : "opacity-60"}`}>
                      <td className={`border-b border-line/60 px-3 ${pad}`}><input type="checkbox" aria-label={r.name} className="accent-[var(--petrol)]" checked={selected.has(r.id)} onChange={() => toggleRow(r)} /></td>
                      {visibleCols.map((c) => <td key={c.key} className={`border-b border-line/60 px-3 ${pad} ${c.num ? "text-end" : ""}`}>{cell(c.key, r)}</td>)}
                      <td className={`border-b border-line/60 px-3 ${pad}`}>
                        <div className="flex justify-end gap-1 opacity-70 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
                          <Link href={`/products/${r.id}`} aria-label={`عرض ${r.name}`} title="عرض" className="grid h-8 w-8 place-items-center rounded-md text-text-dim hover:bg-petrol-soft hover:text-petrol"><MIcon name="open_in_new" className="!text-[18px]" /></Link>
                          {canEdit && <button aria-label={`تعديل ${r.name}`} title="تعديل" onClick={() => openEdit(r)} className="grid h-8 w-8 place-items-center rounded-md text-text-dim hover:bg-petrol-soft hover:text-petrol"><MIcon name="edit" className="!text-[18px]" /></button>}
                          <RowMenu r={r} />
                        </div>
                      </td>
                    </tr>))}
                </tbody>
              </table>
            </div>

            <ul className="divide-y divide-line/60 md:hidden">
              {rows.map((r) => (
                <li key={r.id} className={`px-4 py-3 ${r.isActive ? "" : "opacity-60"}`}>
                  <Link href={`/products/${r.id}`} className="flex items-start gap-3">
                    <Thumb id={r.id} has={r.hasImage} size={52} name={r.name} />
                    <span className="min-w-0 flex-1">
                      <b className="block truncate text-t-md">{r.name}{r.spec ? <bdi dir="ltr" className="ms-2 text-text-dim">{r.spec}</bdi> : null}</b>
                      <span dir="ltr" className="tnum block text-start text-t-xs text-text-dim">{r.sku || r.barcode || "—"}</span>
                      <span className="mt-1.5 flex items-center justify-between gap-2">
                        <span className="text-t-xs text-text-dim">السعر: <b className="tnum text-text">{fmtCurrency(r.price, 2)}</b></span>
                        {r.stockStatus === "service" ? <span className="text-t-xs text-text-dim">خدمة</span> : <span className="flex items-center gap-1.5"><b className="tnum text-t-sm">{fmtMoney(r.stock ?? 0, 0)}</b><StockBadge status={r.stockStatus} /></span>}
                      </span>
                    </span>
                  </Link>
                  <div className="mt-2 flex items-center justify-end gap-1.5">
                    <Link href={`/products/${r.id}`} className="rounded-lg border border-line px-3 py-1.5 text-t-xs font-bold">عرض</Link>
                    {canEdit && <button onClick={() => openEdit(r)} className="rounded-lg border border-line px-3 py-1.5 text-t-xs font-bold">تعديل</button>}
                    <RowMenu r={r} />
                  </div>
                </li>))}
            </ul>

            <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-4 py-2.5 text-t-sm">
              <span className="tnum text-text-dim">{(page - 1) * size + 1}–{Math.min(page * size, data?.total ?? 0)} من {data?.total ?? 0}</span>
              <div className="flex items-center gap-2">
                <select value={size} onChange={(e) => { setSize(Number(e.target.value)); setPage(1); }} aria-label="عدد الصفوف" className="rounded-lg border border-line bg-ink-2 px-2 py-1 text-t-sm">{[10, 25, 50, 100].map((n) => <option key={n} value={n}>{n} صف/صفحة</option>)}</select>
                <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage(page - 1)}><MIcon name="chevron_right" className="!text-[18px] ltr:rotate-180" />السابق</Button>
                <span className="tnum text-text-dim">{page} / {pages}</span>
                <Button size="sm" variant="outline" disabled={page >= pages} onClick={() => setPage(page + 1)}>التالي<MIcon name="chevron_left" className="!text-[18px] ltr:rotate-180" /></Button>
              </div>
            </footer>
          </>)}
      </div>

      <ProductFilters open={filtersOpen} value={filters} facets={data?.facets ?? null} onApply={(f) => { setFilters(f); setPage(1); }} onClose={() => setFiltersOpen(false)} />
      <ProductForm open={!!form} product={form?.product} categories={categories} canCost={canCost} onClose={() => setForm(null)}
        onSaved={(id) => { const isNew = !form?.product; setForm(null); cache.clear(); if (isNew) router.push(`/products/${id}`); else load(true); }} />
      <BarcodeLabels open={!!labels} items={labels ?? []} onClose={() => setLabels(null)} />
      <Modal open={catModal} onClose={() => setCatModal(false)} title={`تعيين فئة لـ ${selected.size} صنف`}>
        <div className="space-y-3"><ComboSelect value={bulkCat} options={categories} placeholder="اسم الفئة" onChange={setBulkCat} />
          <div className="flex justify-end gap-2"><Button variant="ghost" onClick={() => setCatModal(false)}>إلغاء</Button><Button loading={busy} disabled={!bulkCat.trim()} onClick={() => bulk("category")}>تعيين</Button></div></div>
      </Modal>
    </div>
  );
}
