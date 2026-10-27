"use client";
// العملاء — مركز قيادة العملاء: مؤشرات الفترة + بحث/فلاتر/فرز/ترقيم من السيرفر + جدول احترافي (بطاقات على الجوال)
// كل الأرقام المحاسبية تأتي من /customers/overview (الباك اند يحسب والواجهة تعرض).
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { printReport, tableHTML, kpisHTML } from "@/lib/print";
import { MIcon } from "@/components/m-icon";
import { Button, EmptyState, Input, PageHeader } from "@/components/ui";
import { appAlert, appConfirm } from "@/components/dialog";
import { GlobalFilters, type FilterState } from "@/components/dashboard/GlobalFilters";
import { KpiCard, KpiSkeleton } from "@/components/dashboard/KpiCard";
import { Skeleton } from "@/components/dashboard/Widget";
import { CustomerForm } from "@/components/customers/CustomerForm";
import { FiltersPanel } from "@/components/customers/FiltersPanel";
import { Avatar, SegmentBadge, StatusBadge, statusOf } from "@/components/customers/parts";
import { PERIODS, rangeFor, type PeriodKey } from "@/lib/dashboard/periods";
import { useCx, type CKey } from "@/lib/customers/i18n";
import { ago, downloadCsv, fmtCurrency, fmtD, fmtMoney } from "@/lib/customers/format";
import { EMPTY_FILTERS, type CustomerRow, type Filters, type Overview } from "@/lib/customers/types";

type ColKey = "customer" | "phone" | "type" | "last" | "sales" | "paid" | "balance" | "status" | "invoices" | "vehicles" | "created";
type SortKey = "name" | "sales" | "balance" | "last" | "created" | "invoices";
const COLS: { key: ColKey; label: CKey; sort?: SortKey; fin?: boolean; def: boolean; num?: boolean }[] = [
  { key: "customer", label: "col.customer", sort: "name", def: true },
  { key: "phone", label: "col.phone", def: true },
  { key: "type", label: "col.type", def: true },
  { key: "last", label: "col.last", sort: "last", def: true },
  { key: "sales", label: "col.sales", sort: "sales", fin: true, def: true, num: true },
  { key: "paid", label: "col.paid", fin: true, def: true, num: true },
  { key: "balance", label: "col.balance", sort: "balance", fin: true, def: true, num: true },
  { key: "status", label: "col.status", def: true },
  { key: "invoices", label: "col.invoices", sort: "invoices", def: false, num: true },
  { key: "vehicles", label: "col.vehicles", def: false, num: true },
  { key: "created", label: "col.created", sort: "created", def: false },
];

const cache = new Map<string, { at: number; data: Overview }>();

/** الحالة الابتدائية من الرابط — فلاتر/بحث/فرز/صفحة قابلة للمشاركة */
function fromUrl() {
  const base = { q: "", page: 1, sort: "name" as SortKey, dir: "asc" as "asc" | "desc", filters: EMPTY_FILTERS, period: { period: "month", ...rangeFor("month"), branchId: null } as FilterState };
  if (typeof window === "undefined") return base;
  const sp = new URLSearchParams(window.location.search);
  try {
    const f = sp.get("f"); if (f) base.filters = { ...EMPTY_FILTERS, ...JSON.parse(f) };
  } catch { /* */ }
  base.q = sp.get("q") ?? ""; base.page = Math.max(1, Number(sp.get("page")) || 1);
  const s = sp.get("sort") as SortKey | null; if (s && COLS.some((c) => c.sort === s)) base.sort = s;
  if (sp.get("dir") === "desc") base.dir = "desc";
  const p = sp.get("p") as PeriodKey | null;
  if (p === "custom" && sp.get("from") && sp.get("to")) base.period = { period: "custom", from: sp.get("from")!, to: sp.get("to")!, branchId: null };
  else if (p && PERIODS.some((x) => x.key === p)) base.period = { period: p, ...rangeFor(p as Exclude<PeriodKey, "custom">), branchId: null };
  return base;
}

function buildQs(o: { q: string; page: number; size: number; sort: SortKey; dir: string; filters: Filters; from: string; to: string }) {
  const sp = new URLSearchParams({ page: String(o.page), pageSize: String(o.size), sort: o.sort, dir: o.dir, from: o.from, to: o.to });
  if (o.q.trim()) sp.set("q", o.q.trim());
  const f = o.filters;
  if (f.status !== "active") sp.set("status", f.status);
  (["type", "segment", "pay", "regFrom", "regTo", "lastFrom", "lastTo", "salesMin", "salesMax", "balMin", "balMax"] as const).forEach((k) => { if (f[k]) sp.set(k, f[k]); });
  (["hasBalance", "overdue", "noActivity"] as const).forEach((k) => { if (f[k]) sp.set(k, "1"); });
  return sp.toString();
}

export default function CustomersPage() {
  const { hasPerm } = useAuth();
  const { c, isEn } = useCx();
  const router = useRouter();
  const canCreate = hasPerm("customers.create");
  const canEdit = hasPerm("customers.edit");
  const canDelete = hasPerm("customers.delete");

  const init = useRef(fromUrl()).current;
  const [period, setPeriod] = useState<FilterState>(init.period);
  const [qInput, setQInput] = useState(init.q);
  const [q, setQ] = useState(init.q);
  const [filters, setFilters] = useState<Filters>(init.filters);
  const [sort, setSort] = useState<SortKey>(init.sort);
  const [dir, setDir] = useState<"asc" | "desc">(init.dir);
  const [page, setPage] = useState(init.page);
  const [size, setSize] = useState(25);
  const [data, setData] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [form, setForm] = useState<null | { customer: import("@/modules/customers/types").Customer | null }>(null);
  const [selected, setSelected] = useState<Map<string, CustomerRow>>(new Map());
  const [dense, setDense] = useState(false);
  const [cols, setCols] = useState<ColKey[]>(COLS.filter((x) => x.def).map((x) => x.key));
  const [menu, setMenu] = useState<"" | "cols" | "export">("");
  const [busy, setBusy] = useState(false);
  const [updated, setUpdated] = useState<Date | null>(null);

  useEffect(() => {
    try {
      const sv = JSON.parse(localStorage.getItem("z8_cx_cols") || "null"); if (Array.isArray(sv) && sv.length) setCols(sv);
      setDense(localStorage.getItem("z8_cx_dense") === "1");
    } catch { /* */ }
  }, []);
  useEffect(() => { try { localStorage.setItem("z8_cx_cols", JSON.stringify(cols)); localStorage.setItem("z8_cx_dense", dense ? "1" : "0"); } catch { /* */ } }, [cols, dense]);

  // بحث بتأخير 300ms — لا طلب مع كل حرف
  useEffect(() => { const t = setTimeout(() => { setQ((p) => { if (p !== qInput) setPage(1); return qInput; }); }, 300); return () => clearTimeout(t); }, [qInput]);

  const qs = useMemo(() => buildQs({ q, page, size, sort, dir, filters, from: period.from, to: period.to }), [q, page, size, sort, dir, filters, period.from, period.to]);

  const ctl = useRef<AbortController | null>(null);
  const load = useCallback(async (silent = false) => {
    ctl.current?.abort(); const ac = new AbortController(); ctl.current = ac;
    const hit = cache.get(qs);
    if (hit && !silent) { setData(hit.data); setLoading(false); } else if (!data && !hit) setLoading(true);
    setRefreshing(true); setError("");
    try {
      const d = await api<Overview>(`/customers/overview?${qs}`, { signal: ac.signal });
      cache.set(qs, { at: Date.now(), data: d }); setData(d); setUpdated(new Date());
    } catch (e) {
      if ((e as Error).name === "AbortError") return;
      setError(e instanceof Error ? e.message : String(e));
    } finally { if (ctl.current === ac) { setLoading(false); setRefreshing(false); } }
  }, [qs]);   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { load(); return () => ctl.current?.abort(); }, [load]);

  // مزامنة الرابط
  useEffect(() => {
    const sp = new URLSearchParams();
    if (q.trim()) sp.set("q", q.trim());
    if (page > 1) sp.set("page", String(page));
    if (sort !== "name" || dir !== "asc") { sp.set("sort", sort); sp.set("dir", dir); }
    const diff = Object.fromEntries(Object.entries(filters).filter(([k, v]) => v !== (EMPTY_FILTERS as Record<string, unknown>)[k]));
    if (Object.keys(diff).length) sp.set("f", JSON.stringify(diff));
    sp.set("p", period.period); if (period.period === "custom") { sp.set("from", period.from); sp.set("to", period.to); }
    window.history.replaceState(null, "", `?${sp}`);
  }, [q, page, sort, dir, filters, period]);

  const fin = data?.canFinance ?? true;
  const visibleCols = COLS.filter((x) => cols.includes(x.key) && (!x.fin || fin));
  const activeFilterCount = Object.entries(filters).filter(([k, v]) => v !== (EMPTY_FILTERS as Record<string, unknown>)[k]).length;
  const rows = data?.items ?? [];
  const pages = Math.max(1, Math.ceil((data?.total ?? 0) / size));
  const filtered = activeFilterCount > 0 || q.trim() !== "";

  function toggleSort(k: SortKey) { if (sort === k) setDir(dir === "asc" ? "desc" : "asc"); else { setSort(k); setDir(k === "name" ? "asc" : "desc"); } setPage(1); }
  function clearAll() { setFilters(EMPTY_FILTERS); setQInput(""); setQ(""); setPage(1); }
  function applyDrill(patch: Partial<Filters>) { setFilters({ ...EMPTY_FILTERS, ...patch }); setPage(1); }

  const toggleRow = (r: CustomerRow) => setSelected((p) => { const n = new Map(p); if (n.has(r.id)) n.delete(r.id); else n.set(r.id, r); return n; });
  const allOnPage = rows.length > 0 && rows.every((r) => selected.has(r.id));
  const toggleAll = () => setSelected((p) => { const n = new Map(p); if (allOnPage) rows.forEach((r) => n.delete(r.id)); else rows.forEach((r) => n.set(r.id, r)); return n; });

  const exportHeaders = ["الرقم", "العميل", "النوع", "الجوال", "البريد", "الرقم الضريبي", ...(fin ? ["المبيعات", "المدفوع", "المستحق", "المتأخر"] : []), "عدد الفواتير", "آخر تعامل", "الحالة"];
  const exportRow = (r: CustomerRow) => [r.no, r.name, r.type === "company" ? "شركة" : "فرد", r.phone, r.email, r.vat,
    ...(fin ? [r.sales, r.paid, r.balance, r.overdue] : []), r.invoiceCount, r.lastAt ? r.lastAt.slice(0, 10) : "", c(`st.${statusOf(r)}` as CKey)];

  /** يجلب كل نتائج الفلتر الحالي صفحةً صفحة (حد أقصى 5000) للتصدير */
  async function fetchAll(): Promise<CustomerRow[]> {
    const out: CustomerRow[] = [];
    for (let p = 1; p <= 50; p++) {
      const d = await api<Overview>(`/customers/overview?${buildQs({ q, page: p, size: 100, sort, dir, filters, from: period.from, to: period.to })}`);
      out.push(...d.items); if (out.length >= d.total || d.items.length === 0) break;
    }
    return out;
  }
  async function doExport(kind: "csv" | "pdf", only?: CustomerRow[]) {
    setMenu(""); setBusy(true);
    try {
      const list = only ?? await fetchAll();
      if (kind === "csv") downloadCsv(`customers-${new Date().toISOString().slice(0, 10)}.csv`, exportHeaders, list.map(exportRow));
      else {
        const k = data?.kpis;
        printReport("تقرير العملاء", `${list.length} عميل`,
          (fin && k ? kpisHTML([{ label: "إجمالي المستحقات", value: fmtCurrency(k.receivables, 2) }, { label: "المتأخرات", value: fmtCurrency(k.overdue, 2) }]) : "") +
          tableHTML(exportHeaders, list.map((r) => exportRow(r).map((v) => v ?? "")), { numericCols: fin ? [6, 7, 8, 9] : [] }));
      }
    } catch (e) { await appAlert(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  }

  async function bulkStatus(active: boolean) {
    const ids = [...selected.keys()];
    if (!await appConfirm(active ? `تفعيل ${ids.length} عميل؟` : `تعطيل ${ids.length} عميل؟ (لا يتم الحذف — يمكن إعادة التفعيل لاحقاً)`)) return;
    setBusy(true);
    try {
      const r = await api<{ updated: number; skipped: { name: string; reason: string }[] }>("/customers/bulk-status", { method: "POST", body: JSON.stringify({ ids, active }) });
      if (r.skipped.length) await appAlert(`تم تحديث ${r.updated} عميل. تم تخطي ${r.skipped.length}:\n` + r.skipped.map((s) => `• ${s.name} — ${s.reason}`).join("\n"));
      setSelected(new Map()); cache.clear(); await load(true);
    } catch (e) { await appAlert(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  }

  const k = data?.kpis;
  const kpiLoading = loading && !data;

  const SortIcon = ({ k: sk }: { k?: SortKey }) => !sk ? null : (
    <MIcon name={sort === sk ? (dir === "asc" ? "arrow_upward" : "arrow_downward") : "unfold_more"} className={`!text-[14px] ${sort === sk ? "text-petrol" : "opacity-40"}`} />);
  const pad = dense ? "py-1.5" : "py-3";

  return (
    <div className="cx-enter mx-auto w-full max-w-[1600px] space-y-4 pb-8" onClick={() => menu && setMenu("")}>
      {/* ── Header ── */}
      <PageHeader title={c("title")} description={c("subtitle")} actions={<><div className="flex flex-wrap items-center gap-2" onClick={(e) => e.stopPropagation()}>
          <div className="relative">
            <Button variant="outline" onClick={() => setMenu(menu === "export" ? "" : "export")} loading={busy} aria-haspopup="menu" aria-expanded={menu === "export"}>
              <MIcon name="download" className="!text-[18px]" />{c("export")}
            </Button>
            {menu === "export" && (
              <div role="menu" className="absolute end-0 top-full z-30 mt-1 w-48 overflow-hidden rounded-card border border-line bg-ink-2 shadow-xl">
                <button role="menuitem" onClick={() => doExport("csv")} className="flex w-full items-center gap-2 px-3 py-2.5 text-start text-t-sm font-bold hover:bg-ink-3"><MIcon name="table_view" className="!text-[18px] text-petrol" />{c("exportCsv")}</button>
                <button role="menuitem" onClick={() => doExport("pdf")} className="flex w-full items-center gap-2 px-3 py-2.5 text-start text-t-sm font-bold hover:bg-ink-3"><MIcon name="picture_as_pdf" className="!text-[18px] text-petrol" />{c("exportPdf")}</button>
              </div>
            )}
          </div>
          {canCreate && <Button onClick={() => setForm({ customer: null })}><MIcon name="add" className="!text-[18px]" />{c("add")}</Button>}
        </div></>} />

      {/* ── فلتر الفترة (يؤثر على مؤشرات الفترة) ── */}
      <GlobalFilters value={period} branches={null} onChange={(v) => { setPeriod(v.period === "custom" ? v : { ...v, ...rangeFor(v.period) }); }} onRefresh={() => load(true)} refreshing={refreshing} lastUpdated={updated} />

      {/* ── KPI ── */}
      <section aria-label="KPI" className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {kpiLoading ? Array.from({ length: 6 }).map((_, i) => <KpiSkeleton key={i} />) : k && <>
          <KpiCard label={c("kpi.total")} icon="groups" value={fmtMoney(k.total, 0)} accent="var(--petrol)" />
          <KpiCard label={c("kpi.active")} tip={c("kpi.active.tip")} icon="how_to_reg" value={fmtMoney(k.activeInPeriod, 0)} accent="var(--chart-profit)" sub={k.total ? `${Math.round((k.activeInPeriod / k.total) * 100)}%` : undefined} />
          <KpiCard label={c("kpi.new")} tip={c("kpi.new.tip")} icon="person_add" value={fmtMoney(k.newInPeriod, 0)} accent="var(--chart-revenue)" />
          {fin && k.sales != null && <KpiCard label={c("kpi.sales")} icon="payments" value={fmtCurrency(k.sales)} accent="var(--chart-revenue)" href={`/sales/history?from=${period.from}&to=${period.to}`} sub={k.avgValue != null ? `${c("kpi.avg")}: ${fmtCurrency(k.avgValue)}` : undefined} />}
          {fin && k.receivables != null && <KpiCard label={c("kpi.receivables")} icon="request_quote" value={fmtCurrency(k.receivables)} accent="var(--brass)" sub={`${k.debtors ?? 0} ${isEn ? "customers" : "عميل"}`} />}
          {fin && k.overdue != null && <KpiCard label={c("kpi.overdue")} tip={c("kpi.overdue.tip")} icon="schedule" value={fmtCurrency(k.overdue)} accent="var(--ember)" subTone={k.overdue > 0 ? "danger" : "neutral"} />}
        </>}
      </section>
      {fin && k && (k.receivables ?? 0) > 0 && (
        <div className="-mt-1 flex flex-wrap gap-2 text-t-xs">
          <button onClick={() => applyDrill({ hasBalance: true })} className="rounded-full border border-line px-2.5 py-1 font-bold text-petrol hover:border-petrol">{isEn ? "Show customers with a balance" : "عرض العملاء أصحاب الأرصدة"}</button>
          {(k.overdue ?? 0) > 0 && <button onClick={() => applyDrill({ overdue: true })} className="rounded-full border border-ember/30 px-2.5 py-1 font-bold text-ember hover:bg-ember-bg">{isEn ? "Show overdue customers" : "عرض العملاء المتأخرين"}</button>}
          <Link href="/reports/analysis?tab=ar" className="rounded-full border border-line px-2.5 py-1 font-bold text-petrol hover:border-petrol">{isEn ? "Receivables report" : "تقرير أعمار الذمم"}</Link>
        </div>
      )}

      {/* ── Toolbar: بحث + فلاتر + أعمدة ── */}
      <div className="flex flex-wrap items-center gap-2" onClick={(e) => e.stopPropagation()}>
        <div className="relative min-w-[220px] flex-1">
          <MIcon name="search" className="pointer-events-none absolute top-1/2 rtl:right-3 ltr:left-3 -translate-y-1/2 !text-[19px] text-text-dim" />
          <Input value={qInput} onChange={(e) => setQInput(e.target.value)} placeholder={c("search")} aria-label={c("search")} className="!ps-10" type="search" />
        </div>
        <Button variant="outline" onClick={() => setFiltersOpen(true)}>
          <MIcon name="tune" className="!text-[18px]" />{c("filters")}
          {activeFilterCount > 0 && <span className="tnum grid h-5 min-w-5 place-items-center rounded-full bg-petrol px-1 text-t-xs font-black text-white">{activeFilterCount}</span>}
        </Button>
        {filtered && <button onClick={clearAll} className="text-t-sm font-bold text-petrol hover:underline">{c("clearAll")}</button>}
        <div className="ms-auto flex items-center gap-1.5">
          <button onClick={() => setDense(!dense)} title={c("density")} aria-label={c("density")} aria-pressed={dense}
            className={`hidden h-9 w-9 place-items-center rounded-lg border md:grid ${dense ? "border-petrol text-petrol" : "border-line text-text-dim"} hover:border-petrol`}>
            <MIcon name={dense ? "density_small" : "density_medium"} className="!text-[19px]" />
          </button>
          <div className="relative hidden md:block">
            <button onClick={() => setMenu(menu === "cols" ? "" : "cols")} aria-haspopup="menu" aria-expanded={menu === "cols"}
              className="flex h-9 items-center gap-1.5 rounded-lg border border-line px-3 text-t-sm font-bold text-text-dim hover:border-petrol hover:text-petrol">
              <MIcon name="view_column" className="!text-[18px]" />{c("columns")}
            </button>
            {menu === "cols" && (
              <div role="menu" className="absolute end-0 top-full z-30 mt-1 w-48 rounded-card border border-line bg-ink-2 p-2 shadow-xl">
                {COLS.filter((x) => x.key !== "customer" && (!x.fin || fin)).map((x) => (
                  <label key={x.key} className="flex min-h-[34px] cursor-pointer items-center gap-2 rounded-md px-2 text-t-sm hover:bg-ink-3">
                    <input type="checkbox" className="accent-[var(--petrol)]" checked={cols.includes(x.key)}
                      onChange={(e) => setCols((p) => e.target.checked ? [...p, x.key] : p.filter((y) => y !== x.key))} />{c(x.label)}
                  </label>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Bulk bar ── */}
      {selected.size > 0 && (
        <div role="region" aria-label="bulk" className="cx-enter flex flex-wrap items-center gap-2 rounded-card border border-petrol/30 bg-petrol-soft px-3 py-2">
          <b className="tnum text-t-sm">{selected.size} {c("selected")}</b>
          <span className="mx-1 h-4 w-px bg-line" />
          <Button size="sm" variant="outline" onClick={() => doExport("csv", [...selected.values()])}><MIcon name="download" className="!text-[16px]" />{c("bulk.export")}</Button>
          <Button size="sm" variant="outline" onClick={() => doExport("pdf", [...selected.values()])}><MIcon name="print" className="!text-[16px]" />{c("bulk.print")}</Button>
          {canDelete && <>
            <Button size="sm" variant="outline" onClick={() => bulkStatus(false)}><MIcon name="block" className="!text-[16px]" />{c("bulk.deactivate")}</Button>
            {filters.status !== "active" && <Button size="sm" variant="outline" onClick={() => bulkStatus(true)}><MIcon name="check_circle" className="!text-[16px]" />{c("bulk.activate")}</Button>}
          </>}
          <button onClick={() => setSelected(new Map())} className="ms-auto text-t-sm font-bold text-text-dim hover:text-text">{isEn ? "Clear selection" : "إلغاء التحديد"}</button>
        </div>
      )}

      {/* ── القائمة ── */}
      <div className="overflow-hidden rounded-card border border-line bg-ink-2 shadow-card" aria-busy={loading || refreshing}>
        {error && !data ? (
          <div role="alert" className="flex flex-col items-center gap-2 py-14 text-center">
            <MIcon name="cloud_off" className="!text-[36px] text-ember" />
            <div className="text-t-md font-black">{c("loadFail")}</div><div className="text-t-sm text-text-dim">{error}</div>
            <Button onClick={() => load()}>{c("retry")}</Button>
          </div>
        ) : loading && !data ? (
          <div className="space-y-2 p-4">{Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} height={44} />)}</div>
        ) : rows.length === 0 ? (
          filtered ? (
            <EmptyState icon="search_off" title={c("noResults")} description={c("noResults.desc")} action={<Button variant="outline" onClick={clearAll}>{c("clearAll")}</Button>} />
          ) : (
            <EmptyState icon="groups" title={c("empty.title")} description={c("empty.desc")} action={canCreate ? <Button onClick={() => setForm({ customer: null })}><MIcon name="add" className="!text-[18px]" />{c("add")}</Button> : undefined} />
          )
        ) : (
          <>
            {error && <div role="alert" className="border-b border-ember/30 bg-ember-bg px-4 py-2 text-t-sm text-ember">{c("loadFail")} — <button className="font-bold underline" onClick={() => load()}>{c("retry")}</button></div>}

            {/* جدول — الشاشات المتوسطة فأكبر */}
            <div className={`hidden max-h-[68vh] overflow-auto md:block ${refreshing ? "opacity-80" : ""} transition-opacity`}>
              <table className="w-full border-separate border-spacing-0 text-t-sm">
                <thead className="sticky top-0 z-10 bg-ink-3 text-t-xs text-text-dim">
                  <tr>
                    <th className="w-10 border-b border-line px-3 py-2.5"><input type="checkbox" aria-label="select all" className="accent-[var(--petrol)]" checked={allOnPage} onChange={toggleAll} /></th>
                    {visibleCols.map((col) => (
                      <th key={col.key} scope="col" aria-sort={col.sort && sort === col.sort ? (dir === "asc" ? "ascending" : "descending") : undefined}
                        className={`whitespace-nowrap border-b border-line px-3 py-2.5 font-extrabold ${col.num ? "text-end" : "text-start"}`}>
                        {col.sort ? <button onClick={() => toggleSort(col.sort!)} className="inline-flex items-center gap-1 hover:text-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-petrol">{c(col.label)}<SortIcon k={col.sort} /></button> : c(col.label)}
                      </th>
                    ))}
                    <th className="border-b border-line px-3 py-2.5 text-end font-extrabold">{c("col.actions")}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id} tabIndex={0} onKeyDown={(e) => { if (e.key === "Enter" && e.target === e.currentTarget) router.push(`/customers/${r.id}`); }}
                      className={`group cursor-pointer border-b border-line/60 outline-none transition-colors hover:bg-ink-3/60 focus-visible:bg-ink-3 ${selected.has(r.id) ? "bg-petrol-soft/60" : ""}`}
                      onClick={(e) => { if ((e.target as HTMLElement).closest("a,button,input,label")) return; router.push(`/customers/${r.id}`); }}>
                      <td className={`border-b border-line/60 px-3 ${pad}`}><input type="checkbox" aria-label={r.name} className="accent-[var(--petrol)]" checked={selected.has(r.id)} onChange={() => toggleRow(r)} /></td>
                      {visibleCols.map((col) => <td key={col.key} className={`border-b border-line/60 px-3 ${pad} ${col.num ? "text-end" : ""}`}>{cell(col.key, r)}</td>)}
                      <td className={`border-b border-line/60 px-3 ${pad}`}>
                        <div className="flex justify-end gap-1 opacity-70 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
                          <Link href={`/customers/${r.id}`} aria-label={`${c("view")}: ${r.name}`} title={c("view")} className="grid h-8 w-8 place-items-center rounded-md text-text-dim hover:bg-petrol-soft hover:text-petrol"><MIcon name="open_in_new" className="!text-[18px]" /></Link>
                          {r.phone && <a href={`tel:${r.phone}`} aria-label={`${c("call")}: ${r.name}`} title={c("call")} className="grid h-8 w-8 place-items-center rounded-md text-text-dim hover:bg-petrol-soft hover:text-petrol"><MIcon name="call" className="!text-[18px]" /></a>}
                          {canEdit && <button aria-label={`${c("edit")}: ${r.name}`} title={c("edit")} onClick={async () => { try { setForm({ customer: await api(`/customers/${r.id}`) }); } catch (e) { appAlert(e instanceof Error ? e.message : String(e)); } }} className="grid h-8 w-8 place-items-center rounded-md text-text-dim hover:bg-petrol-soft hover:text-petrol"><MIcon name="edit" className="!text-[18px]" /></button>}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* بطاقات الجوال */}
            <ul className="divide-y divide-line/60 md:hidden">
              {rows.map((r) => (
                <li key={r.id}>
                  <Link href={`/customers/${r.id}`} className="flex items-start gap-3 px-4 py-3 active:bg-ink-3">
                    <Avatar name={r.name} />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center justify-between gap-2"><b className="truncate text-t-md">{r.name}</b><StatusBadge status={statusOf(r)} /></span>
                      <span dir="ltr" className="tnum block text-start text-t-xs text-text-dim">{r.phone || "—"}</span>
                      <span className="mt-1 flex items-center justify-between gap-2 text-t-xs text-text-dim">
                        <span>{c("col.last")}: {ago(r.lastAt, isEn)}</span>
                        {fin && r.balance != null && <span className={`tnum text-t-sm font-extrabold ${r.balance > 0 ? "text-ember" : "text-text-dim"}`}>{fmtCurrency(r.balance, 2)}</span>}
                      </span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>

            {/* ترقيم */}
            <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-4 py-2.5 text-t-sm">
              <span className="tnum text-text-dim">{(page - 1) * size + 1}–{Math.min(page * size, data?.total ?? 0)} {c("of")} {data?.total ?? 0}</span>
              <div className="flex items-center gap-2">
                <select value={size} onChange={(e) => { setSize(Number(e.target.value)); setPage(1); }} aria-label={c("rows")} className="rounded-lg border border-line bg-ink-2 px-2 py-1 text-t-sm">
                  {[10, 25, 50, 100].map((n) => <option key={n} value={n}>{n} {c("rows")}</option>)}
                </select>
                <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage(page - 1)}><MIcon name="chevron_right" className="!text-[18px] ltr:rotate-180" />{c("prev")}</Button>
                <span className="tnum text-text-dim">{page} / {pages}</span>
                <Button size="sm" variant="outline" disabled={page >= pages} onClick={() => setPage(page + 1)}>{c("next")}<MIcon name="chevron_left" className="!text-[18px] ltr:rotate-180" /></Button>
              </div>
            </footer>
          </>
        )}
      </div>

      <FiltersPanel open={filtersOpen} value={filters} onApply={(f) => { setFilters(f); setPage(1); }} onClose={() => setFiltersOpen(false)} />
      <CustomerForm open={!!form} customer={form?.customer} onClose={() => setForm(null)}
        onSaved={(saved) => { const isNew = !form?.customer; setForm(null); cache.clear(); if (isNew) router.push(`/customers/${saved.id}`); else load(true); }} />
    </div>
  );

  function cell(key: ColKey, r: CustomerRow) {
    switch (key) {
      case "customer": return (
        <div className="flex items-center gap-3">
          <Avatar name={r.name} size={dense ? 28 : 36} />
          <div className="min-w-0">
            <Link href={`/customers/${r.id}`} className="block max-w-[260px] truncate font-extrabold hover:text-petrol hover:underline">{r.name}</Link>
            <div className="flex items-center gap-1.5 text-t-xs text-text-dim"><span className="tnum">{r.no}</span>
              {r.segment === "vip" && <SegmentBadge seg="vip" />}{r.isCredit && <SegmentBadge seg="credit" />}</div>
          </div>
        </div>);
      case "phone": return <span dir="ltr" className="tnum inline-block text-text-dim">{r.phone || "—"}</span>;
      case "type": return <span className="text-text-dim">{r.type === "company" ? c("company") : c("individual")}</span>;
      case "last": return <span title={fmtD(r.lastAt)} className="whitespace-nowrap text-text-dim">{ago(r.lastAt, isEn)}</span>;
      case "sales": return r.sales == null ? "—" : <Link href={`/sales/history?customer=${encodeURIComponent(r.name)}`} className="tnum font-bold hover:text-petrol hover:underline">{fmtCurrency(r.sales, 2)}</Link>;
      case "paid": return <span className="tnum text-text-dim">{r.paid == null ? "—" : fmtCurrency(r.paid, 2)}</span>;
      case "balance": return r.balance == null ? "—" : (
        <div>
          <Link href={`/customers/${r.id}?tab=statement`} className={`tnum font-extrabold hover:underline ${r.balance > 0 ? "text-ember" : "text-text-dim"}`}>{fmtCurrency(r.balance, 2)}</Link>
          {(r.overdue ?? 0) > 0 && <div className="tnum text-t-xs font-bold text-ember">{c("st.overdue")}: {fmtCurrency(r.overdue, 2)}</div>}
        </div>);
      case "status": return <StatusBadge status={statusOf(r)} />;
      case "invoices": return <span className="tnum">{r.invoiceCount}</span>;
      case "vehicles": return <span className="tnum">{r.vehicles}</span>;
      case "created": return <span className="tnum whitespace-nowrap text-text-dim">{fmtD(r.createdAt)}</span>;
    }
  }
}
