"use client";
// ملف العميل 360° — رأس + مؤشرات + حساب مالي + كشف حساب + فواتير + مدفوعات + مشتريات + سيارات + ملاحظات + خط زمني.
// الأرقام من /customers/{id}/profile (الباك اند يحسب)، وكشف الحساب من /customers/{id}/statement (نفس المصدر المحاسبي).
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { api, getToken } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { printReport, tableHTML, kpisHTML } from "@/lib/print";
import { MIcon } from "@/components/m-icon";
import { Button, EmptyState, ErrorNote, Field, Input, Modal, Select, Textarea } from "@/components/ui";
import { appAlert, appConfirm } from "@/components/dialog";
import { KpiCard, KpiSkeleton } from "@/components/dashboard/KpiCard";
import { Skeleton } from "@/components/dashboard/Widget";
import { CustomerForm } from "@/components/customers/CustomerForm";
import { Avatar, SegmentBadge, StatusBadge, statusOf } from "@/components/customers/parts";
import { PlateBadge } from "@/components/PlateBadge";
import { parsePlate, plateKey } from "@/lib/plate";
import { ComboSelect } from "@/components/ComboSelect";
import { BRANDS, CATEGORIES, COLORS, CYLINDERS, ENGINE_SIZES, MODELS, YEARS } from "@/lib/carOptions";
import { ago, downloadCsv, fmtCurrency, fmtD, fmtDT, fmtMoney } from "@/lib/customers/format";
import type { Profile, Segment } from "@/lib/customers/types";
import type { Customer, Statement, Vehicle } from "@/modules/customers/types";

type Tab = "overview" | "statement" | "invoices" | "payments" | "purchases" | "vehicles" | "notes";
const METHOD: Record<string, string> = { cash: "نقدي", card: "شبكة", transfer: "تحويل بنكي", credit: "آجل" };
const EMPTY_VEHICLE = { plate: "", plateType: "saudi" as "saudi" | "other", brand: "", makeModel: "", modelYear: "", carCategory: "", cylinders: "", engineSize: "", color: "", chassisNumber: "", notes: "" };
const waLink = (phone: string) => { const d = phone.replace(/\D/g, ""); return "https://wa.me/" + (d.startsWith("0") ? "966" + d.slice(1) : d); };

const Card = ({ title, icon, actions, children, className = "" }: { title: string; icon?: string; actions?: React.ReactNode; children: React.ReactNode; className?: string }) => (
  <section className={`rounded-card border border-line bg-ink-2 shadow-card ${className}`}>
    <header className="flex items-center justify-between gap-2 px-4 pb-1 pt-3.5 sm:px-5">
      <h2 className="flex items-center gap-1.5 text-t-md font-black">{icon && <MIcon name={icon} className="!text-[19px] text-petrol" />}{title}</h2>{actions}
    </header>
    <div className="px-4 pb-4 pt-2 sm:px-5">{children}</div>
  </section>
);
const Th = ({ children, end }: { children?: React.ReactNode; end?: boolean }) => <th scope="col" className={`whitespace-nowrap border-b border-line bg-ink-3 px-3 py-2 text-t-xs font-extrabold text-text-dim ${end ? "text-end" : "text-start"}`}>{children}</th>;
const Td = ({ children, end, cls = "" }: { children?: React.ReactNode; end?: boolean; cls?: string }) => <td className={`border-b border-line/60 px-3 py-2.5 ${end ? "text-end" : ""} ${cls}`}>{children}</td>;

export default function CustomerProfilePage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { hasPerm } = useAuth();
  const canEdit = hasPerm("customers.edit");
  const canPay = hasPerm("customers.record_payment");
  const canDelete = hasPerm("customers.delete");
  const canNote = hasPerm("customers.edit", "customers.create", "customers.record_payment");

  const [customer, setCustomer] = useState<Customer | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [statement, setStatement] = useState<Statement | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<Tab>("overview");
  const [editOpen, setEditOpen] = useState(false);
  const [payOpen, setPayOpen] = useState(false);
  const [menu, setMenu] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; msg: string } | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get("tab") as Tab | null;
    if (t && ["overview", "statement", "invoices", "payments", "purchases", "vehicles", "notes"].includes(t)) setTab(t);
  }, []);
  const switchTab = (t: Tab) => { setTab(t); const u = new URL(window.location.href); u.searchParams.set("tab", t); window.history.replaceState(null, "", u); };

  const load = useCallback(async () => {
    try {
      const [c, p] = await Promise.all([api<Customer>(`/customers/${id}`), api<Profile>(`/customers/${id}/profile`)]);
      setCustomer(c); setProfile(p); setError("");
      api<Vehicle[]>(`/customers/${id}/vehicles`).then(setVehicles).catch(() => {});
      if (hasPerm("customers.view_statement")) api<Statement>(`/customers/${id}/statement`).then(setStatement).catch(() => setStatement(null));
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setLoading(false); }
  }, [id, hasPerm]);
  useEffect(() => { load(); }, [load]);

  const flash = (ok: boolean, msg: string) => { setNotice({ ok, msg }); setTimeout(() => setNotice(null), 6000); };

  async function fetchPdf(invId: string): Promise<Blob> {
    const token = getToken();
    const res = await fetch(`/api/invoices/${invId}/pdf`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
    if (!res.ok) { let m = `تعذر تحميل الفاتورة (${res.status})`; try { const d = await res.json(); m = d?.error || d?.detail || m; } catch { /* */ } throw new Error(m); }
    return res.blob();
  }
  async function invoiceAction(kind: "view" | "dl" | "wa", inv: { id: string; invoiceNo: string }) {
    setBusyKey(`${kind}:${inv.id}`);
    try {
      if (kind === "wa") { await api(`/invoices/${inv.id}/send-whatsapp`, { method: "POST" }); flash(true, `تمت جدولة إرسال الفاتورة ${inv.invoiceNo} عبر واتساب`); }
      else {
        const w = kind === "view" ? window.open("", "_blank") : null;
        try {
          const url = URL.createObjectURL(await fetchPdf(inv.id));
          if (kind === "view") { if (w) w.location.href = url; else window.open(url, "_blank"); setTimeout(() => URL.revokeObjectURL(url), 60000); }
          else { const a = document.createElement("a"); a.href = url; a.download = `${inv.invoiceNo}.pdf`; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 5000); }
        } catch (e) { w?.close(); throw e; }
      }
    } catch (e) { flash(false, e instanceof Error ? e.message : String(e)); } finally { setBusyKey(null); }
  }

  async function toggleActive() {
    if (!customer || !profile) return;
    const act = !profile.isActive;
    if (!await appConfirm(act ? `إعادة تفعيل «${customer.name}»؟` : `تعطيل «${customer.name}»؟ (لا يتم حذف أي بيانات أو معاملات)`)) return;
    try {
      const r = await api<{ updated: number; skipped: { reason: string }[] }>("/customers/bulk-status", { method: "POST", body: JSON.stringify({ ids: [customer.id], active: act }) });
      if (r.skipped.length) await appAlert(`لا يمكن تعطيل العميل: ${r.skipped[0].reason}`); else flash(true, act ? "تم تفعيل العميل" : "تم تعطيل العميل");
      await load();
    } catch (e) { await appAlert(e instanceof Error ? e.message : String(e)); }
  }

  const printStatement = () => {
    if (!statement || !customer) return;
    printReport(`كشف حساب — ${customer.name}`, `${profile?.no ?? ""} · ${fmtD(new Date().toISOString())}`,
      kpisHTML([{ label: "الرصيد الحالي", value: fmtCurrency(statement.balance, 2) }]) +
      tableHTML(["التاريخ", "البيان", "المستند", "مدين", "دائن", "الرصيد"], statement.entries.map((e) => [fmtDT(e.created_at), e.note || ENTRY[e.entry_type], e.invoice_no || "", e.amount > 0 ? fmtMoney(e.amount, 2) : "", e.amount < 0 ? fmtMoney(-e.amount, 2) : "", fmtMoney(e.running_balance, 2)]), { numericCols: [3, 4, 5] }));
  };

  if (loading) return (
    <div className="mx-auto max-w-[1400px] space-y-4"><Skeleton height={120} /><div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{Array.from({ length: 8 }).map((_, i) => <KpiSkeleton key={i} />)}</div><Skeleton height={320} /></div>);
  if (error || !customer || !profile) return (
    <div role="alert" className="mx-auto max-w-md py-16 text-center">
      <MIcon name="person_off" className="!text-[44px] text-ember" />
      <h1 className="mt-2 text-t-xl font-black">تعذر تحميل ملف العميل</h1><p className="mt-1 text-t-sm text-text-dim">{error}</p>
      <div className="mt-4 flex justify-center gap-2"><Button onClick={() => { setLoading(true); load(); }}>إعادة المحاولة</Button><Button variant="outline" onClick={() => router.push("/customers")}>العودة للعملاء</Button></div>
    </div>);

  const k = profile.kpis;
  const seg: Segment | null = (profile.insights && profile.insights.visits > 0 ? (profile.insights.daysSinceLast ?? 0) > 90 ? "inactive" : (profile.insights.daysSinceLast ?? 0) > 60 ? "at_risk" : null : null);
  const status = statusOf({ isActive: profile.isActive, overdue: k?.overdue ?? 0, segment: seg ?? "regular" });
  const tabs: { key: Tab; label: string; icon: string; show: boolean; count?: number }[] = [
    { key: "overview", label: "نظرة عامة", icon: "dashboard", show: true },
    { key: "statement", label: "كشف الحساب", icon: "description", show: !!statement },
    { key: "invoices", label: "الفواتير", icon: "receipt_long", show: !!profile.invoices, count: profile.invoices?.length },
    { key: "payments", label: "المدفوعات", icon: "payments", show: !!profile.payments, count: profile.payments?.length },
    { key: "purchases", label: "المشتريات", icon: "shopping_bag", show: !!profile.purchases },
    { key: "vehicles", label: "السيارات", icon: "directions_car", show: true, count: vehicles.length },
    { key: "notes", label: "الملاحظات", icon: "sticky_note_2", show: true, count: profile.notes.length },
  ];

  return (
    <div className="cx-enter mx-auto w-full max-w-[1400px] space-y-4 pb-8" onClick={() => menu && setMenu(false)}>
      <nav aria-label="breadcrumb"><Link href="/customers" className="inline-flex items-center gap-1 text-t-sm font-bold text-petrol hover:underline"><MIcon name="arrow_forward" className="!text-[16px] ltr:rotate-180" />العملاء</Link></nav>

      {/* ── Header ── */}
      <header className="rounded-card border border-line bg-ink-2 p-4 shadow-card sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 items-center gap-4">
            <Avatar name={customer.name} size={64} />
            <div className="min-w-0">
              <h1 className="truncate text-t-2xl font-black leading-tight">{customer.name}</h1>
              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-t-sm text-text-dim">
                <span className="tnum font-bold">{profile.no}</span>
                {customer.phone && <span dir="ltr" className="tnum">{customer.phone}</span>}
                {customer.email && <span dir="ltr" className="truncate">{customer.email}</span>}
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <StatusBadge status={status} />
                <span className="rounded-md bg-ink-3 px-1.5 py-0.5 text-t-xs font-bold text-text-dim">{customer.customer_type === "company" ? "شركة" : "فرد"}</span>
                {k && k.totalSales != null && k.totalSales >= 0 && profile.insights && profile.insights.visits === 0 && <SegmentBadge seg="no_activity" />}
              </div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2" onClick={(e) => e.stopPropagation()}>
            {canEdit && <Button variant="outline" onClick={() => setEditOpen(true)}><MIcon name="edit" className="!text-[18px]" />تعديل</Button>}
            <Link href="/sales/direct" className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-ink-2 px-4 py-2 text-[13px] font-semibold hover:border-petrol hover:text-petrol"><MIcon name="add_shopping_cart" className="!text-[18px]" />فاتورة جديدة</Link>
            {canPay && <Button onClick={() => setPayOpen(true)}><MIcon name="payments" className="!text-[18px]" />تسجيل دفعة</Button>}
            <div className="relative">
              <Button variant="outline" aria-haspopup="menu" aria-expanded={menu} aria-label="المزيد" onClick={() => setMenu(!menu)}><MIcon name="more_horiz" className="!text-[20px]" /></Button>
              {menu && (
                <div role="menu" className="absolute end-0 top-full z-30 mt-1 w-52 overflow-hidden rounded-xl border border-line bg-ink-2 shadow-xl">
                  {customer.phone && <a role="menuitem" href={waLink(customer.phone)} target="_blank" rel="noreferrer" className="flex items-center gap-2 px-3 py-2.5 text-t-sm font-bold hover:bg-ink-3"><MIcon name="chat" className="!text-[18px] text-petrol" />واتساب</a>}
                  {customer.phone && <a role="menuitem" href={`tel:${customer.phone}`} className="flex items-center gap-2 px-3 py-2.5 text-t-sm font-bold hover:bg-ink-3"><MIcon name="call" className="!text-[18px] text-petrol" />اتصال</a>}
                  {statement && <button role="menuitem" onClick={printStatement} className="flex w-full items-center gap-2 px-3 py-2.5 text-start text-t-sm font-bold hover:bg-ink-3"><MIcon name="print" className="!text-[18px] text-petrol" />طباعة كشف الحساب</button>}
                  {canDelete && <button role="menuitem" onClick={toggleActive} className={`flex w-full items-center gap-2 border-t border-line px-3 py-2.5 text-start text-t-sm font-bold hover:bg-ink-3 ${profile.isActive ? "text-ember" : "text-emerald"}`}><MIcon name={profile.isActive ? "block" : "check_circle"} className="!text-[18px]" />{profile.isActive ? "تعطيل العميل" : "تفعيل العميل"}</button>}
                </div>
              )}
            </div>
          </div>
        </div>
      </header>

      {notice && <div role="status" className={`rounded-xl px-4 py-2.5 text-t-sm font-bold ${notice.ok ? "bg-emerald-bg text-emerald" : "bg-ember-bg text-ember"}`}>{notice.msg}</div>}

      {/* ── KPI 360 ── */}
      {k && (
        <section aria-label="KPI" className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {k.totalSales != null && <KpiCard label="إجمالي المبيعات" icon="payments" accent="var(--chart-revenue)" value={fmtCurrency(k.totalSales, 2)} href={`/sales/history?customer=${encodeURIComponent(customer.name)}`} />}
          {k.invoiceCount != null && <KpiCard label="عدد الفواتير" icon="receipt_long" accent="var(--petrol)" value={fmtMoney(k.invoiceCount, 0)} sub={k.avgInvoice != null ? `متوسط: ${fmtCurrency(k.avgInvoice, 2)}` : undefined} />}
          <KpiCard label="المدفوع" icon="check_circle" accent="var(--chart-profit)" value={fmtCurrency(k.paid, 2)} />
          <div onClick={() => switchTab("statement")} role="presentation" className="contents"><KpiCard label="المستحق" icon="request_quote" accent="var(--brass)" value={fmtCurrency(k.due, 2)} subTone={k.due > 0 ? "warning" : "neutral"} sub={customer.credit_limit != null ? `حد الائتمان: ${fmtCurrency(customer.credit_limit)}` : undefined} /></div>
          <KpiCard label="المتأخر" tip="مستحقات مر عليها أكثر من 30 يوماً" icon="schedule" accent="var(--ember)" value={fmtCurrency(k.overdue, 2)} subTone={k.overdue > 0 ? "danger" : "neutral"} />
          {k.refunds != null && <KpiCard label="المرتجعات" icon="assignment_return" accent="var(--chart-neutral)" value={fmtCurrency(k.refunds, 2)} sub={`${k.refundCount ?? 0} فاتورة`} />}
          <KpiCard label="آخر تعامل" icon="event" accent="var(--petrol)" value={ago(k.lastAt)} sub={fmtD(k.lastAt)} />
          <KpiCard label="نقاط الولاء" icon="star" accent="var(--brass)" value={fmtMoney(profile.loyaltyPoints, 0)} />
        </section>
      )}

      {/* ── Tabs ── */}
      <div role="tablist" aria-label="أقسام ملف العميل" className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1 [scrollbar-width:none]">
        {tabs.filter((t) => t.show).map((t) => (
          <button key={t.key} role="tab" aria-selected={tab === t.key} onClick={() => switchTab(t.key)}
            className={`inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-xl px-3.5 py-2 text-t-sm font-bold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-petrol ${tab === t.key ? "bg-petrol text-white" : "bg-ink-2 text-text-dim hover:bg-ink-3"}`}>
            <MIcon name={t.icon} className="!text-[17px]" />{t.label}{t.count != null && <span className="tnum text-t-xs opacity-80">({t.count})</span>}
          </button>
        ))}
      </div>

      {tab === "overview" && <Overview profile={profile} customer={customer} statement={statement} onReload={load} canPay={canPay} canNote={canNote} onTab={switchTab} />}
      {tab === "statement" && statement && <StatementTab statement={statement} name={customer.name} onPrint={printStatement} />}
      {tab === "invoices" && profile.invoices && <InvoicesTab invoices={profile.invoices} busyKey={busyKey} onAction={invoiceAction} />}
      {tab === "payments" && profile.payments && <PaymentsTab payments={profile.payments} canPay={canPay} onPay={() => setPayOpen(true)} />}
      {tab === "purchases" && profile.purchases && <PurchasesTab purchases={profile.purchases} top={profile.topProducts ?? []} />}
      {tab === "vehicles" && <VehiclesTab customerId={customer.id} vehicles={vehicles} canEdit={canEdit} onChange={async () => setVehicles(await api<Vehicle[]>(`/customers/${customer.id}/vehicles`))} />}
      {tab === "notes" && <NotesTab customerId={customer.id} notes={profile.notes} canNote={canNote} onAdded={load} />}

      <CustomerForm open={editOpen} customer={customer} onClose={() => setEditOpen(false)} onSaved={(c) => { setCustomer(c); setEditOpen(false); load(); flash(true, "تم حفظ بيانات العميل"); }} />
      <PayModal open={payOpen} customerId={customer.id} due={k?.due ?? 0} onClose={() => setPayOpen(false)} onDone={() => { setPayOpen(false); flash(true, "تم تسجيل الدفعة"); load(); }} />
    </div>
  );
}

const ENTRY: Record<string, string> = { invoice: "فاتورة آجلة", payment: "سداد", return: "مرتجع" };

/* ══════════════ نظرة عامة ══════════════ */
function Overview({ profile, customer, statement, onReload, canPay, canNote, onTab }: {
  profile: Profile; customer: Customer; statement: Statement | null; onReload: () => void; canPay: boolean; canNote: boolean; onTab: (t: Tab) => void;
}) {
  const f = profile.financial, ins = profile.insights;
  const row = (l: string, v?: string | null) => <div className="flex justify-between gap-3 border-b border-line/60 py-2 text-t-sm"><span className="text-text-dim">{l}</span><span className="min-w-0 truncate text-end font-bold">{v || "—"}</span></div>;
  return (
    <div className="grid gap-4 xl:grid-cols-3">
      <div className="space-y-4 xl:col-span-2">
        {f && (
          <Card title="الحساب المالي" icon="account_balance">
            <div className="flex flex-wrap items-center gap-2 text-t-sm">
              {[["مبيعات آجلة", f.creditSales, "+"], ["المدفوعات", f.payments, "−"], ["المرتجعات", f.returns, "−"], ["الرصيد الحالي", f.balance, "="]].map(([l, v, op], i) => (
                <div key={l as string} className="flex items-center gap-2">
                  {i > 0 && <span className="text-t-lg font-black text-text-dim">{op}</span>}
                  <div className={`rounded-xl border px-3.5 py-2.5 ${i === 3 ? "border-petrol/40 bg-petrol-soft" : "border-line bg-ink"}`}>
                    <div className="text-t-xs text-text-dim">{l}</div><div className={`tnum text-t-lg font-black ${i === 3 && (v as number) > 0 ? "text-ember" : ""}`}>{fmtCurrency(v as number, 2)}</div>
                  </div>
                </div>
              ))}
            </div>
            <p className="mt-2 text-t-xs text-text-dim">القيم من دفتر حساب العميل نفسه (نفس مصدر كشف الحساب) — الواجهة لا تعيد الحساب.
              {statement && <> <button className="font-bold text-petrol underline" onClick={() => onTab("statement")}>عرض كشف الحساب</button></>}</p>
          </Card>
        )}
        {ins && (
          <Card title="رؤى العميل" icon="insights">
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
              {[["إجمالي الإنفاق", fmtCurrency(ins.totalSpent, 2)], ["متوسط الفاتورة", fmtCurrency(ins.avgInvoice, 2)], ["عدد الزيارات", fmtMoney(ins.visits, 0)],
                ["أيام منذ آخر تعامل", ins.daysSinceLast != null ? fmtMoney(ins.daysSinceLast, 0) : "—"], ["معدل الشراء", ins.avgDaysBetween != null ? `كل ${fmtMoney(ins.avgDaysBetween, 0)} يوم` : "—"],
                ["الفرع المفضل", ins.favoriteBranch ?? "—"], ["أول تعامل", fmtD(ins.firstAt)], ["آخر تعامل", fmtD(ins.lastAt)]].map(([l, v]) => (
                <div key={l} className="min-w-0"><dt className="text-t-xs text-text-dim">{l}</dt><dd className="tnum truncate text-t-md font-extrabold">{v}</dd></div>))}
            </dl>
            {profile.topProducts && profile.topProducts.length > 0 && (
              <div className="mt-4"><h3 className="mb-2 text-t-xs font-extrabold text-text-dim">الأكثر شراءً</h3>
                <ul className="space-y-1.5">{profile.topProducts.map((p) => (
                  <li key={p.label} className="flex items-center justify-between gap-3 text-t-sm"><span className="min-w-0 truncate font-bold">{p.label}</span><span className="tnum shrink-0 text-text-dim">{fmtMoney(p.qty, 0)} · {fmtCurrency(p.total, 2)}</span></li>))}</ul>
              </div>)}
          </Card>
        )}
        <Card title="بيانات العميل" icon="badge">
          <div className="grid gap-x-8 sm:grid-cols-2">
            {row("الجوال", customer.phone)}{row("البريد", customer.email)}{row("الرقم الضريبي", customer.vat_number)}{row("السجل التجاري", customer.cr_number)}
            {row("المدينة", customer.city)}{row("الحي", customer.district)}{row("الشارع", customer.street)}{row("رقم المبنى", customer.building_no)}
            {row("الرمز البريدي", customer.postal_code)}{row("الرقم الإضافي", customer.additional_no)}{row("العنوان", customer.address)}
            {row("تاريخ التسجيل", profile.createdAt ? fmtD(profile.createdAt) : null)}
            {customer.contract_discount_pct != null && row("عقد التسعير", `خصم ${customer.contract_discount_pct}%${customer.contract_valid_until ? ` حتى ${fmtD(customer.contract_valid_until)}` : ""}`)}
          </div>
        </Card>
        {profile.loyaltyPoints > 0 && canPay && <Loyalty customerId={customer.id} points={profile.loyaltyPoints} onDone={onReload} />}
      </div>
      <Timeline events={profile.timeline} onNotes={canNote ? () => onTab("notes") : undefined} />
    </div>
  );
}

function Timeline({ events, onNotes }: { events: Profile["timeline"]; onNotes?: () => void }) {
  const ICON = { invoice: ["receipt_long", "text-petrol"], refund: ["assignment_return", "text-ember"], payment: ["payments", "text-emerald"], note: ["sticky_note_2", "text-brass"], vehicle: ["directions_car", "text-text-dim"] } as const;
  const LABEL = { invoice: "فاتورة", refund: "مرتجع", payment: "سداد", note: "ملاحظة", vehicle: "سيارة" } as const;
  const groups = useMemo(() => {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const g = new Map<string, Profile["timeline"]>();
    for (const e of events) {
      const d = new Date(e.at); const days = Math.floor((+today - new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()) / 86400000);
      const key = days <= 0 ? "اليوم" : days === 1 ? "أمس" : days < 7 ? "هذا الأسبوع" : days < 31 ? "هذا الشهر" : "أقدم";
      g.set(key, [...(g.get(key) ?? []), e]);
    }
    return [...g.entries()];
  }, [events]);
  return (
    <Card title="سجل النشاط" icon="history" actions={onNotes && <button onClick={onNotes} className="text-t-xs font-bold text-petrol hover:underline">إضافة ملاحظة</button>} className="self-start">
      {events.length === 0 ? <p className="py-6 text-center text-t-sm text-text-dim">لا يوجد نشاط بعد</p> : (
        <ol className="space-y-4">
          {groups.map(([label, list]) => (
            <li key={label}><h3 className="mb-2 text-t-xs font-extrabold text-text-dim">{label}</h3>
              <ul className="space-y-2.5 border-s border-line ps-4">
                {list.map((e, i) => (
                  <li key={i} className="relative">
                    <span className={`absolute -start-[25px] top-0.5 grid h-5 w-5 place-items-center rounded-full bg-ink-2 ring-2 ring-ink-2 ${ICON[e.type][1]}`}><MIcon name={ICON[e.type][0]} className="!text-[15px]" /></span>
                    <div className="flex items-start justify-between gap-2 text-t-sm"><span className="min-w-0"><b>{LABEL[e.type]}</b> <span className="break-words text-text-dim">{e.title}</span></span>
                      {e.amount != null && <span className="tnum shrink-0 font-extrabold">{fmtCurrency(e.amount, 2)}</span>}</div>
                    <div className="text-t-xs text-text-dim">{fmtDT(e.at)}{e.user ? ` · ${e.user}` : ""}</div>
                  </li>))}
              </ul></li>))}
        </ol>)}
    </Card>
  );
}

function Loyalty({ customerId, points, onDone }: { customerId: string; points: number; onDone: () => void }) {
  const [v, setV] = useState(""); const [err, setErr] = useState(""); const [busy, setBusy] = useState(false);
  async function redeem() {
    const n = Number(v); if (!n || n <= 0) { setErr("أدخل عدد نقاط صحيح"); return; }
    setBusy(true); setErr("");
    try { await api(`/customers/${customerId}/redeem-points`, { method: "POST", body: JSON.stringify({ points: n }) }); setV(""); onDone(); }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  }
  return (
    <Card title="نقاط الولاء" icon="star">
      <div className="flex flex-wrap items-end gap-2">
        <div className="text-t-sm">الرصيد: <b className="tnum">{points}</b> نقطة</div>
        <div className="ms-auto flex gap-2"><Input type="number" min={1} max={points} className="tnum !w-28" value={v} onChange={(e) => setV(e.target.value)} aria-label="عدد النقاط" placeholder="النقاط" /><Button variant="outline" loading={busy} onClick={redeem}>استبدال</Button></div>
      </div>
      <ErrorNote msg={err} />
    </Card>
  );
}

/* ══════════════ كشف الحساب ══════════════ */
function StatementTab({ statement, name, onPrint }: { statement: Statement; name: string; onPrint: () => void }) {
  const [from, setFrom] = useState(""); const [to, setTo] = useState(""); const [q, setQ] = useState("");
  const all = statement.entries;
  const inRange = all.filter((e) => (!from || e.created_at.slice(0, 10) >= from) && (!to || e.created_at.slice(0, 10) <= to)
    && (!q.trim() || `${e.invoice_no ?? ""} ${e.note ?? ""} ${ENTRY[e.entry_type] ?? ""}`.toLowerCase().includes(q.trim().toLowerCase())));
  const opening = from ? (all.filter((e) => e.created_at.slice(0, 10) < from).slice(-1)[0]?.running_balance ?? 0) : 0;
  const dr = inRange.filter((e) => e.amount > 0).reduce((s, e) => s + e.amount, 0), cr = inRange.filter((e) => e.amount < 0).reduce((s, e) => s - e.amount, 0);
  return (
    <Card title="كشف حساب العميل" icon="description" actions={
      <div className="flex gap-1.5">
        <Button size="sm" variant="outline" onClick={() => downloadCsv(`statement-${name}.csv`, ["التاريخ", "البيان", "المستند", "مدين", "دائن", "الرصيد"], inRange.map((e) => [e.created_at.slice(0, 10), e.note || ENTRY[e.entry_type], e.invoice_no, e.amount > 0 ? e.amount : "", e.amount < 0 ? -e.amount : "", e.running_balance]))}><MIcon name="download" className="!text-[16px]" />تصدير</Button>
        <Button size="sm" variant="outline" onClick={onPrint}><MIcon name="print" className="!text-[16px]" />طباعة</Button>
      </div>}>
      <div className="mb-3 flex flex-wrap items-end gap-2">
        <label className="text-t-xs font-bold text-text-dim">من<Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
        <label className="text-t-xs font-bold text-text-dim">إلى<Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
        <label className="min-w-[180px] flex-1 text-t-xs font-bold text-text-dim">بحث<Input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="رقم المستند أو البيان" /></label>
        {(from || to || q) && <button className="pb-2 text-t-sm font-bold text-petrol" onClick={() => { setFrom(""); setTo(""); setQ(""); }}>مسح</button>}
      </div>
      <div className="max-h-[60vh] overflow-auto rounded-lg border border-line">
        <table className="w-full min-w-[640px] border-separate border-spacing-0 text-t-sm">
          <thead className="sticky top-0 z-10"><tr><Th>التاريخ</Th><Th>البيان</Th><Th>المستند</Th><Th end>مدين</Th><Th end>دائن</Th><Th end>الرصيد</Th></tr></thead>
          <tbody>
            {from && <tr className="bg-ink-3/50"><Td cls="font-bold" >—</Td><Td cls="font-bold">رصيد افتتاحي للفترة</Td><Td /><Td /><Td /><Td end cls="tnum font-extrabold">{fmtMoney(opening, 2)}</Td></tr>}
            {inRange.length === 0 ? <tr><td colSpan={6}><EmptyState icon="description" title="لا توجد حركات" description="غيّر الفترة أو كلمات البحث." /></td></tr> : inRange.map((e) => (
              <tr key={e.id} className="hover:bg-ink-3/50">
                <Td cls="whitespace-nowrap text-text-dim">{fmtDT(e.created_at)}</Td>
                <Td><span className={`me-1.5 rounded-md px-1.5 py-0.5 text-t-xs font-bold ${e.entry_type === "invoice" ? "bg-brass-bg text-brass" : e.entry_type === "payment" ? "bg-emerald-bg text-emerald" : "bg-petrol-soft text-petrol"}`}>{ENTRY[e.entry_type] ?? e.entry_type}</span>{e.note}</Td>
                <Td cls="tnum">{e.invoice_no || "—"}</Td>
                <Td end cls="tnum font-bold text-ember">{e.amount > 0 ? fmtMoney(e.amount, 2) : ""}</Td>
                <Td end cls="tnum font-bold text-emerald">{e.amount < 0 ? fmtMoney(-e.amount, 2) : ""}</Td>
                <Td end cls="tnum font-extrabold">{fmtMoney(e.running_balance, 2)}</Td>
              </tr>))}
          </tbody>
          <tfoot className="sticky bottom-0"><tr className="bg-ink-3"><td colSpan={3} className="px-3 py-2 text-t-xs font-extrabold text-text-dim">الإجمالي</td><td className="tnum px-3 py-2 text-end font-extrabold text-ember">{fmtMoney(dr, 2)}</td><td className="tnum px-3 py-2 text-end font-extrabold text-emerald">{fmtMoney(cr, 2)}</td><td className="tnum px-3 py-2 text-end font-black">{fmtMoney(statement.balance, 2)}</td></tr></tfoot>
        </table>
      </div>
    </Card>
  );
}

/* ══════════════ الفواتير ══════════════ */
function InvoicesTab({ invoices, busyKey, onAction }: { invoices: NonNullable<Profile["invoices"]>; busyKey: string | null; onAction: (k: "view" | "dl" | "wa", i: { id: string; invoiceNo: string }) => void }) {
  const [q, setQ] = useState("");
  const list = invoices.filter((i) => !q.trim() || i.invoiceNo.toLowerCase().includes(q.trim().toLowerCase()));
  const btn = "grid h-9 w-9 place-items-center rounded-lg border border-line text-text-dim hover:border-petrol hover:text-petrol disabled:opacity-45";
  const st = (i: (typeof invoices)[number]) => i.isReturned ? ["مرتجعة", "bg-ink-3 text-text-dim"] : i.due > 0 ? (i.paid > 0 ? ["جزئية", "bg-brass-bg text-brass"] : ["آجلة", "bg-brass-bg text-brass"]) : ["مدفوعة", "bg-emerald-bg text-emerald"];
  return (
    <Card title="فواتير العميل" icon="receipt_long" actions={<Input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="رقم الفاتورة" aria-label="بحث" className="!w-40" />}>
      {list.length === 0 ? <EmptyState icon="receipt_long" title="لا توجد فواتير" /> : (
        <div className="max-h-[65vh] overflow-auto rounded-lg border border-line">
          <table className="w-full min-w-[720px] border-separate border-spacing-0 text-t-sm">
            <thead className="sticky top-0 z-10"><tr><Th>رقم الفاتورة</Th><Th>التاريخ</Th><Th>الفرع</Th><Th end>المبلغ</Th><Th end>المدفوع</Th><Th end>المستحق</Th><Th>الحالة</Th><Th end>إجراءات</Th></tr></thead>
            <tbody>{list.map((i) => { const s = st(i); return (
              <tr key={i.id} className="hover:bg-ink-3/50">
                <Td cls="tnum font-bold"><Link href={`/sales/history?invoiceNo=${encodeURIComponent(i.invoiceNo)}`} className="hover:text-petrol hover:underline">{i.invoiceNo}</Link></Td>
                <Td cls="whitespace-nowrap text-text-dim">{fmtDT(i.at)}</Td><Td cls="text-text-dim">{i.branch ?? "—"}</Td>
                <Td end cls="tnum font-extrabold">{fmtCurrency(i.total, 2)}</Td><Td end cls="tnum">{fmtCurrency(i.paid, 2)}</Td>
                <Td end cls={`tnum ${i.due > 0 ? "font-bold text-ember" : "text-text-dim"}`}>{fmtCurrency(i.due, 2)}</Td>
                <Td><span className={`rounded-full px-2 py-0.5 text-t-xs font-extrabold ${s[1]}`}>{s[0]}</span></Td>
                <Td end><div className="flex justify-end gap-1.5">
                  <button className={btn} disabled={busyKey === `view:${i.id}`} onClick={() => onAction("view", i)} aria-label={`عرض الفاتورة ${i.invoiceNo}`} title="عرض PDF"><MIcon name="visibility" className="!text-[17px]" /></button>
                  <button className={btn} disabled={busyKey === `dl:${i.id}`} onClick={() => onAction("dl", i)} aria-label={`تحميل الفاتورة ${i.invoiceNo}`} title="تحميل PDF"><MIcon name="download" className="!text-[17px]" /></button>
                  <button className={btn} disabled={busyKey === `wa:${i.id}`} onClick={() => onAction("wa", i)} aria-label={`إرسال الفاتورة ${i.invoiceNo} واتساب`} title="إرسال واتساب"><MIcon name="chat" className="!text-[17px]" /></button>
                </div></Td>
              </tr>); })}</tbody>
          </table>
        </div>)}
    </Card>
  );
}

/* ══════════════ المدفوعات ══════════════ */
function PaymentsTab({ payments, canPay, onPay }: { payments: NonNullable<Profile["payments"]>; canPay: boolean; onPay: () => void }) {
  return (
    <Card title="المدفوعات" icon="payments" actions={canPay && <Button size="sm" onClick={onPay}><MIcon name="add" className="!text-[16px]" />تسجيل دفعة</Button>}>
      {payments.length === 0 ? <EmptyState icon="payments" title="لا توجد مدفوعات" /> : (
        <div className="max-h-[65vh] overflow-auto rounded-lg border border-line">
          <table className="w-full min-w-[640px] border-separate border-spacing-0 text-t-sm">
            <thead className="sticky top-0 z-10"><tr><Th>التاريخ</Th><Th end>المبلغ</Th><Th>الطريقة</Th><Th>المرجع</Th><Th>المستخدم</Th><Th>الفرع</Th></tr></thead>
            <tbody>{payments.map((p, i) => (
              <tr key={i} className="hover:bg-ink-3/50">
                <Td cls="whitespace-nowrap text-text-dim">{fmtDT(p.at)}</Td><Td end cls="tnum font-extrabold text-emerald">{fmtCurrency(p.amount, 2)}</Td>
                <Td>{p.kind === "settlement" ? <span className="rounded-md bg-emerald-bg px-1.5 py-0.5 text-t-xs font-bold text-emerald">سداد مستحقات</span> : METHOD[p.method ?? ""] ?? p.method ?? "—"}</Td>
                <Td cls="tnum">{p.reference ?? "—"}</Td><Td cls="text-text-dim">{p.user ?? "—"}</Td><Td cls="text-text-dim">{p.branch ?? "—"}</Td>
              </tr>))}</tbody>
          </table>
        </div>)}
    </Card>
  );
}

/* ══════════════ المشتريات ══════════════ */
function PurchasesTab({ purchases, top }: { purchases: NonNullable<Profile["purchases"]>; top: NonNullable<Profile["topProducts"]> }) {
  const [q, setQ] = useState("");
  const list = purchases.filter((p) => !q.trim() || p.label.toLowerCase().includes(q.trim().toLowerCase()));
  return (
    <div className="grid gap-4 xl:grid-cols-3">
      <Card title="سجل المشتريات" icon="shopping_bag" className="xl:col-span-2" actions={<Input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="الصنف" aria-label="بحث" className="!w-40" />}>
        {list.length === 0 ? <EmptyState icon="shopping_bag" title="لا توجد مشتريات" /> : (
          <div className="max-h-[65vh] overflow-auto rounded-lg border border-line">
            <table className="w-full min-w-[620px] border-separate border-spacing-0 text-t-sm">
              <thead className="sticky top-0 z-10"><tr><Th>الصنف</Th><Th end>الكمية</Th><Th>التاريخ</Th><Th>الفاتورة</Th><Th end>السعر</Th><Th end>الخصم</Th><Th end>الإجمالي</Th></tr></thead>
              <tbody>{list.map((p, i) => (
                <tr key={i} className="hover:bg-ink-3/50"><Td cls="font-bold">{p.label}</Td><Td end cls="tnum">{fmtMoney(p.qty, 0)}</Td><Td cls="whitespace-nowrap text-text-dim">{fmtD(p.at)}</Td>
                  <Td cls="tnum">{p.invoiceNo}</Td><Td end cls="tnum">{fmtMoney(p.price, 2)}</Td><Td end cls="tnum text-text-dim">{p.discount ? fmtMoney(p.discount, 2) : "—"}</Td><Td end cls="tnum font-extrabold">{fmtCurrency(p.total, 2)}</Td></tr>))}</tbody>
            </table>
          </div>)}
      </Card>
      <Card title="الأكثر شراءً" icon="local_fire_department" className="self-start">
        {top.length === 0 ? <p className="py-6 text-center text-t-sm text-text-dim">لا بيانات</p> : (
          <ul className="space-y-3">{top.map((p, i) => (
            <li key={p.label} className="flex items-center gap-3 text-t-sm"><span className="tnum grid h-6 w-6 place-items-center rounded-md bg-ink-3 text-t-xs font-bold">{i + 1}</span>
              <span className="min-w-0 flex-1"><b className="block truncate">{p.label}</b><span className="tnum text-t-xs text-text-dim">{fmtMoney(p.qty, 0)} وحدة · {p.invoices} فاتورة</span></span>
              <span className="tnum font-extrabold">{fmtCurrency(p.total, 2)}</span></li>))}</ul>)}
      </Card>
    </div>
  );
}

/* ══════════════ السيارات ══════════════ */
function VehiclesTab({ customerId, vehicles, canEdit, onChange }: { customerId: string; vehicles: Vehicle[]; canEdit: boolean; onChange: () => Promise<void> }) {
  const [open, setOpen] = useState(false); const [v, setV] = useState({ ...EMPTY_VEHICLE }); const [err, setErr] = useState(""); const [busy, setBusy] = useState(false);
  const [num, setNum] = useState(""); const [let3, setLet3] = useState("");
  const [editing, setEditing] = useState<Vehicle | null>(null);
  const saudi = v.plateType === "saudi";
  const raw = saudi ? `${num} ${let3}` : v.plate;
  const parts = parsePlate(raw);
  const key = plateKey(raw, v.plateType);
  const dupOwn = !!key && vehicles.some((x) => x.id !== editing?.id && plateKey(x.plate, x.plate_type) === key);
  const dupKeys = useMemo(() => {   // لوحات مكرّرة موجودة بالفعل (بيانات قديمة) — تُعلَّم ليحذفها المستخدم
    const seen = new Map<string, number>(); vehicles.forEach((x) => { const k = plateKey(x.plate, x.plate_type); if (k) seen.set(k, (seen.get(k) ?? 0) + 1); });
    return new Set([...seen].filter(([, n]) => n > 1).map(([k]) => k));
  }, [vehicles]);
  const plateErr = saudi && (num || let3) && !parts.valid ? "اللوحة السعودية = 3 حروف + من 1 إلى 4 أرقام" : dupOwn ? "هذه اللوحة مسجّلة بالفعل لهذا العميل" : "";
  function reset() { setEditing(null); setV({ ...EMPTY_VEHICLE }); setNum(""); setLet3(""); setErr(""); }
  function startEdit(x: Vehicle) {
    const pp = parsePlate(x.plate);
    setEditing(x); setErr("");
    setV({ plate: x.plate, plateType: x.plate_type ?? "saudi", brand: x.brand ?? "", makeModel: x.make_model ?? x.name ?? "", modelYear: x.model_year ?? "", carCategory: x.car_category ?? "", cylinders: x.cylinders ?? "", engineSize: x.engine_size ?? "", color: x.color ?? "", chassisNumber: x.chassis_number ?? "", notes: x.notes ?? "" });
    setNum(pp.digits); setLet3(pp.letters); setOpen(true);
  }
  async function add() {
    if (saudi ? !parts.valid : !v.plate.trim()) { setErr(saudi ? "أدخل لوحة صحيحة: من 1 إلى 4 أرقام و3 حروف" : "رقم اللوحة مطلوب"); return; }
    if (dupOwn) { setErr("هذه اللوحة مسجّلة بالفعل لهذا العميل"); return; }
    setBusy(true); setErr("");
    try {
      const plate = saudi ? parts.display : v.plate.trim();
      if (editing) await api(`/customers/vehicles/${editing.id}`, { method: "PUT", body: JSON.stringify({ ...v, plate }) });
      else await api(`/customers/${customerId}/vehicles`, { method: "POST", body: JSON.stringify({ ...v, plate }) });
      reset(); setOpen(false); await onChange();
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  }
  async function removeDuplicates() {
    const seen = new Set<string>(); const extras: Vehicle[] = [];
    for (const x of vehicles) { const k = plateKey(x.plate, x.plate_type); if (!k) continue; if (seen.has(k)) extras.push(x); else seen.add(k); }
    if (!extras.length || !await appConfirm(`سيتم حذف ${extras.length} نسخة مكرّرة والإبقاء على الأقدم من كل لوحة. متابعة؟`)) return;
    setBusy(true);
    try { for (const x of extras) await api(`/customers/vehicles/${x.id}`, { method: "DELETE" }); await onChange(); }
    catch (e) { appAlert(e instanceof Error ? e.message : String(e)); await onChange(); } finally { setBusy(false); }
  }
  async function remove(x: Vehicle) {
    if (!await appConfirm(`حذف سيارة اللوحة «${x.plate}»؟`)) return;
    try { await api(`/customers/vehicles/${x.id}`, { method: "DELETE" }); await onChange(); } catch (e) { appAlert(e instanceof Error ? e.message : String(e)); }
  }
  return (
    <Card title="سيارات العميل" icon="directions_car" actions={canEdit && <Button size="sm" onClick={() => { reset(); setOpen(true); }}><MIcon name="add" className="!text-[16px]" />إضافة سيارة</Button>}>
      {dupKeys.size > 0 && (
        <div role="alert" className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-brass/40 bg-brass-bg px-3 py-2 text-t-sm font-bold text-brass">
          <span>توجد لوحات مكرّرة (نفس الأرقام والحروف). لن يُسمح بتسجيل لوحة مكرّرة بعد الآن.</span>
          {canEdit && <Button size="sm" variant="outline" loading={busy} onClick={removeDuplicates}>حذف النسخ المكرّرة (إبقاء الأقدم)</Button>}
        </div>)}
      {vehicles.length === 0 ? <EmptyState icon="directions_car" title="لا توجد سيارات مسجّلة" description="أضف سيارة العميل لتسهيل التعرف عليه في نقطة البيع." action={canEdit ? <Button onClick={() => { reset(); setOpen(true); }}>إضافة سيارة</Button> : undefined} /> : (
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {vehicles.map((x) => (
            <li key={x.id} className={`rounded-xl border bg-ink p-3.5 ${dupKeys.has(plateKey(x.plate, x.plate_type)) ? "border-brass/60" : "border-line"}`}>
              <div className="flex items-start justify-between gap-2"><PlateBadge plate={x.plate} />{canEdit && <div className="flex gap-0.5"><button onClick={() => startEdit(x)} aria-label={`تعديل ${x.plate}`} title="تعديل" className="grid h-8 w-8 place-items-center rounded-md text-text-dim hover:bg-petrol-soft hover:text-petrol"><MIcon name="edit" className="!text-[18px]" /></button><button onClick={() => remove(x)} aria-label={`حذف ${x.plate}`} title="حذف" className="grid h-8 w-8 place-items-center rounded-md text-text-dim hover:bg-ember-bg hover:text-ember"><MIcon name="delete" className="!text-[18px]" /></button></div>}</div>
              {dupKeys.has(plateKey(x.plate, x.plate_type)) && <span className="mt-1.5 inline-block rounded-md bg-brass-bg px-1.5 py-0.5 text-t-xs font-extrabold text-brass">لوحة مكرّرة</span>}
              <div className="mt-2 text-t-sm font-bold">{[x.brand, x.make_model || x.name, x.model_year].filter(Boolean).join(" ") || "—"}</div>
              <dl className="mt-1.5 grid grid-cols-2 gap-x-3 gap-y-1 text-t-xs text-text-dim">
                {([["اللون", x.color], ["الفئة", x.car_category], ["السلندرات", x.cylinders], ["المحرك", x.engine_size], ["الوقود", x.fuel_type], ["العداد", x.last_odometer != null ? fmtMoney(x.last_odometer, 0) : null], ["نوع الخدمة", x.service_type]] as [string, string | null | undefined][])
                  .filter(([, val]) => val).map(([l, val]) => <div key={l}>{l}: <b className="text-text">{val}</b></div>)}
                {x.chassis_number && <div className="col-span-2">VIN: <b dir="ltr" className="tnum text-text">{x.chassis_number}</b></div>}
                {x.notes && <div className="col-span-2">ملاحظات: <b className="whitespace-pre-wrap text-text">{x.notes}</b></div>}
              </dl>
            </li>))}
        </ul>)}
      <Modal open={open} onClose={() => setOpen(false)} title={editing ? "تعديل بيانات السيارة" : "إضافة سيارة"}>
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); add(); }}>
          <div className="grid gap-2.5 sm:grid-cols-2">
            <Field label="نوع اللوحة"><Select value={v.plateType} onChange={(e) => setV({ ...v, plateType: e.target.value as "saudi" | "other" })}><option value="saudi">سعودية</option><option value="other">أخرى</option></Select></Field>
            <div className="flex items-end justify-center sm:justify-end"><PlateBadge plate={saudi ? (parts.digits && parts.letters ? parts.display : null) : v.plate || null} size="md" /></div>
            {saudi ? <>
              <Field label="الأرقام (1–4) *"><Input value={num} inputMode="numeric" maxLength={4} dir="ltr" className="tnum text-center" autoFocus aria-invalid={!!plateErr} onChange={(e) => setNum(e.target.value.replace(/[^0-9٠-٩]/g, ""))} /></Field>
              <Field label="الحروف (3) *"><Input value={let3} maxLength={3} dir="ltr" className="text-center uppercase" aria-invalid={!!plateErr} onChange={(e) => setLet3(e.target.value.replace(/[^A-Za-z\u0621-\u064A]/g, ""))} /></Field>
            </> : <div className="sm:col-span-2"><Field label="رقم اللوحة *"><Input value={v.plate} autoFocus onChange={(e) => setV({ ...v, plate: e.target.value })} /></Field></div>}
            {plateErr && <p role="alert" className="text-t-xs font-bold text-ember sm:col-span-2">{plateErr}</p>}
            <Field label="الماركة"><ComboSelect key={`b${editing?.id ?? "new"}`} value={v.brand} options={BRANDS} placeholder="اسم الماركة" onChange={(b) => setV((p) => ({ ...p, brand: b, makeModel: b === p.brand ? p.makeModel : "" }))} /></Field>
            <Field label="الموديل"><ComboSelect key={`m${editing?.id ?? "new"}${v.brand}`} value={v.makeModel} options={MODELS[v.brand] ?? []} placeholder="اسم الموديل" onChange={(m) => setV((p) => ({ ...p, makeModel: m }))} /></Field>
            <Field label="سنة الصنع"><ComboSelect key={`y${editing?.id ?? "new"}`} value={v.modelYear} options={YEARS} placeholder="السنة" onChange={(y) => setV((p) => ({ ...p, modelYear: y }))} /></Field>
            <Field label="اللون"><ComboSelect key={`c${editing?.id ?? "new"}`} value={v.color} options={COLORS} placeholder="اللون" onChange={(c) => setV((p) => ({ ...p, color: c }))} /></Field>
            <Field label="الفئة"><ComboSelect key={`k${editing?.id ?? "new"}`} value={v.carCategory} options={CATEGORIES} placeholder="الفئة" onChange={(k) => setV((p) => ({ ...p, carCategory: k }))} /></Field>
            <Field label="عدد السلندرات"><ComboSelect key={`l${editing?.id ?? "new"}`} value={v.cylinders} options={CYLINDERS} placeholder="العدد" onChange={(l) => setV((p) => ({ ...p, cylinders: l }))} /></Field>
            <Field label="حجم المحرك (لتر)"><ComboSelect key={`e${editing?.id ?? "new"}`} value={v.engineSize} options={ENGINE_SIZES} placeholder="مثال: 2.5" onChange={(e) => setV((p) => ({ ...p, engineSize: e }))} /></Field>
            <Field label="رقم الهيكل (VIN)"><Input value={v.chassisNumber} dir="ltr" className="tnum text-end" onChange={(e) => setV({ ...v, chassisNumber: e.target.value })} /></Field>
            <div className="sm:col-span-2"><Field label="ملاحظات"><Textarea rows={2} value={v.notes} onChange={(e) => setV({ ...v, notes: e.target.value })} /></Field></div>
          </div>
          <ErrorNote msg={err} />
          <div className="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={() => setOpen(false)}>إلغاء</Button><Button type="submit" loading={busy} disabled={!!plateErr}>{editing ? "حفظ التعديلات" : "حفظ"}</Button></div>
        </form>
      </Modal>
    </Card>
  );
}

/* ══════════════ الملاحظات ══════════════ */
function NotesTab({ customerId, notes, canNote, onAdded }: { customerId: string; notes: Profile["notes"]; canNote: boolean; onAdded: () => void }) {
  const [text, setText] = useState(""); const [err, setErr] = useState(""); const [busy, setBusy] = useState(false);
  async function add() {
    if (!text.trim()) return;
    setBusy(true); setErr("");
    try { await api(`/customers/${customerId}/notes`, { method: "POST", body: JSON.stringify({ note: text.trim() }) }); setText(""); onAdded(); }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  }
  return (
    <Card title="ملاحظات العميل" icon="sticky_note_2">
      {canNote && (
        <div className="mb-4 space-y-2">
          <Textarea rows={3} value={text} maxLength={2000} onChange={(e) => setText(e.target.value)} placeholder="اكتب ملاحظة عن العميل…" aria-label="ملاحظة جديدة" />
          <ErrorNote msg={err} />
          <div className="flex justify-end"><Button loading={busy} disabled={!text.trim()} onClick={add}>إضافة ملاحظة</Button></div>
        </div>)}
      {notes.length === 0 ? <EmptyState icon="sticky_note_2" title="لا توجد ملاحظات" /> : (
        <ul className="space-y-3">{notes.map((n) => (
          <li key={n.id} className="rounded-xl border border-line bg-ink p-3"><p className="whitespace-pre-wrap break-words text-t-sm">{n.note}</p><div className="mt-1.5 text-t-xs text-text-dim">{n.user ?? "—"} · {fmtDT(n.createdAt)}</div></li>))}</ul>)}
    </Card>
  );
}

/* ══════════════ تسجيل دفعة ══════════════ */
function PayModal({ open, customerId, due, onClose, onDone }: { open: boolean; customerId: string; due: number; onClose: () => void; onDone: () => void }) {
  const [amount, setAmount] = useState(""); const [method, setMethod] = useState<"cash" | "card" | "transfer">("cash"); const [note, setNote] = useState("");
  const [err, setErr] = useState(""); const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) { setAmount(due > 0 ? String(due) : ""); setMethod("cash"); setNote(""); setErr(""); } }, [open, due]);
  async function submit() {
    const a = Number(amount);
    if (!a || a <= 0) { setErr("أدخل مبلغاً صحيحاً"); return; }
    setBusy(true); setErr("");
    try { await api(`/customers/${customerId}/pay`, { method: "POST", body: JSON.stringify({ amount: a, method, note: note.trim() || null }) }); onDone(); }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  }
  return (
    <Modal open={open} onClose={onClose} title="تسجيل دفعة من العميل">
      <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <div className="rounded-lg bg-ink-3 px-3 py-2 text-t-sm">المستحق الحالي: <b className="tnum">{fmtCurrency(due, 2)}</b></div>
        <div className="grid gap-2.5 sm:grid-cols-2">
          <Field label="المبلغ (ر.س) *"><Input type="number" min={0.01} step={0.01} className="tnum" autoFocus value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
          <Field label="طريقة الدفع"><Select value={method} onChange={(e) => setMethod(e.target.value as typeof method)}><option value="cash">نقدي</option><option value="card">شبكة</option><option value="transfer">تحويل بنكي</option></Select></Field>
        </div>
        <Field label="ملاحظة"><Input value={note} onChange={(e) => setNote(e.target.value)} /></Field>
        <ErrorNote msg={err} />
        <div className="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={onClose}>إلغاء</Button><Button type="submit" loading={busy}>تسجيل الدفعة</Button></div>
      </form>
    </Modal>
  );
}
