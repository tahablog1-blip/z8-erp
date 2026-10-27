"use client";
// مكوّنات مشتركة لكل تقارير مركز التقارير: ترويسة موحّدة، شريط فلاتر موحّد (فترة + فرع)، أدوات (تحديث/تصدير/طباعة)، حالات تحميل/فراغ/خطأ.
// لا حسابات مالية هنا: الأرقام كلها من الخادم، والواجهة تعرض وتنسّق فقط.
import Link from "next/link";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { api } from "@/lib/api";
import { Badge, Button, EmptyState, ErrorNote, PageHeader } from "@/components/ui";
import { Skeleton } from "@/components/dashboard/Widget";
import { MIcon } from "@/components/m-icon";
import { formatNumber } from "@/lib/format";
import { downloadCsv } from "@/lib/customers/format";
import { printReport, tableHTML, kpisHTML } from "@/lib/print";
import { getCompany } from "@/lib/company";
import { rangeFor } from "@/lib/dashboard/periods";

// ── تنسيق موحّد للعملة والنسب والتاريخ ──
export const cur = (n: number | null | undefined) => (n == null ? "—" : `${formatNumber(n, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ر.س`);
export const num = (n: number | null | undefined) => (n == null ? "—" : formatNumber(n, { minimumFractionDigits: 0, maximumFractionDigits: 0 }));
export const pct = (n: number | null | undefined) => (n == null ? "—" : `${n > 0 ? "+" : ""}${n.toFixed(1)}%`);
export const dateAr = (s: string | null | undefined) => (s ? new Date(s).toLocaleDateString("en-GB") : "—");

/** رقم مالي: السالب بعلامة ولون خطر دلالي فقط عند السالب (لا تلوين للموجب) */
export function Money({ v, strong }: { v: number | null | undefined; strong?: boolean }) {
  if (v == null) return <span className="text-text-dim">—</span>;
  return <span dir="ltr" className={`tnum inline-block ${v < 0 ? "text-ember" : ""} ${strong ? "font-black" : ""}`}>{v < 0 ? "-" : ""}{cur(Math.abs(v))}</span>;
}

// ── الفترات (بتوقيت الجهاز كما في بقية النظام؛ الخادم يفسّر التواريخ بتوقيت الرياض) ──
type PKey = "today" | "yesterday" | "week" | "prevWeek" | "month" | "prevMonth" | "quarter" | "year" | "custom";
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
export const REPORT_PERIODS: { key: Exclude<PKey, "custom">; ar: string }[] = [
  { key: "today", ar: "اليوم" }, { key: "yesterday", ar: "أمس" }, { key: "week", ar: "هذا الأسبوع" }, { key: "prevWeek", ar: "الأسبوع السابق" },
  { key: "month", ar: "هذا الشهر" }, { key: "prevMonth", ar: "الشهر السابق" }, { key: "quarter", ar: "هذا الربع" }, { key: "year", ar: "هذه السنة" },
];
export function rangeOf(key: Exclude<PKey, "custom">): { from: string; to: string } {
  const now = new Date();
  if (key === "yesterday") { const d = new Date(now); d.setDate(d.getDate() - 1); return { from: iso(d), to: iso(d) }; }
  if (key === "prevWeek") { const w = rangeFor("week"); const s = new Date(w.from + "T00:00:00"); s.setDate(s.getDate() - 7); const e = new Date(s); e.setDate(e.getDate() + 6); return { from: iso(s), to: iso(e) }; }
  return rangeFor(key);
}
export type Filters = { key: PKey; from: string; to: string; branchId: string };
export const defaultFilters = (): Filters => ({ key: "month", ...rangeOf("month"), branchId: "" });

const LS = "z8_report_filters";
/** الفلاتر تُحفظ بين التقارير (الفترة والفرع فقط) — كل تقرير يستخدم ما يدعمه منها */
export function useFilters(): [Filters, (f: Filters) => void] {
  const [f, setF] = useState<Filters>(defaultFilters);
  useEffect(() => { try { const s = JSON.parse(localStorage.getItem(LS) || "null"); if (s?.from && s?.to) setF({ ...defaultFilters(), ...s }); } catch { /* تجاهل */ } }, []);
  return [f, (n) => { setF(n); try { localStorage.setItem(LS, JSON.stringify(n)); } catch { /* تجاهل */ } }];
}

export function ReportFilters({ value, onChange, branches = true, period = true, lockedBranch }: {
  value: Filters; onChange: (f: Filters) => void; branches?: boolean; period?: boolean; lockedBranch?: boolean;
}) {
  const [bl, setBl] = useState<{ id: string; name: string }[]>([]);
  useEffect(() => { if (branches) api<{ id: string; name: string }[]>("/branches").then(setBl).catch(() => setBl([])); }, [branches]);
  const [custom, setCustom] = useState(value.key === "custom");
  const chip = (on: boolean) => `rounded-full border px-3 py-1 text-t-xs font-bold ${on ? "border-petrol bg-petrol text-white" : "border-line bg-ink-2 text-text-dim hover:border-petrol"}`;
  return (
    <div className="space-y-2 rounded-card border border-line bg-ink-2 p-3 shadow-card" role="group" aria-label="فلاتر التقرير">
      {period && (
        <div className="flex flex-wrap items-center gap-1.5">
          {REPORT_PERIODS.map((p) => <button key={p.key} aria-pressed={value.key === p.key} className={chip(value.key === p.key)}
            onClick={() => { setCustom(false); onChange({ ...value, key: p.key, ...rangeOf(p.key) }); }}>{p.ar}</button>)}
          <button aria-pressed={value.key === "custom"} className={chip(value.key === "custom")} onClick={() => setCustom((c) => !c)}>
            <MIcon name="date_range" className="mb-0.5 me-1 !text-[14px]" />مخصص</button>
          {(custom || value.key === "custom") && (
            <span className="flex items-center gap-1">
              <input type="date" aria-label="من" value={value.from} max={value.to} className="h-8 rounded-lg border border-line bg-ink-2 px-2 text-t-xs"
                     onChange={(e) => e.target.value && onChange({ ...value, key: "custom", from: e.target.value })} />
              <span className="text-text-dim">→</span>
              <input type="date" aria-label="إلى" value={value.to} min={value.from} className="h-8 rounded-lg border border-line bg-ink-2 px-2 text-t-xs"
                     onChange={(e) => e.target.value && onChange({ ...value, key: "custom", to: e.target.value })} />
            </span>
          )}
        </div>
      )}
      {branches && (
        <div className="flex flex-wrap items-center gap-2">
          <label className="text-t-xs font-bold text-text-dim" htmlFor="rpt-branch">الفرع</label>
          <select id="rpt-branch" disabled={lockedBranch} value={value.branchId} onChange={(e) => onChange({ ...value, branchId: e.target.value })}
                  className="h-8 rounded-lg border border-line bg-ink-2 px-2 text-t-xs font-bold disabled:bg-ink-3">
            <option value="">كل الفروع</option>{bl.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
          {lockedBranch && <Badge tone="info">حسابك مقيَّد بفرعك</Badge>}
        </div>
      )}
    </div>
  );
}

// ── جلب تقرير من الخادم (قراءة فقط) ──
type Meta = { from: string; to: string; branchId: string | null; branchLocked: boolean; generatedAt: string };
export function useReport<T extends { meta?: Meta }>(path: string, f: Filters, opts: { branch?: boolean; period?: boolean; extra?: string } = {}) {
  const { branch = true, period = true, extra = "" } = opts;
  const url = useMemo(() => {
    const p = new URLSearchParams();
    if (period) { p.set("from", f.from); p.set("to", f.to); }
    if (branch && f.branchId) p.set("branchId", f.branchId);
    return `${path}?${p.toString()}${extra}`;
  }, [path, f.from, f.to, f.branchId, branch, period, extra]);
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    setLoading(true); setError("");
    api<T>(url).then((d) => live && setData(d)).catch((e: unknown) => live && setError(e instanceof Error ? e.message : "تعذر تحميل التقرير")).finally(() => live && setLoading(false));
    return () => { live = false; };
  }, [url, tick]);
  return { data, loading, error, reload: () => setTick((t) => t + 1) };
}

// ── حالات ──
export function ReportSkeleton() {
  return (
    <div className="space-y-3" aria-busy>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="rounded-card border border-line bg-ink-2 p-4"><Skeleton className="mb-3 w-1/2" height={12} /><Skeleton className="w-3/4" height={24} /></div>)}</div>
      <div className="rounded-card border border-line bg-ink-2 p-4"><Skeleton className="mb-2 w-full" height={14} /><Skeleton className="mb-2 w-full" height={14} /><Skeleton className="w-2/3" height={14} /></div>
    </div>
  );
}
export const ReportEmpty = () => <EmptyState icon="query_stats" title="لا توجد بيانات" description="لم يتم العثور على بيانات للفترة المحددة. جرّب تغيير الفترة أو الفلاتر." />;
export const ReportError = ({ msg, onRetry }: { msg: string; onRetry: () => void }) => (
  <div className="space-y-2 rounded-card border border-ember/30 bg-ember-bg p-4"><div className="font-black text-ember">تعذر تحميل التقرير</div><ErrorNote msg={msg} /><Button variant="ghost" onClick={onRetry}>إعادة المحاولة</Button></div>
);

// ── ترويسة التقرير ──
export function ReportHeader({ title, description, meta, actions, back = true }: { title: string; description: string; meta?: Meta | null; actions?: ReactNode; back?: boolean }) {
  return (
    <div className="space-y-2">
      <PageHeader title={title} description={description} actions={<>{actions}{back && <Link href="/reports"><Button variant="ghost" size="sm">← مركز التقارير</Button></Link>}</>} />
      {meta && (
        <div className="flex flex-wrap gap-x-5 gap-y-1 text-t-xs text-text-dim">
          <span>الفترة: <b className="tnum text-text">{dateAr(meta.from)} – {dateAr(meta.to)}</b></span>
          <span>الفرع: <b className="text-text">{meta.branchLocked ? "فرعك" : meta.branchId ? "فرع محدد" : "كل الفروع"}</b></span>
          <span>أُنشئ: <b className="tnum text-text">{new Date(meta.generatedAt).toLocaleString("en-GB", { hour12: false, dateStyle: "short", timeStyle: "short" })}</b></span>
        </div>
      )}
    </div>
  );
}

/** أدوات: تحديث + تصدير (Excel/CSV) + طباعة/PDF — تُعرض فقط لما هو مدعوم فعلاً */
export function ReportToolbar({ onRefresh, csv, print }: {
  onRefresh: () => void;
  csv?: { file: string; headers: string[]; rows: (string | number | null)[][] } | null;
  print?: { title: string; subtitle: string; body: () => string } | null;
}) {
  const co = getCompany();
  return (
    <div className="flex flex-wrap items-center gap-1.5" role="toolbar" aria-label="أدوات التقرير">
      <Button variant="ghost" size="sm" onClick={onRefresh}>تحديث</Button>
      {csv && <Button variant="ghost" size="sm" onClick={() => downloadCsv(csv.file, csv.headers, csv.rows)} title="يُفتح في Excel">تصدير Excel / CSV</Button>}
      {print && <Button variant="ghost" size="sm" onClick={() => printReport(print.title, print.subtitle + (co?.name ? ` · ${co.name}` : "") + ` · طُبع: ${new Date().toLocaleString("en-GB", { hour12: false })}`, print.body())} title="يُفتح حوار الطباعة — اختر «حفظ كـ PDF»">طباعة / PDF</Button>}
    </div>
  );
}
export { tableHTML, kpisHTML };

export function Kpi({ label, value, tone = "neutral", sub }: { label: string; value: ReactNode; tone?: "neutral" | "danger" | "success"; sub?: string }) {
  return (
    <div className="min-w-0 rounded-card border border-line bg-ink-2 p-3.5 shadow-card">
      <div className="truncate text-t-sm font-bold text-text-dim">{label}</div>
      <div className={`tnum mt-1 text-t-xl font-black leading-tight ${tone === "danger" ? "text-ember" : tone === "success" ? "text-emerald" : ""}`}>{value}</div>
      {sub && <div className="mt-0.5 truncate text-t-xs font-bold text-text-dim">{sub}</div>}
    </div>
  );
}

/** جدول تقرير موحّد: فرز بالنقر على العنوان، تمرير أفقي على الشاشات الصغيرة، صف إجماليات اختياري */
export type Col<T> = { key: string; title: string; num?: boolean; render?: (r: T) => ReactNode; value?: (r: T) => string | number };
export function ReportTable<T extends Record<string, unknown>>({ cols, rows, footer, empty = true }: { cols: Col<T>[]; rows: T[]; footer?: ReactNode; empty?: boolean }) {
  const [sort, setSort] = useState<{ k: string; d: 1 | -1 } | null>(null);
  const shown = useMemo(() => {
    if (!sort) return rows;
    const c = cols.find((x) => x.key === sort.k);
    const val = (r: T) => (c?.value ? c.value(r) : (r[sort.k] as string | number));
    return [...rows].sort((a, b) => { const x = val(a), y = val(b); return (typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y), "ar")) * sort.d; });
  }, [rows, sort, cols]);
  if (!rows.length) return empty ? <ReportEmpty /> : null;
  return (
    <div className="overflow-x-auto rounded-lg border border-line">
      <table className="w-full min-w-[560px] border-collapse text-t-sm">
        <thead className="bg-ink-3 text-t-xs text-text-dim">
          <tr>{cols.map((c) => (
            <th key={c.key} className={`p-2.5 font-bold ${c.num ? "text-end" : "text-start"}`} aria-sort={sort?.k === c.key ? (sort.d === 1 ? "ascending" : "descending") : undefined}>
              <button type="button" className="inline-flex items-center gap-1 hover:text-petrol" onClick={() => setSort((s) => (s?.k === c.key ? { k: c.key, d: (s.d * -1) as 1 | -1 } : { k: c.key, d: c.num ? -1 : 1 }))}>
                {c.title}{sort?.k === c.key && <span aria-hidden>{sort.d === 1 ? "▲" : "▼"}</span>}</button></th>))}</tr>
        </thead>
        <tbody>{shown.map((r, i) => (
          <tr key={i} className="border-t border-line hover:bg-ink-3/50">{cols.map((c) => <td key={c.key} className={`p-2.5 ${c.num ? "tnum text-end" : ""}`}>{c.render ? c.render(r) : String(r[c.key] ?? "—")}</td>)}</tr>))}</tbody>
        {footer && <tfoot className="border-t-2 border-line bg-ink-3/60 font-black">{footer}</tfoot>}
      </table>
    </div>
  );
}

/** حفظ التقرير بفلاتره الحالية في «تقاريري المحفوظة» (على حساب المستخدم في الخادم) */
export function SaveReportButton({ reportId, filters }: { reportId: string; filters: Filters }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [msg, setMsg] = useState("");
  async function save() {
    try {
      const cur = await api<{ saved: { id: string | null; reportId: string; name: string; filters: Record<string, string> }[] }>("/reports/prefs");
      const item = { id: String(Date.now()), reportId, name: name.trim(), filters: { ...filters } };
      await api("/reports/prefs", { method: "PUT", body: JSON.stringify({ saved: [...cur.saved, item] }) });
      setMsg("تم الحفظ في تقاريري المحفوظة"); setOpen(false); setName("");
    } catch (e: unknown) { setMsg(e instanceof Error ? e.message : "تعذر الحفظ"); }
  }
  return (
    <span className="inline-flex items-center gap-1.5">
      {open ? (<>
        <input autoFocus value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder="اسم التقرير المحفوظ" aria-label="اسم التقرير المحفوظ"
               className="h-8 w-44 rounded-lg border border-line bg-ink-2 px-2 text-t-xs" />
        <Button size="sm" disabled={name.trim().length < 2} onClick={save}>حفظ</Button>
        <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>إلغاء</Button>
      </>) : <Button size="sm" variant="ghost" onClick={() => { setMsg(""); setOpen(true); }}>حفظ بفلاتري</Button>}
      {msg && <span className="text-t-xs font-bold text-text-dim" role="status">{msg}</span>}
    </span>
  );
}
