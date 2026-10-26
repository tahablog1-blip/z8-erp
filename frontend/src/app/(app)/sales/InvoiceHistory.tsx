"use client";
// ═══ سجل الفواتير — بحث بأسلوب Zoho Books:
//     شريط أدوات: قائمة العرض (كل الفواتير / اليوم / آخر 7 أيام / هذا الشهر / مرتجعة / آجل) + بحث سريع
//     + "بحث متقدم" (رقم الفاتورة، العميل، اللوحة، النوع، الحالة، تاريخ، مبلغ) + شرائح الفلاتر الفعالة.
//     البحث على السيرفر وعلى كل الفواتير (مش بس آخر 50)، مع "عرض المزيد". ═══
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/lib/api";
import { Button, IconButton, Input, Select } from "@/components/ui";
import { MIcon } from "@/components/m-icon";
import { PlateBadge } from "@/components/PlateBadge";
import { Invoice } from "@/modules/invoices/types";
import { money } from "@/modules/products/types";

type Filters = {
  q: string; invoiceNo: string; customer: string; plate: string;
  source: "" | "pos" | "car"; status: "" | "active" | "returned" | "credit";
  from: string; to: string; min: string; max: string;
};
const EMPTY: Filters = { q: "", invoiceNo: "", customer: "", plate: "", source: "", status: "", from: "", to: "", min: "", max: "" };
const PAGE = 40;

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
function addDays(n: number) { const d = new Date(); d.setDate(d.getDate() + n); return d; }

const VIEWS: { key: string; label: string; icon: string; apply: () => Partial<Filters> }[] = [
  { key: "all", label: "كل الفواتير", icon: "receipt_long", apply: () => ({}) },
  { key: "today", label: "فواتير اليوم", icon: "today", apply: () => ({ from: iso(new Date()), to: iso(new Date()) }) },
  { key: "week", label: "آخر 7 أيام", icon: "date_range", apply: () => ({ from: iso(addDays(-6)), to: iso(new Date()) }) },
  { key: "month", label: "هذا الشهر", icon: "calendar_month", apply: () => { const d = new Date(); return { from: iso(new Date(d.getFullYear(), d.getMonth(), 1)), to: iso(d) }; } },
  { key: "credit", label: "بيع آجل", icon: "schedule", apply: () => ({ status: "credit" }) },
  { key: "returned", label: "مرتجعة", icon: "assignment_return", apply: () => ({ status: "returned" }) },
];

const STATUS_LABEL = { active: "سارية", returned: "مرتجعة", credit: "بها آجل" } as const;
const SOURCE_LABEL = { pos: "بيع مباشر", car: "خدمة سيارة" } as const;

function dateFmt(s: string): string {
  try {
    return new Date(s).toLocaleString(
      typeof document !== "undefined" && document.documentElement.lang === "en" ? "en-US" : "ar-SA-u-nu-latn",
      { dateStyle: "short", timeStyle: "short" });
  } catch { return s; }
}

function toQuery(f: Filters, offset: number): string {
  const p = new URLSearchParams({ limit: String(PAGE), offset: String(offset) });
  if (f.q.trim()) p.set("q", f.q.trim());
  if (f.invoiceNo.trim()) p.set("invoiceNo", f.invoiceNo.trim());
  if (f.customer.trim()) p.set("customer", f.customer.trim());
  if (f.plate.trim()) p.set("plate", f.plate.trim());
  if (f.source) p.set("source", f.source);
  if (f.status) p.set("status", f.status);
  if (f.from) p.set("from", f.from);
  if (f.to) p.set("to", f.to);
  if (f.min.trim() && !isNaN(Number(f.min))) p.set("minTotal", f.min.trim());
  if (f.max.trim() && !isNaN(Number(f.max))) p.set("maxTotal", f.max.trim());
  return p.toString();
}

/** شرائح الفلاتر الفعالة (ما عدا البحث السريع — ليه خانته) */
function chipsOf(f: Filters): { key: keyof Filters; label: string }[] {
  const out: { key: keyof Filters; label: string }[] = [];
  if (f.invoiceNo.trim()) out.push({ key: "invoiceNo", label: `الفاتورة: ${f.invoiceNo.trim()}` });
  if (f.customer.trim()) out.push({ key: "customer", label: `العميل: ${f.customer.trim()}` });
  if (f.plate.trim()) out.push({ key: "plate", label: `اللوحة: ${f.plate.trim()}` });
  if (f.source) out.push({ key: "source", label: SOURCE_LABEL[f.source] });
  if (f.status) out.push({ key: "status", label: STATUS_LABEL[f.status] });
  if (f.from || f.to) out.push({ key: "from", label: `التاريخ: ${f.from || "…"} ← ${f.to || "…"}` });
  if (f.min.trim() || f.max.trim()) out.push({ key: "min", label: `المبلغ: ${f.min.trim() || "0"} – ${f.max.trim() || "∞"}` });
  return out;
}

function StatusText({ inv }: { inv: Invoice }) {
  if (inv.is_returned)
    return <span className="inline-flex items-center gap-1.5 font-bold text-ember"><span className="h-2 w-2 rounded-full bg-ember" aria-hidden />مرتجعة</span>;
  return (
    <span className="inline-flex flex-col">
      <span className="inline-flex items-center gap-1.5 font-bold text-emerald"><span className="h-2 w-2 rounded-full bg-emerald" aria-hidden />سارية</span>
      {Number(inv.credit_total) > 0 && <span className="tnum text-[11px] font-bold text-brass">آجل {money(inv.credit_total)}</span>}
    </span>
  );
}

export function InvoiceHistory({ onOpen, onPrint, refreshKey }: {
  onOpen: (inv: Invoice) => void; onPrint: (id: string) => void; refreshKey?: unknown;
}) {
  const [f, setF] = useState<Filters>(EMPTY);
  const [draft, setDraft] = useState<Filters>(EMPTY);     // حقول لوحة البحث المتقدم قبل التطبيق
  const [rows, setRows] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [more, setMore] = useState(false);                // فيه صفحات تانية؟
  const [loadingMore, setLoadingMore] = useState(false);
  const [err, setErr] = useState("");
  const [viewOpen, setViewOpen] = useState(false);
  const [advOpen, setAdvOpen] = useState(false);
  const reqId = useRef(0);

  // البحث السريع: تأخير 300ms عشان ما نبعتش طلب مع كل حرف
  const [qInput, setQInput] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setF((p) => (p.q === qInput ? p : { ...p, q: qInput })), 300);
    return () => clearTimeout(t);
  }, [qInput]);

  const load = useCallback(async (filters: Filters, offset = 0) => {
    const id = ++reqId.current;
    if (offset === 0) setLoading(true); else setLoadingMore(true);
    setErr("");
    try {
      const page = await api<Invoice[]>(`/invoices?${toQuery(filters, offset)}`);
      if (id !== reqId.current) return;           // ردّ قديم — تجاهله
      setRows((prev) => (offset === 0 ? page : [...prev, ...page]));
      setMore(page.length === PAGE);
    } catch (e) {
      if (id === reqId.current) setErr(e instanceof Error ? e.message : "تعذّر تحميل الفواتير");
    } finally {
      if (id === reqId.current) { setLoading(false); setLoadingMore(false); }
    }
  }, []);

  useEffect(() => { load(f); }, [f, load, refreshKey]);

  // إغلاق القوائم بـ Esc
  useEffect(() => {
    if (!viewOpen && !advOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { setViewOpen(false); setAdvOpen(false); } };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [viewOpen, advOpen]);

  const chips = chipsOf(f);
  const activeView = useMemo(() => {
    const noQ = { ...f, q: "" };
    for (const v of VIEWS) {
      const want = { ...EMPTY, ...v.apply() };
      if ((Object.keys(EMPTY) as (keyof Filters)[]).every((k) => k === "q" || want[k] === noQ[k])) return v;
    }
    return null;
  }, [f]);

  function applyView(v: (typeof VIEWS)[number]) {
    const next = { ...EMPTY, ...v.apply(), q: f.q };
    setF(next); setDraft(next); setViewOpen(false);
  }
  function applyAdvanced() { setF({ ...draft, q: qInput }); setAdvOpen(false); }
  function clearAll() { setF(EMPTY); setDraft(EMPTY); setQInput(""); setAdvOpen(false); }
  function removeChip(key: keyof Filters) {
    const next = { ...f };
    if (key === "from") { next.from = ""; next.to = ""; }
    else if (key === "min") { next.min = ""; next.max = ""; }
    else (next as Record<string, string>)[key] = "";
    setF(next); setDraft(next);
  }

  const hasFilters = chips.length > 0 || f.q.trim() !== "";
  const total = rows.reduce((s, r) => s + (r.is_returned ? 0 : Number(r.total_inc)), 0);

  return (
    <div className="rounded-2xl border border-line bg-ink-2">
      {/* ═══ شريط الأدوات ═══ */}
      <div className="flex flex-wrap items-center gap-2 border-b border-line p-3">
        {/* قائمة العرض */}
        <div className="relative">
          <button onClick={() => { setViewOpen((v) => !v); setAdvOpen(false); }} aria-haspopup="listbox" aria-expanded={viewOpen}
            className="inline-flex items-center gap-2 rounded-xl border border-line px-3.5 py-2.5 text-[14px] font-extrabold transition hover:border-petrol">
            {activeView ? activeView.label : "نتائج البحث"}
            <MIcon name="expand_more" className="!text-[20px] text-text-dim" />
          </button>
          {viewOpen && (
            <>
              <div className="fixed inset-0 z-30" onClick={() => setViewOpen(false)} aria-hidden />
              <ul role="listbox" className="absolute right-0 z-40 mt-1.5 w-56 overflow-hidden rounded-xl border border-line bg-ink-2 py-1 shadow-panel">
                {VIEWS.map((v) => (
                  <li key={v.key}>
                    <button role="option" aria-selected={activeView?.key === v.key} onClick={() => applyView(v)}
                      className={`flex w-full items-center gap-2.5 px-3.5 py-2.5 text-right text-[13px] font-bold transition hover:bg-ink-3
                        ${activeView?.key === v.key ? "text-petrol" : ""}`}>
                      <MIcon name={v.icon} className="!text-[18px]" />{v.label}
                      {activeView?.key === v.key && <MIcon name="check" className="mr-auto !text-[16px]" />}
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>

        {/* البحث السريع + زر البحث المتقدم */}
        <div className="relative min-w-[240px] flex-1">
          <MIcon name="search" className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 !text-[19px] text-text-dim" />
          <Input aria-label="بحث في الفواتير" value={qInput} onChange={(e) => setQInput(e.target.value)}
            placeholder="ابحث برقم الفاتورة أو العميل أو الجوال أو اللوحة" className="!py-2.5 !pl-12 !pr-11" />
          <button onClick={() => { setDraft({ ...f, q: "" }); setAdvOpen((v) => !v); setViewOpen(false); }}
            aria-label="بحث متقدم" aria-expanded={advOpen} title="بحث متقدم"
            className={`absolute left-1.5 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-lg transition
              ${advOpen || chips.length ? "bg-petrol-soft text-petrol" : "text-text-dim hover:bg-ink-3 hover:text-petrol"}`}>
            <MIcon name="tune" className="!text-[19px]" />
          </button>

          {/* لوحة البحث المتقدم */}
          {advOpen && (
            <>
              <div className="fixed inset-0 z-30" onClick={() => setAdvOpen(false)} aria-hidden />
              <form role="dialog" aria-label="بحث متقدم"
                onSubmit={(e) => { e.preventDefault(); applyAdvanced(); }}
                className="absolute right-0 top-full z-40 mt-2 w-[min(580px,calc(100vw-2rem))] rounded-2xl border border-line bg-ink-2 p-4 shadow-panel">
                <div className="mb-3 flex items-center justify-between">
                  <h3 className="text-[14px] font-extrabold">بحث متقدم</h3>
                  <IconButton label="إغلاق" size="sm" type="button" onClick={() => setAdvOpen(false)}><MIcon name="close" className="!text-[17px]" /></IconButton>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="block">
                    <span className="mb-1.5 block text-[12px] font-bold text-text-dim">رقم الفاتورة</span>
                    <Input value={draft.invoiceNo} onChange={(e) => setDraft({ ...draft, invoiceNo: e.target.value })} placeholder="INV-000123" dir="ltr" className="text-right" />
                  </label>
                  <label className="block">
                    <span className="mb-1.5 block text-[12px] font-bold text-text-dim">رقم اللوحة</span>
                    <Input value={draft.plate} onChange={(e) => setDraft({ ...draft, plate: e.target.value })} placeholder="1288 HHR" dir="ltr" className="text-right uppercase" />
                  </label>
                  <label className="block sm:col-span-2">
                    <span className="mb-1.5 block text-[12px] font-bold text-text-dim">العميل أو الجوال</span>
                    <Input value={draft.customer} onChange={(e) => setDraft({ ...draft, customer: e.target.value })} />
                  </label>
                  <label className="block">
                    <span className="mb-1.5 block text-[12px] font-bold text-text-dim">نوع الفاتورة</span>
                    <Select value={draft.source} onChange={(e) => setDraft({ ...draft, source: e.target.value as Filters["source"] })}>
                      <option value="">الكل</option><option value="car">خدمة سيارة</option><option value="pos">بيع مباشر</option>
                    </Select>
                  </label>
                  <label className="block">
                    <span className="mb-1.5 block text-[12px] font-bold text-text-dim">الحالة</span>
                    <Select value={draft.status} onChange={(e) => setDraft({ ...draft, status: e.target.value as Filters["status"] })}>
                      <option value="">الكل</option><option value="active">سارية</option><option value="returned">مرتجعة</option><option value="credit">بها آجل</option>
                    </Select>
                  </label>
                  <label className="block">
                    <span className="mb-1.5 block text-[12px] font-bold text-text-dim">من تاريخ</span>
                    <Input type="date" value={draft.from} onChange={(e) => setDraft({ ...draft, from: e.target.value })} />
                  </label>
                  <label className="block">
                    <span className="mb-1.5 block text-[12px] font-bold text-text-dim">إلى تاريخ</span>
                    <Input type="date" value={draft.to} onChange={(e) => setDraft({ ...draft, to: e.target.value })} />
                  </label>
                  <label className="block">
                    <span className="mb-1.5 block text-[12px] font-bold text-text-dim">الإجمالي من (ر.س)</span>
                    <Input inputMode="decimal" value={draft.min} onChange={(e) => setDraft({ ...draft, min: e.target.value.replace(/[^0-9.]/g, "") })} className="tnum" />
                  </label>
                  <label className="block">
                    <span className="mb-1.5 block text-[12px] font-bold text-text-dim">الإجمالي إلى (ر.س)</span>
                    <Input inputMode="decimal" value={draft.max} onChange={(e) => setDraft({ ...draft, max: e.target.value.replace(/[^0-9.]/g, "") })} className="tnum" />
                  </label>
                </div>
                <div className="mt-4 flex items-center gap-2">
                  <Button type="submit"><MIcon name="search" className="!text-[17px]" /> بحث</Button>
                  <Button type="button" variant="ghost" onClick={() => setDraft({ ...EMPTY })}>مسح الحقول</Button>
                  <Button type="button" variant="ghost" className="mr-auto" onClick={() => setAdvOpen(false)}>إلغاء</Button>
                </div>
              </form>
            </>
          )}
        </div>

        <IconButton label="تحديث" onClick={() => load(f)} disabled={loading}>
          <MIcon name="refresh" className={`!text-[19px] ${loading ? "animate-spin" : ""}`} />
        </IconButton>
      </div>

      {/* ═══ شرائح الفلاتر الفعالة ═══ */}
      {hasFilters && (
        <div className="flex flex-wrap items-center gap-2 border-b border-line bg-ink-3/50 px-3 py-2">
          {f.q.trim() && (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-line bg-ink-2 py-1 pl-1.5 pr-3 text-[12px] font-bold">
              بحث: {f.q.trim()}
              <button aria-label="إزالة البحث" onClick={() => { setQInput(""); setF({ ...f, q: "" }); }} className="grid h-5 w-5 place-items-center rounded-full text-text-dim hover:bg-ink-3 hover:text-ember"><MIcon name="close" className="!text-[14px]" /></button>
            </span>
          )}
          {chips.map((c) => (
            <span key={c.key} className="inline-flex items-center gap-1.5 rounded-full border border-petrol/30 bg-petrol-soft py-1 pl-1.5 pr-3 text-[12px] font-bold text-petrol">
              {c.label}
              <button aria-label={`إزالة ${c.label}`} onClick={() => removeChip(c.key)} className="grid h-5 w-5 place-items-center rounded-full hover:bg-petrol/15"><MIcon name="close" className="!text-[14px]" /></button>
            </span>
          ))}
          <button onClick={clearAll} className="text-[12px] font-bold text-text-dim hover:text-ember">مسح الكل</button>
        </div>
      )}

      {err && (
        <div role="alert" className="flex items-center justify-between gap-3 border-b border-ember/30 bg-ember-bg px-4 py-3 text-[13px] font-bold text-ember">
          <span>{err}</span><Button size="sm" variant="danger" onClick={() => load(f)}>إعادة المحاولة</Button>
        </div>
      )}

      {/* ═══ الموبايل: بطاقات بدل الجدول العريض ═══ */}
      <ul className="divide-y divide-line md:hidden">
        {loading && Array.from({ length: 4 }).map((_, i) => (
          <li key={i} className="space-y-2 px-4 py-4" aria-hidden>
            <div className="h-3.5 w-1/3 animate-pulse rounded-full bg-ink-4/60" /><div className="h-3 w-2/3 animate-pulse rounded-full bg-ink-4/40" />
          </li>
        ))}
        {!loading && rows.length === 0 && (
          <li className="px-6 py-12 text-center">
            <MIcon name={hasFilters ? "search_off" : "receipt_long"} className="!text-[30px] text-text-dim" />
            <div className="mt-2 text-[14px] font-extrabold">{hasFilters ? "لا توجد فواتير مطابقة" : "لا توجد فواتير بعد"}</div>
            {hasFilters && <Button className="mt-3" variant="ghost" onClick={clearAll}>مسح الفلاتر</Button>}
          </li>
        )}
        {!loading && rows.map((inv) => (
          <li key={inv.id}>
            <div className="flex w-full items-start gap-3 px-4 py-3.5">
              <button onClick={() => onOpen(inv)} className="min-w-0 flex-1 text-right" aria-label={`فتح الفاتورة ${inv.invoice_no}`}>
                <div className="flex items-center justify-between gap-2">
                  <span className="tnum font-extrabold text-petrol">{inv.invoice_no}</span>
                  <span className={`tnum text-[15px] font-extrabold ${inv.is_returned ? "text-text-dim line-through" : ""}`}>{money(inv.total_inc)}</span>
                </div>
                <div className="mt-1 truncate text-[13px] font-bold">{inv.customer_name || <span className="font-medium text-text-dim">بيع نقدي</span>}</div>
                <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[12px] text-text-dim">
                  {inv.plate && <PlateBadge plate={inv.plate} size="sm" />}
                  <StatusText inv={inv} />
                  <span>{SOURCE_LABEL[inv.source] ?? inv.source}</span>
                  <span className="tnum">{dateFmt(inv.issued_at)}</span>
                </div>
              </button>
              <IconButton label={`طباعة ${inv.invoice_no}`} size="sm" onClick={() => onPrint(inv.id)}><MIcon name="print" className="!text-[17px]" /></IconButton>
            </div>
          </li>
        ))}
      </ul>

      {/* ═══ الجدول (الشاشات المتوسطة وأكبر) ═══ */}
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full min-w-[820px] text-[13px]">
          <thead>
            <tr className="border-b border-line bg-ink-3 text-text-dim">
              {["التاريخ", "رقم الفاتورة", "العميل", "السيارة", "النوع", "الحالة"].map((h) => (
                <th key={h} className="whitespace-nowrap px-3.5 py-3 text-right text-[12px] font-extrabold">{h}</th>
              ))}
              <th className="whitespace-nowrap px-3.5 py-3 text-left text-[12px] font-extrabold">الإجمالي</th>
              <th className="w-14" />
            </tr>
          </thead>
          <tbody>
            {loading && Array.from({ length: 6 }).map((_, i) => (
              <tr key={i} className="border-b border-line/60" aria-hidden>
                {Array.from({ length: 8 }).map((__, j) => (
                  <td key={j} className="px-3.5 py-4"><div className="h-3.5 animate-pulse rounded-full bg-ink-4/60" style={{ width: `${50 + ((i + j) * 13) % 45}%` }} /></td>
                ))}
              </tr>
            ))}
            {!loading && rows.length === 0 && (
              <tr><td colSpan={8} className="px-6 py-16 text-center">
                <MIcon name={hasFilters ? "search_off" : "receipt_long"} className="!text-[34px] text-text-dim" />
                <div className="mt-2 text-[14px] font-extrabold">{hasFilters ? "لا توجد فواتير مطابقة" : "لا توجد فواتير بعد"}</div>
                <p className="mx-auto mt-1 max-w-sm text-[12.5px] leading-relaxed text-text-dim">
                  {hasFilters ? "غيّر شروط البحث أو امسح الفلاتر لعرض كل الفواتير." : "الفواتير الصادرة ستظهر هنا."}
                </p>
                {hasFilters && <Button className="mt-3" variant="ghost" onClick={clearAll}>مسح الفلاتر</Button>}
              </td></tr>
            )}
            {!loading && rows.map((inv) => (
              <tr key={inv.id} tabIndex={0} onClick={() => onOpen(inv)}
                onKeyDown={(e) => { if (e.key === "Enter") onOpen(inv); }}
                className="group cursor-pointer border-b border-line/60 transition-colors hover:bg-ink-3 focus-visible:bg-ink-3 focus-visible:outline-none">
                <td className="whitespace-nowrap px-3.5 py-3.5 text-[12.5px] text-text-dim tnum">{dateFmt(inv.issued_at)}</td>
                <td className="px-3.5 py-3.5"><span className="tnum font-extrabold text-petrol group-hover:underline">{inv.invoice_no}</span></td>
                <td className="px-3.5 py-3.5">
                  <div className="font-bold">{inv.customer_name || <span className="font-medium text-text-dim">بيع نقدي</span>}</div>
                  {inv.customer_phone && <div dir="ltr" className="tnum text-right text-[11.5px] text-text-dim">{inv.customer_phone}</div>}
                </td>
                <td className="px-3.5 py-3.5">{inv.plate ? <PlateBadge plate={inv.plate} size="sm" /> : <span className="text-text-dim">—</span>}</td>
                <td className="whitespace-nowrap px-3.5 py-3.5 text-text-dim">{SOURCE_LABEL[inv.source] ?? inv.source}</td>
                <td className="px-3.5 py-3.5"><StatusText inv={inv} /></td>
                <td className="whitespace-nowrap px-3.5 py-3.5 text-left tnum text-[14px] font-extrabold">
                  <span className={inv.is_returned ? "text-text-dim line-through" : ""}>{money(inv.total_inc)}</span>
                </td>
                <td className="px-2 py-2 text-left">
                  <span className="opacity-0 transition focus-within:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100">
                    <IconButton label={`طباعة ${inv.invoice_no}`} size="sm" onClick={(e) => { e.stopPropagation(); onPrint(inv.id); }}>
                      <MIcon name="print" className="!text-[17px]" />
                    </IconButton>
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ═══ التذييل: العدد + إجمالي المعروض + عرض المزيد ═══ */}
      {!loading && rows.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-4 py-3 text-[12.5px] text-text-dim">
          <span className="tnum">
            {rows.length} فاتورة{more ? "+" : ""} · إجمالي المعروض (دون المرتجع) <b className="text-text">{money(total)}</b> ر.س
          </span>
          {more && <Button size="sm" variant="ghost" loading={loadingMore} onClick={() => load(f, rows.length)}>عرض المزيد</Button>}
        </div>
      )}
    </div>
  );
}
