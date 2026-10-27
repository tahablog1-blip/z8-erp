"use client";
// ملف المورد 360 — نظرة عامة، فواتير، مدفوعات، كشف حساب من دفتر المورد، منتجات، نشاط. قراءة فقط + سداد/تعديل عبر المسارات القائمة.
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { MIcon } from "@/components/m-icon";
import { Badge, Button, EmptyState, ErrorNote, Tabs } from "@/components/ui";
import { KpiCard, KpiSkeleton } from "@/components/dashboard/KpiCard";
import { Skeleton } from "@/components/dashboard/Widget";
import { appAlert, appConfirm } from "@/components/dialog";
import { SupplierForm } from "@/components/suppliers/SupplierForm";
import { PayModal } from "@/components/suppliers/PayModal";
import { Money, Panel, PeriodPicker, fmtD, fmtDT, fmtM, fmtN, qs, useFetch, type Period } from "@/components/inventory/shared";
import { rangeFor } from "@/lib/dashboard/periods";
import { downloadCsv } from "@/lib/customers/format";
import { kpisHTML, printReport, tableHTML } from "@/lib/print";
import { BUCKET_TONE, INV_STATUS, type Payable, type Sup360 } from "@/lib/suppliers/types";

type Tab = "overview" | "invoices" | "payments" | "ledger" | "products" | "activity";
type Score = { totalPos: number; receivedPos: number; onTimeDeliveries: number; lateDeliveries: number; onTimePct: number | null; priceVarianceIncidents: number; totalPurchasesEx: number };
const BUCKETS = [["current", "حالي"], ["d1_30", "1–30"], ["d31_60", "31–60"], ["d61_90", "61–90"], ["d90p", "+90"]] as const;
const PERIOD_KEYS = ["month", "quarter", "year"];

function Trend({ rows }: { rows: Sup360["trend"] }) {
  const max = Math.max(1, ...rows.flatMap((r) => [r.purchases, r.payments]));
  if (rows.every((r) => !r.purchases && !r.payments)) return <EmptyState icon="show_chart" title="لا حركة خلال آخر 12 شهراً" />;
  const W = 640, H = 150, step = (W - 20) / rows.length, bw = Math.max(4, Math.min(16, step / 2.6));
  return (
    <div className="overflow-x-auto">
      <svg viewBox={`0 0 ${W} ${H + 22}`} className="h-44 w-full min-w-[420px]" role="img" aria-label="المشتريات والمدفوعات شهرياً" style={{ direction: "ltr" }}>
        <line x1="10" x2={W - 10} y1={H} y2={H} stroke="var(--line)" />
        {rows.map((r, i) => {
          const x = 10 + i * step + step / 2, hp = (r.purchases / max) * (H - 10), hy = (r.payments / max) * (H - 10);
          return (<g key={r.month}>
            <rect x={x - bw - 1} y={H - hp} width={bw} height={hp} rx="2" fill="var(--petrol)"><title>{`${r.month} — مشتريات ${fmtM(r.purchases)}`}</title></rect>
            <rect x={x + 1} y={H - hy} width={bw} height={hy} rx="2" fill="var(--emerald)"><title>{`${r.month} — مدفوعات ${fmtM(r.payments)}`}</title></rect>
            {(rows.length <= 12 || i % 2 === 0) && <text x={x} y={H + 14} fontSize="10" textAnchor="middle" fill="var(--text-dim)">{r.month.slice(2)}</text>}
          </g>);
        })}
      </svg>
      <p className="flex gap-4 text-t-xs text-text-dim"><span className="inline-flex items-center gap-1"><i className="h-2.5 w-2.5 rounded-sm bg-petrol" />مشتريات</span><span className="inline-flex items-center gap-1"><i className="h-2.5 w-2.5 rounded-sm bg-emerald" />مدفوعات (سندات الصرف)</span></p>
    </div>
  );
}

export default function Supplier360Page() {
  const { id } = useParams<{ id: string }>();
  const { hasPerm } = useAuth();
  const canEdit = hasPerm("purchasing.suppliers");
  const canInvoice = hasPerm("purchasing.invoices");
  const [tab, setTab] = useState<Tab>("overview");
  const [period, setPeriod] = useState<Period | null>(null);       // فترة كشف الحساب (null = كل الحركات)
  const [payOpen, setPayOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [cats, setCats] = useState<string[]>([]);
  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    const t = sp.get("tab") as Tab | null;
    if (t && ["overview", "invoices", "payments", "ledger", "products", "activity"].includes(t)) setTab(t);
    if (sp.get("pay") === "1") setPayOpen(true);
    api<string[]>("/suppliers/overview/categories").then(setCats).catch(() => undefined);
  }, []);

  const { data, loading, error, reload } = useFetch<Sup360>(`/suppliers/${id}/360?${qs({ from: period?.from, to: period?.to })}`);
  const open = useFetch<Payable[]>(`/suppliers/payables?${qs({ supplier: id })}`);
  const score = useFetch<Score>(tab === "overview" ? `/suppliers/${id}/scorecard` : null);
  const s = data?.supplier; const k = data?.kpis;
  const aging = useMemo(() => BUCKETS.map(([key, label]) => ({ key, label, amount: (open.data ?? []).filter((p) => p.bucket === key).reduce((a, p) => a + p.outstanding, 0), count: (open.data ?? []).filter((p) => p.bucket === key).length })), [open.data]);
  const agingMax = Math.max(1, ...aging.map((a) => a.amount));

  async function toggleActive() {
    if (!s || !data) return;
    if (s.active) {
      if (Math.abs(data.kpis.balance) > 0.005 && !(await appConfirm(`على المورد رصيد ${fmtM(data.kpis.balance)}. التعطيل لا يحذف أي معاملات لكنه يخفيه من القوائم النشطة. متابعة؟`))) return;
      if (Math.abs(data.kpis.balance) <= 0.005 && !(await appConfirm(`تعطيل المورد «${s.name}»؟ لا تُحذف أي بيانات.`))) return;
    }
    try { await api(s.active ? `/suppliers/${id}` : `/suppliers/${id}/activate`, { method: s.active ? "DELETE" : "POST" }); reload(); }
    catch (e) { await appAlert(e instanceof Error ? e.message : "تعذرت العملية"); }
  }
  async function copyInfo() {
    if (!s) return;
    const text = [s.name, s.phone && `الجوال: ${s.phone}`, s.vatNumber && `الرقم الضريبي: ${s.vatNumber}`, s.address].filter(Boolean).join("\n");
    try { await navigator.clipboard.writeText(text); await appAlert("تم نسخ بيانات المورد."); } catch { await appAlert(text); }
  }
  function printStatement() {
    if (!data || !s) return;
    const L = data.ledger;
    printReport(`كشف حساب المورد — ${s.name}`, `${L.from || "البداية"} → ${L.to || "اليوم"}${s.vatNumber ? ` · VAT ${s.vatNumber}` : ""}`,
      kpisHTML([{ label: "الرصيد الافتتاحي", value: fmtM(L.opening) }, { label: "إجمالي المدين", value: fmtM(L.debit) }, { label: "إجمالي الدائن", value: fmtM(L.credit) }, { label: "الرصيد الختامي", value: fmtM(L.closing) }])
      + tableHTML(["التاريخ", "المرجع", "البيان", "مدين", "دائن", "الرصيد"], L.entries.map((e) => [fmtD(e.date), e.ref || "—", e.note || (e.type === "payment" ? "سداد" : "فاتورة"), e.debit ? fmtM(e.debit) : "", e.credit ? fmtM(e.credit) : "", fmtM(e.balance)]), { numericCols: [3, 4, 5] })
      + "<p style=\"margin-top:10px;font-size:11px\">الرصيد الموجب = مستحق للمورد. المصدر: دفتر المورد.</p>");
  }
  function exportStatement() {
    if (!data || !s) return;
    downloadCsv(`statement-${s.name}.csv`, ["التاريخ", "المرجع", "البيان", "مدين", "دائن", "الرصيد"], [["", "", "الرصيد الافتتاحي", "", "", data.ledger.opening], ...data.ledger.entries.map((e) => [e.date, e.ref, e.note, e.debit || "", e.credit || "", e.balance])]);
  }

  if (error) return <div className="space-y-3"><ErrorNote msg={error} /><Button variant="outline" onClick={reload}>إعادة المحاولة</Button><Link href="/suppliers" className="block text-t-sm font-bold text-petrol hover:underline">العودة إلى الموردين</Link></div>;

  return (
    <div className="space-y-4">
      <div>
        <Link href="/suppliers" className="inline-flex items-center gap-1 text-t-sm font-bold text-petrol hover:underline"><MIcon name="arrow_forward" className="!text-[16px]" />الموردون</Link>
      </div>

      {loading && !data ? <Skeleton className="w-full" height={110} /> : s && k && (
        <div className="rounded-card border border-line bg-ink-2 p-4 shadow-card">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <h1 className="text-t-2xl font-black">{s.name}</h1>
              <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-t-xs text-text-dim">
                <Badge tone={s.active ? "good" : "neutral"}>{s.active ? "نشط" : "غير نشط"}</Badge>
                {s.category && <span>{s.category}</span>}{s.vatNumber && <span dir="ltr">VAT: {s.vatNumber}</span>}{s.phone && <span dir="ltr">{s.phone}</span>}
                {s.termsDays > 0 && <span>سداد خلال {s.termsDays} يوم</span>}{s.rating != null && <span>التقييم اليدوي {s.rating}/5</span>}
              </p>
              {s.address && <p className="mt-1 text-t-sm text-text-dim">{s.address}</p>}
            </div>
            <div className="flex flex-wrap gap-2">
              {canInvoice && <Link href="/purchases" className="m3 z8-anim-btn inline-flex items-center gap-1.5 rounded-lg border border-line bg-ink-2 px-3 py-1.5 text-[12px] font-semibold text-text hover:border-petrol hover:text-petrol"><MIcon name="receipt_long" className="!text-[16px]" />فاتورة شراء</Link>}
              {canEdit && s.active && <Button size="sm" onClick={() => setPayOpen(true)}><MIcon name="payments" className="!text-[16px]" />دفعة</Button>}
              <Button size="sm" variant="outline" onClick={() => setTab("ledger")}><MIcon name="description" className="!text-[16px]" />كشف الحساب</Button>
              {canEdit && <Button size="sm" variant="tool" onClick={() => setEditOpen(true)}>تعديل</Button>}
              <Button size="sm" variant="tool" onClick={copyInfo}>نسخ البيانات</Button>
              {canEdit && <Button size="sm" variant={s.active ? "danger" : "success"} onClick={toggleActive}>{s.active ? "تعطيل" : "تفعيل"}</Button>}
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6">
        {loading && !k ? Array.from({ length: 6 }).map((_, i) => <KpiSkeleton key={i} />) : k && (<>
          <KpiCard label="إجمالي المشتريات" icon="shopping_cart" value={fmtM(k.purchases)} sub={`${fmtN(k.invoiceCount)} فاتورة`} tip="شاملة الضريبة، كل الفترات" />
          <KpiCard label="المدفوع" icon="payments" value={fmtM(k.paid)} accent="var(--emerald)" tip="سندات الصرف + المشتريات النقدية" />
          <KpiCard label="الرصيد المستحق" icon="account_balance" value={fmtM(k.balance)} accent="var(--brass)" tip="من دفتر المورد (موجب = مستحق للمورد)" />
          <KpiCard label="المتأخر" icon="event_busy" value={fmtM(k.overdue)} accent="var(--ember)" subTone={k.overdueCount ? "danger" : "neutral"} sub={k.overdueCount ? `${k.overdueCount} فاتورة` : undefined} />
          <KpiCard label="مستحق خلال 7 أيام" icon="schedule" value={fmtM(k.dueSoon)} accent="var(--brass)" sub={k.dueSoonCount ? `${k.dueSoonCount} فاتورة` : undefined} />
          <KpiCard label="متوسط الفاتورة" icon="functions" value={fmtM(k.avgInvoice)} sub={k.daysInactive != null ? `آخر شراء منذ ${k.daysInactive} يوم` : "لا مشتريات"} />
        </>)}
      </div>

      <Tabs value={tab} onChange={setTab} items={[{ key: "overview", label: "نظرة عامة" }, { key: "invoices", label: "الفواتير" }, { key: "payments", label: "المدفوعات" }, { key: "ledger", label: "كشف الحساب" }, { key: "products", label: "المنتجات" }, { key: "activity", label: "النشاط" }]} />

      {loading && !data ? <Skeleton className="w-full" height={260} /> : data && k && (<>
        {tab === "overview" && (
          <div className="grid gap-4 lg:grid-cols-2">
            <Panel title="المشتريات والمدفوعات (12 شهراً)" icon="show_chart"><Trend rows={data.trend} /></Panel>
            <Panel title="أعمار ديون المورد" icon="hourglass_bottom">
              {open.loading && !open.data ? <Skeleton className="w-full" height={100} /> : (open.data ?? []).length === 0 ? <EmptyState icon="task_alt" title="لا فواتير مستحقة" /> : (
                <div className="space-y-2">{aging.map((a) => (
                  <div key={a.key} className="grid grid-cols-[60px_1fr_auto] items-center gap-3"><span dir="ltr" className="justify-self-start text-t-sm font-bold">{a.label}</span>
                    <span className="h-3 overflow-hidden rounded-full bg-ink-3"><span className={`block h-full rounded-full ${BUCKET_TONE[a.key]}`} style={{ width: `${(a.amount / agingMax) * 100}%` }} /></span>
                    <span className="tnum text-t-sm"><b>{fmtM(a.amount)}</b> <small className="text-text-dim">({a.count})</small></span></div>))}</div>
              )}
            </Panel>
            <Panel title="أداء المورد" icon="speed">
              <dl className="grid grid-cols-2 gap-3 text-t-sm">
                <div><dt className="text-t-xs text-text-dim">عدد الفواتير</dt><dd className="tnum font-black">{fmtN(k.invoiceCount)}</dd></div>
                <div><dt className="text-t-xs text-text-dim">متوسط الفاتورة</dt><dd className="tnum font-black">{fmtM(k.avgInvoice)}</dd></div>
                <div><dt className="text-t-xs text-text-dim">آخر فاتورة</dt><dd>{k.lastInvoice ? fmtD(k.lastInvoice) : "—"}</dd></div>
                <div><dt className="text-t-xs text-text-dim">آخر دفعة</dt><dd>{k.lastPayment ? fmtD(k.lastPayment) : "—"}</dd></div>
                <div><dt className="text-t-xs text-text-dim">فترة عدم النشاط</dt><dd>{k.daysInactive != null ? `${k.daysInactive} يوم` : "—"}</dd></div>
                <div><dt className="text-t-xs text-text-dim">فواتير مفتوحة</dt><dd className="tnum font-black">{fmtN(k.openInvoices)}</dd></div>
                {score.data && (<>
                  <div><dt className="text-t-xs text-text-dim">أوامر الشراء المستلمة</dt><dd className="tnum font-black">{score.data.receivedPos} / {score.data.totalPos}</dd></div>
                  <div><dt className="text-t-xs text-text-dim">الالتزام بمواعيد التوريد</dt><dd className="font-black">{score.data.onTimePct != null ? `${score.data.onTimePct}%` : "—"} <small className="font-normal text-text-dim">({score.data.onTimeDeliveries} في الموعد / {score.data.lateDeliveries} متأخر)</small></dd></div>
                  <div><dt className="text-t-xs text-text-dim">حوادث فرق السعر</dt><dd className="tnum font-black">{score.data.priceVarianceIncidents}</dd></div>
                </>)}
              </dl>
              <p className="mt-3 text-t-xs text-text-dim">لا يوجد تقييم آلي للمورد: يُعرض فقط التقييم اليدوي ومؤشرات حقيقية من أوامر الشراء والفواتير. المرتجعات غير مدعومة في النظام الحالي.</p>
            </Panel>
            <Panel title="آخر النشاط" icon="history">
              {data.activity.length === 0 ? <EmptyState icon="history" title="لا نشاط مسجل" /> : <ul className="space-y-2">{data.activity.slice(0, 6).map((a, i) => <li key={i} className="flex items-center gap-2 text-t-sm"><MIcon name={a.kind === "invoice" ? "receipt_long" : "payments"} className="!text-[16px] text-petrol" /><span className="min-w-0 flex-1 truncate">{a.text}</span><b className="tnum">{fmtM(a.amount)}</b><span className="text-t-xs text-text-dim">{fmtD(a.at)}</span></li>)}</ul>}
            </Panel>
          </div>
        )}

        {tab === "invoices" && (data.invoices.length === 0 ? <EmptyState icon="receipt_long" title="لا فواتير شراء لهذا المورد" /> : (
          <div className="overflow-x-auto rounded-card border border-line bg-ink-2 shadow-card"><table className="w-full min-w-[820px] text-t-sm">
            <thead className="bg-ink-3 text-t-xs text-text-dim"><tr>{["التاريخ", "رقم الفاتورة", "مرجع المورد", "الاستحقاق", "الإجمالي", "الضريبة", "المدفوع", "المتبقي", "الحالة"].map((h) => <th key={h} className="p-2.5 text-start font-bold">{h}</th>)}</tr></thead>
            <tbody>{data.invoices.map((i) => (<tr key={i.id} className="border-t border-line">
              <td className="p-2.5 text-t-xs">{fmtD(i.date)}</td><td className="tnum p-2.5 font-bold">{canInvoice ? <Link href="/purchases" className="text-petrol hover:underline">{i.invoiceNo}</Link> : i.invoiceNo}</td>
              <td className="p-2.5 text-t-xs">{i.supplierRef || "—"}</td><td className="p-2.5 text-t-xs">{i.terms === "cash" ? "نقداً" : i.dueDate ? fmtD(i.dueDate) : "—"}</td>
              <td className="tnum p-2.5">{fmtM(i.total)}</td><td className="tnum p-2.5 text-text-dim">{fmtM(i.vat)}</td><td className="tnum p-2.5">{fmtM(i.paid)}</td><td className="tnum p-2.5 font-black">{fmtM(i.outstanding)}</td>
              <td className="p-2.5"><span className={`rounded-full px-2 py-0.5 text-t-xs font-bold ${i.overdue ? "bg-ember-bg text-ember" : i.status === "paid" ? "bg-emerald-bg text-emerald" : "bg-brass-bg text-brass"}`}>{i.overdue ? "متأخرة" : INV_STATUS[i.status] || i.status}</span></td></tr>))}</tbody></table></div>
        ))}

        {tab === "payments" && (data.payments.length === 0 ? <EmptyState icon="payments" title="لا مدفوعات مسجلة" description="تظهر هنا سندات الصرف. المشتريات النقدية تُدفع لحظة الشراء ولا تُسجَّل كسندات." /> : (
          <div className="overflow-x-auto rounded-card border border-line bg-ink-2 shadow-card"><table className="w-full min-w-[620px] text-t-sm">
            <thead className="bg-ink-3 text-t-xs text-text-dim"><tr>{["التاريخ", "الفاتورة", "طريقة الدفع", "المبلغ", "المستخدم", "ملاحظة"].map((h) => <th key={h} className="p-2.5 text-start font-bold">{h}</th>)}</tr></thead>
            <tbody>{data.payments.map((p) => <tr key={p.id} className="border-t border-line"><td className="p-2.5 text-t-xs">{fmtDT(p.at)}</td><td className="tnum p-2.5">{p.invoiceNo || <span className="text-text-dim">على الحساب</span>}</td><td className="p-2.5">{p.methodLabel}</td><td className="tnum p-2.5 font-black">{fmtM(p.amount)}</td><td className="p-2.5 text-t-xs">{p.user || "—"}</td><td className="p-2.5 text-t-xs text-text-dim">{p.note || "—"}</td></tr>)}</tbody></table></div>
        ))}

        {tab === "ledger" && (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2"><button aria-pressed={!period} onClick={() => setPeriod(null)} className={`rounded-full border px-3 py-1 text-t-xs font-bold ${!period ? "border-petrol bg-petrol text-white" : "border-line bg-ink-2 text-text-dim"}`}>كل الحركات</button>
                <PeriodPicker value={period ?? { key: "month", ...rangeFor("month") }} onChange={setPeriod} keys={PERIOD_KEYS} /></div>
              <span className="flex gap-2"><Button variant="tool" size="sm" onClick={exportStatement}><MIcon name="download" className="!text-[16px]" />تصدير</Button><Button variant="tool" size="sm" onClick={printStatement}><MIcon name="print" className="!text-[16px]" />طباعة</Button></span>
            </div>
            <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
              {([["الرصيد الافتتاحي", data.ledger.opening], ["إجمالي المدين (سداد)", data.ledger.debit], ["إجمالي الدائن (فواتير)", data.ledger.credit], ["الرصيد الختامي", data.ledger.closing]] as [string, number][]).map(([l, v]) => (
                <div key={l} className="rounded-lg border border-line bg-ink-2 px-3 py-2"><p className="text-t-xs font-bold text-text-dim">{l}</p><p className="tnum text-t-lg font-black"><Money v={v} /></p></div>))}
            </div>
            {data.ledger.entries.length === 0 ? <EmptyState icon="description" title="لا حركات في الفترة" /> : (
              <div className="overflow-x-auto rounded-card border border-line bg-ink-2 shadow-card"><table className="w-full min-w-[700px] text-t-sm">
                <thead className="bg-ink-3 text-t-xs text-text-dim"><tr>{["التاريخ", "المرجع", "البيان", "مدين", "دائن", "الرصيد", "القيد"].map((h) => <th key={h} className="p-2.5 text-start font-bold">{h}</th>)}</tr></thead>
                <tbody><tr className="border-t border-line bg-ink-3/40"><td className="p-2.5" colSpan={5}><b>الرصيد الافتتاحي</b></td><td className="tnum p-2.5 font-black"><Money v={data.ledger.opening} /></td><td /></tr>
                  {data.ledger.entries.map((e) => (<tr key={e.id} className="border-t border-line"><td className="p-2.5 text-t-xs">{fmtD(e.date)}</td><td className="tnum p-2.5">{e.ref || "—"}</td><td className="p-2.5">{e.note || (e.type === "payment" ? "سداد" : "فاتورة")}</td>
                    <td className="tnum p-2.5 text-emerald">{e.debit ? fmtM(e.debit) : ""}</td><td className="tnum p-2.5 text-brass">{e.credit ? fmtM(e.credit) : ""}</td><td className="tnum p-2.5 font-black"><Money v={e.balance} /></td>
                    <td className="p-2.5 text-t-xs">{e.journalId ? <Link href="/accounting" className="font-bold text-petrol hover:underline">عرض القيد</Link> : <span className="text-text-dim">—</span>}</td></tr>))}</tbody></table></div>
            )}
            <p className="text-t-xs text-text-dim">الكشف من دفتر المورد القائم: الفاتورة الآجلة دائن (تزيد المستحق) وسند الصرف مدين. الرصيد الموجب = مستحق للمورد. «عرض القيد» يفتح دفتر القيود في الحسابات.</p>
          </div>
        )}

        {tab === "products" && (data.products.length === 0 ? <EmptyState icon="inventory_2" title="لا مشتريات أصناف من هذا المورد" /> : (
          <div className="overflow-x-auto rounded-card border border-line bg-ink-2 shadow-card"><table className="w-full min-w-[640px] text-t-sm">
            <thead className="bg-ink-3 text-t-xs text-text-dim"><tr>{["المنتج", "SKU", "آخر سعر شراء", "آخر شراء", "إجمالي الكمية", "إجمالي الإنفاق", "فواتير"].map((h) => <th key={h} className="p-2.5 text-start font-bold">{h}</th>)}</tr></thead>
            <tbody>{data.products.map((p) => <tr key={p.key} className="border-t border-line"><td className="p-2.5 font-bold">{p.productId ? <Link href={`/products/${p.productId}`} className="hover:text-petrol hover:underline">{p.label}</Link> : p.label}</td><td className="p-2.5 text-t-xs" dir="ltr">{p.sku || p.barcode || "—"}</td><td className="tnum p-2.5">{fmtM(p.lastPrice)}</td><td className="p-2.5 text-t-xs">{p.lastDate ? fmtD(p.lastDate) : "—"}</td><td className="tnum p-2.5">{fmtN(p.qty)}</td><td className="tnum p-2.5 font-bold">{fmtM(p.spend)}</td><td className="tnum p-2.5">{p.invoices}</td></tr>)}</tbody></table>
            <p className="border-t border-line p-2 text-t-xs text-text-dim">«آخر سعر شراء» هو سعر الوحدة (قبل الضريبة) في آخر فاتورة من هذا المورد، وليس بالضرورة تكلفة الصنف الحالية.</p></div>
        ))}

        {tab === "activity" && (data.activity.length === 0 ? <EmptyState icon="history" title="لا نشاط مسجل" /> : (
          <ol className="space-y-3 rounded-card border border-line bg-ink-2 p-4 shadow-card">{data.activity.map((a, i) => (
            <li key={i} className="flex items-start gap-3"><span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full bg-petrol-soft text-petrol"><MIcon name={a.kind === "invoice" ? "receipt_long" : "payments"} className="!text-[15px]" /></span>
              <span className="min-w-0 flex-1"><b className="block text-t-sm">{a.text}</b><span className="text-t-xs text-text-dim">{a.user || "—"} · {fmtDT(a.at)}</span></span><b className="tnum text-t-sm">{fmtM(a.amount)}</b></li>))}</ol>
        ))}
      </>)}

      {s && data && <PayModal open={payOpen} supplierId={id} supplierName={s.name} balance={data.kpis.balance} invoices={data.invoices} onClose={() => setPayOpen(false)} onPaid={() => { setPayOpen(false); reload(); open.reload(); }} />}
      {s && <SupplierForm open={editOpen} editId={id} categories={cats} initial={{ name: s.name, phone: s.phone || "", vatNumber: s.vatNumber || "", address: s.address || "", paymentTermsDays: s.termsDays, category: s.category || "", rating: s.rating || 0, ratingNote: s.ratingNote || "" }} onClose={() => setEditOpen(false)} onSaved={() => { setEditOpen(false); reload(); }} />}
    </div>
  );
}
