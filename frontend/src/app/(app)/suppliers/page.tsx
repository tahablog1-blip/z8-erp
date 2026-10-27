"use client";
// الموردون — مركز قيادة الموردين والحسابات الدائنة. قراءة وعرض؛ الإنشاء/التعديل/السداد عبر مسارات الموردين القائمة (الرصيد والقيود من الباك اند).
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { MIcon } from "@/components/m-icon";
import { Badge, Button, EmptyState, ErrorNote, Input, Select, Tabs } from "@/components/ui";
import { KpiCard, KpiSkeleton } from "@/components/dashboard/KpiCard";
import { Skeleton } from "@/components/dashboard/Widget";
import { appAlert, appConfirm } from "@/components/dialog";
import { SupplierForm, EMPTY_SUPPLIER, type SupplierFormValues } from "@/components/suppliers/SupplierForm";
import { Money, Panel, PeriodPicker, fmtD, fmtM, fmtN, qs, useDebounced, useFetch, type Period } from "@/components/inventory/shared";
import { PERIODS, rangeFor } from "@/lib/dashboard/periods";
import { downloadCsv } from "@/lib/customers/format";
import { kpisHTML, printReport, tableHTML } from "@/lib/print";
import { BUCKET_TONE, type Payable, type SupOverview, type SupRow } from "@/lib/suppliers/types";

type ColKey = "supplier" | "phone" | "vat" | "category" | "purchases" | "paid" | "balance" | "overdue" | "invoices" | "last" | "status";
const COLS: { key: ColKey; label: string; sort?: string; def: boolean; num?: boolean }[] = [
  { key: "supplier", label: "المورد", sort: "name", def: true },
  { key: "phone", label: "الجوال", def: true },
  { key: "vat", label: "الرقم الضريبي", def: false },
  { key: "category", label: "التصنيف", def: false },
  { key: "purchases", label: "المشتريات", sort: "purchases", def: true, num: true },
  { key: "paid", label: "المدفوع", sort: "paid", def: true, num: true },
  { key: "balance", label: "المستحق", sort: "balance", def: true, num: true },
  { key: "overdue", label: "المتأخر", sort: "overdue", def: true, num: true },
  { key: "invoices", label: "عدد الفواتير", sort: "invoices", def: false, num: true },
  { key: "last", label: "آخر شراء", sort: "last", def: false },
  { key: "status", label: "الحالة", def: true },
];
const CHIPS: { key: string; label: string }[] = [
  { key: "", label: "الكل" }, { key: "payable", label: "عليه مستحقات" }, { key: "overdue", label: "متأخر" },
  { key: "zero", label: "بدون رصيد" }, { key: "advance", label: "دفعة مقدمة" },
];
const COL_KEY = "z8_sup_cols";
const PERIOD_KEYS = ["today", "week", "month", "quarter", "year"];
type Tab = "list" | "payables" | "top";

function Avatar({ name }: { name: string }) {
  return <span aria-hidden className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-petrol-soft text-t-sm font-black text-petrol">{(name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join("") || "؟").toUpperCase()}</span>;
}

export default function SuppliersPage() {
  const { hasPerm } = useAuth();
  const router = useRouter();
  const canEdit = hasPerm("purchasing.suppliers");
  const canInvoice = hasPerm("purchasing.invoices");
  const [tab, setTab] = useState<Tab>("list");
  const [period, setPeriod] = useState<Period>({ key: "month", ...rangeFor("month") });
  const [q, setQ] = useState(""); const dq = useDebounced(q);
  const [status, setStatus] = useState("active");
  const [chip, setChip] = useState("");
  const [category, setCategory] = useState("");
  const [sort, setSort] = useState("name"); const [dir, setDir] = useState<"asc" | "desc">("asc");
  const [page, setPage] = useState(1); const [size, setSize] = useState(25);
  const [cols, setCols] = useState<Set<ColKey>>(new Set(COLS.filter((c) => c.def).map((c) => c.key)));
  const [colsOpen, setColsOpen] = useState(false);
  const [sel, setSel] = useState<Map<string, SupRow>>(new Map());
  const [cats, setCats] = useState<string[]>([]);
  const [form, setForm] = useState<{ open: boolean; id: string | null; initial: SupplierFormValues }>({ open: false, id: null, initial: EMPTY_SUPPLIER });
  const [bucket, setBucket] = useState("");
  const [onlyOverdue, setOnlyOverdue] = useState(false);
  const [topBy, setTopBy] = useState<"purchases" | "invoices">("purchases");

  useEffect(() => { try { const s = localStorage.getItem(COL_KEY); if (s) setCols(new Set(JSON.parse(s))); } catch { /* */ } }, []);
  useEffect(() => { api<string[]>("/suppliers/overview/categories").then(setCats).catch(() => undefined); }, []);
  useEffect(() => setPage(1), [dq, status, chip, category, sort, dir, size, period.from, period.to]);

  const query = qs({ q: dq, status, filter: chip, category, sort, dir, page, pageSize: size, from: period.from, to: period.to });
  const main = useFetch<SupOverview>(`/suppliers/overview?${query}`);
  const top = useFetch<SupOverview>(tab === "top" ? `/suppliers/overview?${qs({ sort: topBy, dir: "desc", pageSize: 10, from: period.from, to: period.to })}` : null);
  const pay = useFetch<Payable[]>(tab === "payables" ? `/suppliers/payables?${qs({ bucket, overdue: onlyOverdue ? "true" : "" })}` : null);
  const ov = main.data; const k = ov?.kpis;
  const visible = COLS.filter((c) => cols.has(c.key));
  const pages = ov ? Math.max(1, Math.ceil(ov.total / ov.pageSize)) : 1;

  const toggleCol = (key: ColKey) => setCols((o) => { const n = new Set(o); if (n.has(key)) n.delete(key); else n.add(key); try { localStorage.setItem(COL_KEY, JSON.stringify([...n])); } catch { /* */ } return n; });
  const toggleSort = (s?: string) => { if (!s) return; if (sort === s) setDir((d) => (d === "asc" ? "desc" : "asc")); else { setSort(s); setDir("asc"); } };
  const toggleSel = (r: SupRow) => setSel((o) => { const n = new Map(o); if (n.has(r.id)) n.delete(r.id); else n.set(r.id, r); return n; });

  const fetchAll = useCallback(async () => {
    const out: SupRow[] = [];
    for (let p = 1; p <= 30; p++) {
      const r = await api<SupOverview>(`/suppliers/overview?${qs({ q: dq, status, filter: chip, category, sort, dir, page: p, pageSize: 100, from: period.from, to: period.to })}`);
      out.push(...r.items); if (out.length >= r.total) break;
    }
    return out;
  }, [dq, status, chip, category, sort, dir, period.from, period.to]);

  async function exportCsv(selected = false) {
    try {
      const rows = selected ? [...sel.values()] : await fetchAll();
      downloadCsv(`suppliers-${new Date().toISOString().slice(0, 10)}.csv`, ["المورد", "الجوال", "الرقم الضريبي", "التصنيف", "المشتريات", "المدفوع", "المستحق", "المتأخر", "فواتير الفترة", "آخر شراء", "الحالة"],
        rows.map((r) => [r.name, r.phone, r.vatNumber, r.category, r.purchases, r.paid, r.balance, r.overdue, r.invoiceCount, r.lastPurchase, r.active ? "نشط" : "غير نشط"]));
    } catch (e) { await appAlert(e instanceof Error ? e.message : "تعذر التصدير"); }
  }
  async function printList() {
    try {
      const rows = await fetchAll();
      printReport("قائمة الموردين", `${period.from} → ${period.to} · ${rows.length} مورد`,
        (k ? kpisHTML([{ label: "المشتريات", value: fmtM(k.purchases) }, { label: "المدفوعات", value: fmtM(k.paid) }, { label: "المستحق للموردين", value: fmtM(k.payable) }, { label: "المتأخر", value: fmtM(k.overdue) }]) : "")
        + tableHTML(["المورد", "الجوال", "المشتريات", "المدفوع", "المستحق", "المتأخر"], rows.map((r) => [r.name, r.phone || "—", fmtM(r.purchases), fmtM(r.paid), fmtM(r.balance), fmtM(r.overdue)]), { numericCols: [2, 3, 4, 5] }));
    } catch (e) { await appAlert(e instanceof Error ? e.message : "تعذرت الطباعة"); }
  }
  function printAging() {
    if (!ov || !k) return;
    printReport("أعمار الديون", `إجمالي المستحق على الفواتير ${fmtM(k.invoiceOutstanding)} · ${new Date().toLocaleDateString("en-GB")}`,
      tableHTML(["الفئة", "عدد الفواتير", "المبلغ"], ov.aging.map((a) => [a.label, a.count, fmtM(a.amount)]), { numericCols: [1, 2] }));
  }
  function printPayables() {
    if (!pay.data) return;
    printReport("تقرير المستحقات", `${pay.data.length} فاتورة غير مسددة`, tableHTML(["المورد", "الفاتورة", "الاستحقاق", "المتأخر (يوم)", "الإجمالي", "المتبقي"],
      pay.data.map((p) => [p.supplier, p.invoiceNo, p.dueDate ? fmtD(p.dueDate) : "—", p.daysLate || "—", fmtM(p.total), fmtM(p.outstanding)]), { numericCols: [3, 4, 5] }));
  }

  function openCreate() { setForm({ open: true, id: null, initial: EMPTY_SUPPLIER }); }
  async function openEdit(r: SupRow) {
    try {
      const d = await api<{ supplier: { name: string; phone: string | null; vatNumber: string | null; address: string | null; termsDays: number; category: string | null; rating: number | null; ratingNote: string | null } }>(`/suppliers/${r.id}/360`);
      const s = d.supplier;
      setForm({ open: true, id: r.id, initial: { name: s.name, phone: s.phone || "", vatNumber: s.vatNumber || "", address: s.address || "", paymentTermsDays: s.termsDays, category: s.category || "", rating: s.rating || 0, ratingNote: s.ratingNote || "" } });
    } catch (e) { await appAlert(e instanceof Error ? e.message : "تعذر فتح المورد"); }
  }
  async function setActive(rows: SupRow[], active: boolean) {
    const target = active ? rows.filter((r) => !r.active) : rows.filter((r) => r.active && Math.abs(r.balance) < 0.005);
    const skipped = rows.length - target.length;
    if (!target.length) { await appAlert(active ? "كل المحدد نشط بالفعل." : "لا يمكن تعطيل موردين عليهم رصيد؛ سدّد الرصيد أولاً."); return; }
    if (!(await appConfirm(`${active ? "تفعيل" : "تعطيل"} ${target.length} مورد؟${skipped ? ` (تخطّي ${skipped}${active ? "" : " لوجود رصيد أو لأنهم معطّلون"})` : ""} لا تُحذف أي بيانات أو معاملات.`))) return;
    try {
      for (const r of target) { if (active) await api(`/suppliers/${r.id}/activate`, { method: "POST" }); else await api(`/suppliers/${r.id}`, { method: "DELETE" }); }
      setSel(new Map()); main.reload();
    } catch (e) { await appAlert(e instanceof Error ? e.message : "تعذرت العملية"); main.reload(); }
  }

  const agingMax = Math.max(1, ...(ov?.aging.map((a) => a.amount) ?? [1]));
  const periodLabel = useMemo(() => PERIODS.find((p) => p.key === period.key)?.ar ?? "الفترة", [period.key]);

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-t-3xl font-black">الموردون</h1>
          <p className="mt-1 text-t-sm text-text-dim">إدارة الموردين والمشتريات والأرصدة والحسابات المستحقة والمدفوعات.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {canEdit && <Button onClick={openCreate}><MIcon name="add" className="!text-[16px]" />إضافة مورد</Button>}
          {canInvoice && <Link href="/purchases" className="m3 z8-anim-btn inline-flex items-center gap-1.5 rounded-lg border border-line bg-ink-2 px-4 py-2 text-[13px] font-semibold text-text hover:border-petrol hover:text-petrol"><MIcon name="receipt_long" className="!text-[16px]" />تسجيل فاتورة شراء</Link>}
          <Button variant="tool" onClick={() => exportCsv()} disabled={!ov?.total}><MIcon name="download" className="!text-[16px]" />تصدير</Button>
          <Button variant="tool" onClick={printList} disabled={!ov?.total}><MIcon name="print" className="!text-[16px]" />طباعة</Button>
        </div>
      </header>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-line bg-ink-2 px-3 py-2 shadow-card">
        <PeriodPicker value={period} onChange={setPeriod} keys={PERIOD_KEYS} />
        <p className="text-t-xs text-text-dim">الفترة (تاريخ الفاتورة وتاريخ الصرف) للمشتريات والمدفوعات فقط؛ المستحق والمتأخر لحظيان من الدفتر.</p>
      </div>

      {main.error && <div><ErrorNote msg="تعذر تحميل بيانات الموردين." /><Button size="sm" variant="outline" onClick={main.reload}>إعادة المحاولة</Button></div>}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {main.loading && !k ? Array.from({ length: 8 }).map((_, i) => <KpiSkeleton key={i} />) : k && (<>
          <KpiCard label="إجمالي الموردين" icon="groups" value={fmtN(k.total)} />
          <KpiCard label="الموردون النشطون" icon="verified_user" value={fmtN(k.active)} accent="var(--emerald)" />
          <KpiCard label={`المشتريات (${periodLabel})`} icon="shopping_cart" value={fmtM(k.purchases)} tip="إجمالي فواتير الشراء شاملة الضريبة بتاريخ الفاتورة" />
          <KpiCard label={`المدفوعات (${periodLabel})`} icon="payments" value={fmtM(k.paid)} accent="var(--emerald)" tip="سندات الصرف + المشتريات النقدية" />
          <KpiCard label="المستحق للموردين" icon="account_balance" value={fmtM(k.payable)} accent="var(--brass)" sub={k.advances > 0 ? `دفعات مقدمة ${fmtM(k.advances)}` : undefined} tip="مجموع أرصدة الموردين الموجبة من دفتر المورد" />
          <KpiCard label="المتأخر" icon="event_busy" value={fmtM(k.overdue)} accent="var(--ember)" subTone={k.overdueCount ? "danger" : "neutral"} sub={k.overdueCount ? `${k.overdueCount} فاتورة` : undefined} tip="فواتير آجلة تجاوزت تاريخ الاستحقاق" />
          <KpiCard label="مستحق خلال 7 أيام" icon="schedule" value={fmtM(k.dueSoon)} accent="var(--brass)" sub={k.dueSoonCount ? `${k.dueSoonCount} فاتورة` : undefined} />
          <KpiCard label="فواتير مستحقة" icon="receipt_long" value={fmtN(k.openInvoices)} sub={`متبقٍ ${fmtM(k.invoiceOutstanding)}`} tip="فواتير آجلة غير مسددة بالكامل" />
        </>)}
      </div>

      {/* الحسابات الدائنة + أعمار الديون */}
      <Panel title="أعمار الديون" icon="hourglass_bottom" actions={<Button variant="tool" size="xs" onClick={printAging} disabled={!ov}><MIcon name="print" className="!text-[14px]" />طباعة</Button>}>
        {!ov ? <Skeleton className="w-full" height={120} /> : (
          <div className="space-y-2">
            {ov.aging.map((a) => (
              <button key={a.key} onClick={() => { setBucket(bucket === a.key ? "" : a.key); setOnlyOverdue(false); setTab("payables"); }} className="grid w-full grid-cols-[70px_1fr_auto] items-center gap-3 text-start hover:opacity-90" aria-label={`${a.label}: ${fmtM(a.amount)}`}>
                <span dir="ltr" className="justify-self-start text-t-sm font-bold">{a.label}</span>
                <span className="h-3 overflow-hidden rounded-full bg-ink-3"><span className={`block h-full rounded-full ${BUCKET_TONE[a.key]}`} style={{ width: `${(a.amount / agingMax) * 100}%` }} /></span>
                <span className="tnum text-t-sm"><b>{fmtM(a.amount)}</b> <small className="text-text-dim">({a.count})</small></span>
              </button>
            ))}
            {k && Math.abs(k.unallocated) > 0.01 && (
              <p className="rounded-lg bg-brass-soft p-2 text-t-xs font-bold text-brass">فرق {fmtM(Math.abs(k.unallocated))} بين رصيد الدفتر ومتبقي الفواتير: {k.unallocated > 0 ? "دفعات سُجّلت على الحساب دون ربطها بفاتورة" : "رصيد الدفتر أعلى من متبقي الفواتير"}.</p>
            )}
            <p className="text-t-xs text-text-dim">الفئات حسب أيام التأخر عن تاريخ الاستحقاق؛ فاتورة بلا تاريخ استحقاق تُعد «حالي».</p>
          </div>
        )}
      </Panel>

      <Tabs value={tab} onChange={setTab} items={[{ key: "list", label: "الموردون" }, { key: "payables", label: "الحسابات المستحقة" }, { key: "top", label: "أعلى الموردين" }]} />

      {tab === "list" && (<>
        <div className="sticky top-0 z-20 flex flex-wrap items-center gap-2 rounded-card border border-line bg-ink-2/95 p-2.5 shadow-card backdrop-blur">
          <div className="relative min-w-[220px] flex-1">
            <MIcon name="search" className="pointer-events-none absolute top-1/2 -translate-y-1/2 text-text-dim rtl:right-3 ltr:left-3 !text-[18px]" />
            <Input className="rtl:!pr-9 ltr:!pl-9" value={q} onChange={(e) => setQ(e.target.value)} placeholder="بحث بالاسم / الجوال / الرقم الضريبي / التصنيف / العنوان" aria-label="بحث في الموردين" />
          </div>
          <Select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="الحالة" className="!w-auto"><option value="active">النشطون</option><option value="inactive">غير النشطين</option><option value="all">الكل</option></Select>
          {cats.length > 0 && <Select value={category} onChange={(e) => setCategory(e.target.value)} aria-label="التصنيف" className="!w-auto max-w-[170px]"><option value="">كل التصنيفات</option>{cats.map((c) => <option key={c} value={c}>{c}</option>)}</Select>}
          <div className="relative">
            <Button variant="tool" size="sm" onClick={() => setColsOpen((o) => !o)} aria-expanded={colsOpen}><MIcon name="view_column" className="!text-[16px]" />الأعمدة</Button>
            {colsOpen && <div className="absolute z-30 mt-1 w-48 rounded-lg border border-line bg-ink-2 p-2 shadow-lg rtl:left-0 ltr:right-0">{COLS.map((c) => <label key={c.key} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-t-sm hover:bg-ink-3"><input type="checkbox" checked={cols.has(c.key)} disabled={c.key === "supplier"} onChange={() => toggleCol(c.key)} />{c.label}</label>)}</div>}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="تصفية الأرصدة">
          {CHIPS.map((c) => <button key={c.key} aria-pressed={chip === c.key} onClick={() => setChip(c.key)} className={`rounded-full border px-3 py-1 text-t-xs font-bold ${chip === c.key ? "border-petrol bg-petrol text-white" : "border-line bg-ink-2 text-text-dim hover:border-petrol"}`}>{c.label}</button>)}
          {sel.size > 0 && (
            <span className="ms-auto flex flex-wrap items-center gap-1.5 rounded-lg bg-petrol-soft px-2 py-1 text-t-xs font-bold text-petrol">محدد {sel.size}
              <Button size="xs" variant="outline" onClick={() => exportCsv(true)}>تصدير</Button>
              {canEdit && <><Button size="xs" variant="outline" onClick={() => setActive([...sel.values()], true)}>تفعيل</Button><Button size="xs" variant="outline" onClick={() => setActive([...sel.values()], false)}>تعطيل</Button></>}
              <Button size="xs" variant="ghost" onClick={() => setSel(new Map())}>إلغاء التحديد</Button></span>
          )}
        </div>

        {main.loading && !ov ? <Skeleton className="w-full" height={300} /> : !ov || ov.items.length === 0 ? (
          <EmptyState icon="local_shipping" title={ov && !dq && !chip && !category && status === "active" ? "لا يوجد موردون حتى الآن." : "لا يوجد موردون مطابقون"} description={dq || chip || category ? "غيّر البحث أو التصفية." : undefined}
            action={canEdit && !dq && !chip ? <Button onClick={openCreate}><MIcon name="add" className="!text-[16px]" />إضافة مورد</Button> : undefined} />
        ) : (<>
          <div className="hidden overflow-x-auto rounded-card border border-line bg-ink-2 shadow-card md:block">
            <table className="w-full min-w-[760px] border-separate border-spacing-0 text-t-sm">
              <thead><tr>
                <th className="w-8 border-b border-line bg-ink-3 px-2 py-2"><input type="checkbox" aria-label="تحديد الصفحة" checked={ov.items.every((r) => sel.has(r.id))} onChange={(e) => setSel((o) => { const n = new Map(o); ov.items.forEach((r) => (e.target.checked ? n.set(r.id, r) : n.delete(r.id))); return n; })} /></th>
                {visible.map((c) => <th key={c.key} scope="col" aria-sort={c.sort && sort === c.sort ? (dir === "asc" ? "ascending" : "descending") : undefined} className={`whitespace-nowrap border-b border-line bg-ink-3 px-3 py-2 text-t-xs font-extrabold text-text-dim ${c.num ? "text-end" : "text-start"}`}>
                  {c.sort ? <button onClick={() => toggleSort(c.sort)} className="inline-flex items-center gap-0.5 hover:text-petrol">{c.label}{sort === c.sort && <MIcon name={dir === "asc" ? "arrow_upward" : "arrow_downward"} className="!text-[13px]" />}</button> : c.label}</th>)}
                <th className="border-b border-line bg-ink-3 px-2" />
              </tr></thead>
              <tbody>{ov.items.map((r) => (
                <tr key={r.id} onClick={() => router.push(`/suppliers/${r.id}`)} className="cursor-pointer hover:bg-ink-3/50">
                  <td className="border-b border-line/60 px-2 py-2.5" onClick={(e) => e.stopPropagation()}><input type="checkbox" aria-label={`تحديد ${r.name}`} checked={sel.has(r.id)} onChange={() => toggleSel(r)} /></td>
                  {visible.map((c) => <td key={c.key} className={`border-b border-line/60 px-3 py-2.5 ${c.num ? "tnum text-end" : ""}`}>{cell(c.key, r)}</td>)}
                  <td className="border-b border-line/60 px-2 py-2.5" onClick={(e) => e.stopPropagation()}>
                    <span className="flex gap-1">{canEdit && <Button size="xs" variant="ghost" onClick={() => openEdit(r)} aria-label={`تعديل ${r.name}`}>تعديل</Button>}
                      <Button size="xs" variant="outline" onClick={() => router.push(`/suppliers/${r.id}?tab=ledger`)}>كشف الحساب</Button>
                      {canEdit && r.balance > 0 && <Button size="xs" onClick={() => router.push(`/suppliers/${r.id}?pay=1`)}>دفعة</Button>}</span>
                  </td>
                </tr>))}</tbody>
            </table>
          </div>
          <ul className="space-y-2 md:hidden">{ov.items.map((r) => (
            <li key={r.id}><Link href={`/suppliers/${r.id}`} className="flex items-center gap-3 rounded-card border border-line bg-ink-2 p-3 shadow-card">
              <Avatar name={r.name} /><span className="min-w-0 flex-1"><b className="block truncate text-t-sm">{r.name}</b><span className="text-t-xs text-text-dim" dir="ltr">{r.phone || ""}</span></span>
              <span className="text-end"><small className="block text-t-xs text-text-dim">المستحق</small><b className={`tnum text-t-md ${r.balance > 0 ? "text-brass" : ""}`}>{fmtM(r.balance)}</b>{r.overdue > 0 && <small className="block text-t-xs font-bold text-ember">متأخر {fmtM(r.overdue)}</small>}</span>
            </Link></li>))}</ul>
          <div className="flex flex-wrap items-center justify-between gap-2 text-t-sm">
            <span className="tnum text-text-dim">{(ov.page - 1) * ov.pageSize + 1}–{Math.min(ov.page * ov.pageSize, ov.total)} من {fmtN(ov.total)}</span>
            <span className="flex items-center gap-2">
              <Select value={String(size)} onChange={(e) => setSize(Number(e.target.value))} aria-label="عدد الصفوف" className="!w-auto"><option value="25">25</option><option value="50">50</option><option value="100">100</option></Select>
              <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage(page - 1)}>السابق</Button><span className="tnum">{page} / {pages}</span><Button size="sm" variant="outline" disabled={page >= pages} onClick={() => setPage(page + 1)}>التالي</Button>
            </span>
          </div>
        </>)}
      </>)}

      {tab === "payables" && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-1.5">
              <button aria-pressed={!bucket && !onlyOverdue} onClick={() => { setBucket(""); setOnlyOverdue(false); }} className={`rounded-full border px-3 py-1 text-t-xs font-bold ${!bucket && !onlyOverdue ? "border-petrol bg-petrol text-white" : "border-line bg-ink-2 text-text-dim"}`}>كل المستحق</button>
              <button aria-pressed={onlyOverdue} onClick={() => { setOnlyOverdue(!onlyOverdue); setBucket(""); }} className={`rounded-full border px-3 py-1 text-t-xs font-bold ${onlyOverdue ? "border-petrol bg-petrol text-white" : "border-line bg-ink-2 text-text-dim"}`}>المتأخر فقط</button>
              {ov?.aging.map((a) => <button key={a.key} aria-pressed={bucket === a.key} onClick={() => { setBucket(bucket === a.key ? "" : a.key); setOnlyOverdue(false); }} className={`rounded-full border px-3 py-1 text-t-xs font-bold ${bucket === a.key ? "border-petrol bg-petrol text-white" : "border-line bg-ink-2 text-text-dim"}`}>{a.label}</button>)}
            </div>
            <span className="flex gap-2">
              <Button variant="tool" size="sm" onClick={() => pay.data && downloadCsv("payables.csv", ["المورد", "الفاتورة", "مرجع المورد", "الاستحقاق", "أيام التأخر", "الإجمالي", "المدفوع", "المتبقي"], pay.data.map((p) => [p.supplier, p.invoiceNo, p.supplierRef, p.dueDate, p.daysLate, p.total, p.paid, p.outstanding]))} disabled={!pay.data?.length}><MIcon name="download" className="!text-[16px]" />تصدير</Button>
              <Button variant="tool" size="sm" onClick={printPayables} disabled={!pay.data?.length}><MIcon name="print" className="!text-[16px]" />طباعة</Button>
            </span>
          </div>
          {pay.error && <div><ErrorNote msg={pay.error} /><Button size="sm" variant="outline" onClick={pay.reload}>إعادة المحاولة</Button></div>}
          {pay.loading && !pay.data ? <Skeleton className="w-full" height={220} /> : !pay.data || pay.data.length === 0 ? <EmptyState icon="task_alt" title="لا فواتير مستحقة" description="لا توجد فواتير آجلة غير مسددة ضمن هذا التصنيف." /> : (
            <div className="overflow-x-auto rounded-card border border-line bg-ink-2 shadow-card">
              <table className="w-full min-w-[720px] text-t-sm"><thead className="bg-ink-3 text-t-xs text-text-dim"><tr>{["المورد", "الفاتورة", "التاريخ", "الاستحقاق", "التأخر", "الإجمالي", "المدفوع", "المتبقي"].map((h) => <th key={h} className="p-2.5 text-start font-bold">{h}</th>)}</tr></thead>
                <tbody>{pay.data.map((p) => (
                  <tr key={p.id} onClick={() => router.push(`/suppliers/${p.supplierId}?tab=invoices`)} className="cursor-pointer border-t border-line hover:bg-ink-3/50">
                    <td className="p-2.5 font-bold">{p.supplier}</td><td className="tnum p-2.5">{p.invoiceNo}</td><td className="p-2.5 text-t-xs">{fmtD(p.date)}</td><td className="p-2.5 text-t-xs">{p.dueDate ? fmtD(p.dueDate) : "—"}</td>
                    <td className="p-2.5">{p.daysLate > 0 ? <span className="rounded-full bg-ember-bg px-2 py-0.5 text-t-xs font-bold text-ember">{p.daysLate} يوم</span> : <span className="text-t-xs text-text-dim">غير متأخر</span>}</td>
                    <td className="tnum p-2.5">{fmtM(p.total)}</td><td className="tnum p-2.5">{fmtM(p.paid)}</td><td className="tnum p-2.5 font-black">{fmtM(p.outstanding)}</td></tr>))}</tbody></table>
            </div>
          )}
          <p className="text-t-xs text-text-dim">المتبقي = إجمالي الفاتورة − المدفوع المربوط بها. الأرصدة الرسمية من دفتر المورد في ملف المورد.</p>
        </div>
      )}

      {tab === "top" && (
        <div className="space-y-3">
          <div className="flex gap-1.5" role="group" aria-label="الترتيب">
            {([["purchases", "حسب قيمة المشتريات"], ["invoices", "حسب عدد الفواتير"]] as ["purchases" | "invoices", string][]).map(([key, label]) => <button key={key} aria-pressed={topBy === key} onClick={() => setTopBy(key)} className={`rounded-full border px-3 py-1 text-t-xs font-bold ${topBy === key ? "border-petrol bg-petrol text-white" : "border-line bg-ink-2 text-text-dim"}`}>{label}</button>)}
          </div>
          {top.loading && !top.data ? <Skeleton className="w-full" height={220} /> : !top.data || top.data.items.length === 0 ? <EmptyState icon="leaderboard" title="لا مشتريات في هذه الفترة" /> : (
            <div className="overflow-x-auto rounded-card border border-line bg-ink-2 shadow-card"><table className="w-full min-w-[560px] text-t-sm"><thead className="bg-ink-3 text-t-xs text-text-dim"><tr>{["#", "المورد", "المشتريات", "فواتير الفترة", "المدفوع", "المستحق"].map((h) => <th key={h} className="p-2.5 text-start font-bold">{h}</th>)}</tr></thead>
              <tbody>{top.data.items.map((r, i) => (<tr key={r.id} onClick={() => router.push(`/suppliers/${r.id}`)} className="cursor-pointer border-t border-line hover:bg-ink-3/50"><td className="tnum p-2.5 text-text-dim">{i + 1}</td><td className="p-2.5 font-bold">{r.name}</td><td className="tnum p-2.5 font-black">{fmtM(r.purchases)}</td><td className="tnum p-2.5">{fmtN(r.invoiceCount)}</td><td className="tnum p-2.5">{fmtM(r.paid)}</td><td className="tnum p-2.5">{fmtM(r.balance)}</td></tr>))}</tbody></table></div>
          )}
        </div>
      )}

      <SupplierForm open={form.open} editId={form.id} initial={form.initial} categories={cats} onClose={() => setForm((f) => ({ ...f, open: false }))} onSaved={() => { setForm((f) => ({ ...f, open: false })); main.reload(); api<string[]>("/suppliers/overview/categories").then(setCats).catch(() => undefined); }} />
    </div>
  );

  function cell(key: ColKey, r: SupRow) {
    switch (key) {
      case "supplier": return (<div className="flex items-center gap-2.5"><Avatar name={r.name} /><span className="min-w-0"><b className="block max-w-[240px] truncate">{r.name}</b><span className="text-t-xs text-text-dim">{r.category || (r.termsDays ? `سداد ${r.termsDays} يوم` : "")}</span></span></div>);
      case "phone": return <span className="text-t-xs" dir="ltr">{r.phone || "—"}</span>;
      case "vat": return <span className="text-t-xs" dir="ltr">{r.vatNumber || "—"}</span>;
      case "category": return r.category || "—";
      case "purchases": return fmtM(r.purchases);
      case "paid": return fmtM(r.paid);
      case "balance": return <b className={r.balance > 0.005 ? "text-brass" : r.balance < -0.005 ? "text-emerald" : "text-text-dim"}><Money v={r.balance} /></b>;
      case "overdue": return r.overdue > 0 ? <b className="text-ember">{fmtM(r.overdue)}</b> : <span className="text-text-dim">—</span>;
      case "invoices": return fmtN(r.invoiceCount);
      case "last": return <span className="text-t-xs text-text-dim">{r.lastPurchase ? fmtD(r.lastPurchase) : "—"}</span>;
      case "status": return <Badge tone={r.active ? "good" : "neutral"}>{r.active ? "نشط" : "غير نشط"}</Badge>;
    }
  }
}
