"use client";
// ملف الصنف 360° — رأس + مؤشرات + مخزون بالمواقع + حركات + مبيعات + مشتريات + موردون + تسعير + باركود + نشاط.
// عرض فقط: كل الأرقام من /products/{id}/profile (الباك اند يحسب). التعديل يمر عبر PUT /products/{id} القائم، والمخزون عبر شاشات الاستلام/التحويل/الجرد.
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { MIcon } from "@/components/m-icon";
import { Button, EmptyState, Input, Badge } from "@/components/ui";
import { appAlert, appConfirm } from "@/components/dialog";
import { KpiCard, KpiSkeleton } from "@/components/dashboard/KpiCard";
import { Skeleton } from "@/components/dashboard/Widget";
import { AreaChart } from "@/components/dashboard/charts/AreaChart";
import { ProductForm } from "@/components/products/ProductForm";
import { BarcodeLabels } from "@/components/products/BarcodeLabels";
import { StockBadge, Thumb, TypeChips } from "@/components/products/parts";
import { barcodeSvg } from "@/lib/code128";
import { fmtCompact } from "@/lib/dashboard/format";
import { ago, fmtCurrency, fmtD, fmtDT, fmtMoney } from "@/lib/customers/format";
import type { ProfileData } from "@/lib/products/types";

type Tab = "overview" | "movements" | "sales" | "purchases" | "pricing" | "barcode";
type Link2 = { id: string; linkType: "substitute" | "related"; productId: string; category: string; name: string; spec: string | null; price: number; stock_qty: number };

const Card = ({ title, icon, actions, children, className = "" }: { title: string; icon?: string; actions?: React.ReactNode; children: React.ReactNode; className?: string }) => (
  <section className={`rounded-card border border-line bg-ink-2 shadow-card ${className}`}>
    <header className="flex items-center justify-between gap-2 px-4 pb-1 pt-3.5 sm:px-5"><h2 className="flex items-center gap-1.5 text-t-md font-black">{icon && <MIcon name={icon} className="!text-[19px] text-petrol" />}{title}</h2>{actions}</header>
    <div className="px-4 pb-4 pt-2 sm:px-5">{children}</div>
  </section>
);
const Th = ({ children, end }: { children?: React.ReactNode; end?: boolean }) => <th scope="col" className={`whitespace-nowrap border-b border-line bg-ink-3 px-3 py-2 text-t-xs font-extrabold text-text-dim ${end ? "text-end" : "text-start"}`}>{children}</th>;
const Td = ({ children, end, cls = "" }: { children?: React.ReactNode; end?: boolean; cls?: string }) => <td className={`border-b border-line/60 px-3 py-2.5 ${end ? "text-end" : ""} ${cls}`}>{children}</td>;
const KIND_TONE: Record<string, string> = { receive: "bg-emerald-bg text-emerald", sale: "bg-petrol-soft text-petrol", transfer: "bg-brass-bg text-brass", return: "bg-ink-3 text-text-dim", adjust: "bg-ink-3 text-text-dim", adjustment: "bg-ink-3 text-text-dim" };

export default function ProductProfilePage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { hasPerm } = useAuth();
  const canEdit = hasPerm("products.edit");
  const canDelete = hasPerm("products.delete");
  const canSell = hasPerm("invoices.create", "invoices.create_direct");
  const canPurchase = hasPerm("purchasing.invoices");
  const canStockOps = hasPerm("inventory.stocktake", "products.view_stock");

  const [d, setD] = useState<ProfileData | null>(null);
  const [links, setLinks] = useState<Link2[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [loading, setLoading] = useState(true); const [error, setError] = useState("");
  const [tab, setTab] = useState<Tab>("overview");
  const [edit, setEdit] = useState(false); const [labels, setLabels] = useState(false); const [menu, setMenu] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; msg: string } | null>(null);
  const [trendKey, setTrendKey] = useState<"daily" | "weekly" | "monthly">("daily"); const [trendMetric, setTrendMetric] = useState<"revenue" | "qty">("revenue");
  const [mq, setMq] = useState(""); const [mkind, setMkind] = useState("");

  useEffect(() => { const t = new URLSearchParams(window.location.search).get("tab") as Tab | null; if (t && ["overview", "movements", "sales", "purchases", "pricing", "barcode"].includes(t)) setTab(t); }, []);
  const switchTab = (t: Tab) => { setTab(t); const u = new URL(window.location.href); u.searchParams.set("tab", t); window.history.replaceState(null, "", u); };
  const flash = (ok: boolean, msg: string) => { setNotice({ ok, msg }); setTimeout(() => setNotice(null), 6000); };

  const load = useCallback(async () => {
    try {
      setD(await api<ProfileData>(`/products/${id}/profile`)); setError("");
      api<Link2[]>(`/products/${id}/links`).then(setLinks).catch(() => setLinks([]));
      api<{ facets: { categories: { name: string }[] } }>("/products/overview?pageSize=5").then((o) => setCategories(o.facets.categories.map((c) => c.name).filter((n) => n !== "غير مصنّف"))).catch(() => {});
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setLoading(false); }
  }, [id]);
  useEffect(() => { load(); }, [load]);

  const p = d?.product;
  const trend = useMemo(() => {
    const rows = d?.trend?.[trendKey] ?? [];
    const fmtL = (s: string) => `⁦${s.slice(8, 10)}/${s.slice(5, 7)}⁩`;
    return { labels: rows.map((r) => (trendKey === "monthly" ? `⁦${r.date.slice(5, 7)}/${r.date.slice(0, 4)}⁩` : fmtL(r.date))), values: rows.map((r) => (trendMetric === "revenue" ? r.revenue : r.qty)) };
  }, [d, trendKey, trendMetric]);
  const moves = useMemo(() => (d?.movements ?? []).filter((m) => (!mkind || m.kind === mkind) && (!mq.trim() || `${m.doc ?? ""} ${m.note ?? ""} ${m.label} ${m.from} ${m.to} ${m.user ?? ""}`.toLowerCase().includes(mq.trim().toLowerCase()))), [d, mq, mkind]);

  async function deactivate() {
    if (!p || !await appConfirm(`تعطيل الصنف «${p.name}»؟ الفواتير والحركات القديمة تبقى محفوظة.`)) return;
    try { await api(`/products/${p.id}`, { method: "DELETE" }); flash(true, "تم تعطيل الصنف"); await load(); } catch (e) { await appAlert(e instanceof Error ? e.message : String(e)); }
  }
  async function activate() {
    if (!p) return;
    try { await api("/products/bulk-status", { method: "POST", body: JSON.stringify({ ids: [p.id], active: true }) }); flash(true, "تم تفعيل الصنف"); await load(); } catch (e) { await appAlert(e instanceof Error ? e.message : String(e)); }
  }
  const copy = async (t: string) => { try { await navigator.clipboard.writeText(t); flash(true, "تم النسخ"); } catch { flash(false, "تعذر النسخ"); } };
  function downloadSvg() {
    const code = p?.barcode || p?.sku; if (!code) return;
    const url = URL.createObjectURL(new Blob([barcodeSvg(code, { height: 60 })], { type: "image/svg+xml" }));
    const a = document.createElement("a"); a.href = url; a.download = `barcode-${code}.svg`; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 3000);
  }

  if (loading) return <div className="mx-auto max-w-[1400px] space-y-4"><Skeleton height={120} /><div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{Array.from({ length: 8 }).map((_, i) => <KpiSkeleton key={i} />)}</div><Skeleton height={300} /></div>;
  if (error || !d || !p) return (
    <div role="alert" className="mx-auto max-w-md py-16 text-center"><MIcon name="inventory_2" className="!text-[44px] text-ember" /><h1 className="mt-2 page-title">تعذر تحميل ملف الصنف</h1><p className="page-desc">{error}</p>
      <div className="mt-4 flex justify-center gap-2"><Button onClick={() => { setLoading(true); load(); }}>إعادة المحاولة</Button><Button variant="outline" onClick={() => router.push("/products")}>العودة للأصناف</Button></div></div>);

  const k = d.kpis;
  const tabs: { key: Tab; label: string; icon: string; show: boolean; n?: number }[] = [
    { key: "overview", label: "نظرة عامة", icon: "dashboard", show: true },
    { key: "movements", label: "حركة المخزون", icon: "swap_vert", show: !p.isService, n: d.movements.length },
    { key: "sales", label: "المبيعات", icon: "point_of_sale", show: !!d.sales, n: d.sales?.length },
    { key: "purchases", label: "المشتريات والموردون", icon: "shopping_bag", show: !!d.purchases && !p.isService, n: d.purchases?.length },
    { key: "pricing", label: "التسعير", icon: "sell", show: true },
    { key: "barcode", label: "الباركود", icon: "barcode", show: true },
  ];
  const stockTone = p.isService ? "service" : (d.totalStock ?? 0) <= 0 ? "out" : p.minQty && (d.totalStock ?? 0) <= p.minQty ? "low" : "ok";

  return (
    <div className="cx-enter mx-auto w-full max-w-[1400px] space-y-4 pb-8" onClick={() => menu && setMenu(false)}>
      <nav aria-label="breadcrumb"><Link href="/products" className="inline-flex items-center gap-1 text-t-sm font-bold text-petrol hover:underline"><MIcon name="arrow_forward" className="!text-[16px] ltr:rotate-180" />الأصناف</Link></nav>

      <header className="rounded-card border border-line bg-ink-2 p-4 shadow-card sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 items-center gap-4">
            <Thumb id={p.id} has={p.hasImage} size={76} name={p.name} />
            <div className="min-w-0">
              <h1 className="page-title">{p.name}{p.spec ? <bdi dir="ltr" className="ms-2 font-bold text-text-dim">{p.spec}</bdi> : null}</h1>
              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-t-sm text-text-dim">
                {p.sku && <button onClick={() => copy(p.sku!)} title="نسخ" className="tnum hover:text-petrol">SKU: <b dir="ltr">{p.sku}</b></button>}
                {p.barcode && <button onClick={() => copy(p.barcode!)} title="نسخ" className="tnum hover:text-petrol">الباركود: <b dir="ltr">{p.barcode}</b></button>}
                {p.brand && <span>العلامة: <b className="text-text">{p.brand}</b></span>}{p.category && <span>التصنيف: <b className="text-text">{p.category}</b></span>}
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                {p.isActive ? <Badge tone="success">نشط</Badge> : <Badge tone="neutral">غير نشط</Badge>}
                <StockBadge status={stockTone} /><TypeChips p={p} />
              </div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2" onClick={(e) => e.stopPropagation()}>
            {canEdit && <Button variant="outline" onClick={() => setEdit(true)}><MIcon name="edit" className="!text-[18px]" />تعديل</Button>}
            {canSell && !p.isService && <Link href="/sales/direct" className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-ink-2 px-4 py-2 text-t-md font-semibold hover:border-petrol hover:text-petrol"><MIcon name="point_of_sale" className="!text-[18px]" />بيع</Link>}
            {canPurchase && !p.isService && <Link href="/purchases" className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-ink-2 px-4 py-2 text-t-md font-semibold hover:border-petrol hover:text-petrol"><MIcon name="shopping_bag" className="!text-[18px]" />شراء</Link>}
            <div className="relative">
              <Button variant="outline" aria-haspopup="menu" aria-expanded={menu} aria-label="المزيد" onClick={() => setMenu(!menu)}><MIcon name="more_horiz" className="!text-[20px]" /></Button>
              {menu && (
                <div role="menu" className="absolute end-0 top-full z-30 mt-1 w-56 overflow-hidden rounded-card border border-line bg-ink-2 shadow-xl">
                  {canStockOps && !p.isService && <Link role="menuitem" href="/inventory" className="flex items-center gap-2 px-3 py-2.5 text-t-sm font-bold hover:bg-ink-3"><MIcon name="swap_horiz" className="!text-[18px] text-petrol" />تحويل / استلام</Link>}
                  {canStockOps && !p.isService && <Link role="menuitem" href="/inventory/stocktake" className="flex items-center gap-2 px-3 py-2.5 text-t-sm font-bold hover:bg-ink-3"><MIcon name="fact_check" className="!text-[18px] text-petrol" />جرد</Link>}
                  <button role="menuitem" onClick={() => { setMenu(false); setLabels(true); }} className="flex w-full items-center gap-2 px-3 py-2.5 text-start text-t-sm font-bold hover:bg-ink-3"><MIcon name="barcode" className="!text-[18px] text-petrol" />طباعة باركود</button>
                  <Link role="menuitem" href="/reports" className="flex items-center gap-2 px-3 py-2.5 text-t-sm font-bold hover:bg-ink-3"><MIcon name="bar_chart" className="!text-[18px] text-petrol" />التقارير</Link>
                  {canEdit && !p.isActive && <button role="menuitem" onClick={activate} className="flex w-full items-center gap-2 border-t border-line px-3 py-2.5 text-start text-t-sm font-bold text-emerald hover:bg-ink-3"><MIcon name="check_circle" className="!text-[18px]" />تفعيل الصنف</button>}
                  {canDelete && p.isActive && <button role="menuitem" onClick={deactivate} className="flex w-full items-center gap-2 border-t border-line px-3 py-2.5 text-start text-t-sm font-bold text-ember hover:bg-ink-3"><MIcon name="block" className="!text-[18px]" />تعطيل الصنف</button>}
                </div>)}
            </div>
          </div>
        </div>
      </header>

      {notice && <div role="status" className={`rounded-card px-4 py-2.5 text-t-sm font-bold ${notice.ok ? "bg-emerald-bg text-emerald" : "bg-ember-bg text-ember"}`}>{notice.msg}</div>}

      <section aria-label="KPI" className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {!p.isService && <div role="presentation" onClick={() => switchTab("movements")} className="contents"><KpiCard label="المخزون الحالي" icon="inventory_2" accent="var(--petrol)" value={fmtMoney(d.totalStock ?? 0, 0)} sub={p.minQty ? `الحد الأدنى: ${p.minQty}` : undefined} subTone={stockTone === "out" ? "danger" : stockTone === "low" ? "warning" : "neutral"} /></div>}
        {d.stockValue != null && <KpiCard label="قيمة المخزون" tip="الكمية × التكلفة المعتمدة" icon="account_balance_wallet" accent="var(--chart-revenue)" value={fmtCurrency(d.stockValue, 2)} />}
        {k.salesQty != null && <div role="presentation" onClick={() => switchTab("sales")} className="contents"><KpiCard label="الكمية المباعة" icon="shopping_cart_checkout" accent="var(--petrol)" value={fmtMoney(k.salesQty, 0)} sub={`${k.salesInvoices ?? 0} فاتورة`} /></div>}
        {k.salesRevenue != null && <KpiCard label="إيراد المبيعات" tip="قبل الضريبة" icon="payments" accent="var(--chart-revenue)" value={fmtCurrency(k.salesRevenue, 2)} />}
        {k.purchaseQty != null && <div role="presentation" onClick={() => switchTab("purchases")} className="contents"><KpiCard label="الكمية المشتراة" icon="shopping_bag" accent="var(--brass)" value={fmtMoney(k.purchaseQty, 0)} /></div>}
        {k.purchaseCost != null && <KpiCard label="تكلفة المشتريات" icon="receipt_long" accent="var(--chart-expense)" value={fmtCurrency(k.purchaseCost, 2)} />}
        {p.margin != null && <KpiCard label="هامش السعر" tip="سعر البيع الحالي مقابل التكلفة الحالية" icon="percent" accent="var(--chart-profit)" value={`${p.margin}%`} sub={p.unitProfit != null ? `ربح الوحدة ${fmtCurrency(p.unitProfit, 2)}` : undefined} />}
        <KpiCard label="آخر بيع" icon="event" accent="var(--petrol)" value={ago(k.lastSaleAt)} sub={k.lastSaleAt ? fmtD(k.lastSaleAt) : undefined} />
        {k.lastPurchaseAt !== undefined && <KpiCard label="آخر شراء" icon="event_available" accent="var(--brass)" value={ago(k.lastPurchaseAt)} sub={k.lastPurchaseCost != null ? `بتكلفة ${fmtCurrency(k.lastPurchaseCost, 2)}` : undefined} />}
      </section>

      <div role="tablist" aria-label="أقسام ملف الصنف" className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1 [scrollbar-width:none]">
        {tabs.filter((t) => t.show).map((t) => (
          <button key={t.key} role="tab" aria-selected={tab === t.key} onClick={() => switchTab(t.key)} className={`inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-card px-3.5 py-2 text-t-sm font-bold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-petrol ${tab === t.key ? "bg-petrol text-white" : "bg-ink-2 text-text-dim hover:bg-ink-3"}`}>
            <MIcon name={t.icon} className="!text-[17px]" />{t.label}{t.n != null && <span className="tnum text-t-xs opacity-80">({t.n})</span>}</button>))}
      </div>

      {tab === "overview" && (
        <div className="grid gap-4 xl:grid-cols-3">
          <div className="space-y-4 xl:col-span-2">
            {!p.isService && (
              <Card title="المخزون حسب الموقع" icon="warehouse">
                {d.stock.length === 0 ? <EmptyState icon="inventory_2" title="لا يوجد رصيد مسجّل لهذا الصنف" description="يظهر الرصيد بعد أول استلام أو تحويل." /> : (
                  <div className="overflow-x-auto rounded-lg border border-line"><table className="w-full min-w-[520px] border-separate border-spacing-0 text-t-sm">
                    <thead><tr><Th>الموقع</Th><Th end>الكمية</Th><Th end>الحد الأدنى</Th><Th>الرف</Th><Th>الحالة</Th></tr></thead>
                    <tbody>{d.stock.map((s) => (
                      <tr key={s.locType + s.locId} className="hover:bg-ink-3/50"><Td cls="font-bold">{s.locName}</Td><Td end cls="tnum font-extrabold">{fmtMoney(s.qty, 0)}</Td><Td end cls="tnum text-text-dim">{s.minQty || "—"}</Td><Td cls="text-text-dim">{s.shelf || "—"}</Td><Td><StockBadge status={s.status} /></Td></tr>))}</tbody>
                    <tfoot><tr className="bg-ink-3"><td className="px-3 py-2 text-t-xs font-extrabold text-text-dim">الإجمالي</td><td className="tnum px-3 py-2 text-end font-black">{fmtMoney(d.totalStock ?? 0, 0)}</td><td colSpan={3} /></tr></tfoot>
                  </table></div>)}
              </Card>)}
            {d.trend && (
              <Card title="اتجاه المبيعات" icon="monitoring" actions={
                <div className="flex gap-1.5">
                  {(["daily", "weekly", "monthly"] as const).map((x) => <button key={x} onClick={() => setTrendKey(x)} aria-pressed={trendKey === x} className={`rounded-full border px-2.5 py-1 text-t-xs font-bold ${trendKey === x ? "border-petrol bg-petrol text-white" : "border-line text-text-dim"}`}>{{ daily: "يومي", weekly: "أسبوعي", monthly: "شهري" }[x]}</button>)}
                  <span className="mx-1 w-px bg-line" />
                  {(["revenue", "qty"] as const).map((x) => <button key={x} onClick={() => setTrendMetric(x)} aria-pressed={trendMetric === x} className={`rounded-full border px-2.5 py-1 text-t-xs font-bold ${trendMetric === x ? "border-petrol bg-petrol text-white" : "border-line text-text-dim"}`}>{x === "revenue" ? "الإيراد" : "الكمية"}</button>)}
                </div>}>
                {trend.values.length === 0 ? <p className="py-8 text-center text-t-sm text-text-dim">لا مبيعات في هذه الفترة</p> :
                  <AreaChart ariaLabel="اتجاه المبيعات" labels={trend.labels} height={220} formatValue={(n) => (trendMetric === "revenue" ? fmtCurrency(n, 2) : fmtMoney(n, 0))} formatTick={fmtCompact}
                    series={[{ key: "m", label: trendMetric === "revenue" ? "الإيراد" : "الكمية", color: "var(--chart-revenue)", values: trend.values, area: true }]} />}
              </Card>)}
            {links.length > 0 && (
              <Card title="أصناف بديلة / مرتبطة" icon="link">
                <ul className="space-y-2">{links.map((l) => (
                  <li key={l.id}><Link href={`/products/${l.productId}`} className="flex items-center justify-between gap-3 rounded-lg border border-line px-3 py-2 text-t-sm hover:border-petrol">
                    <span className="min-w-0"><b className="block truncate">{l.name}{l.spec ? ` ${l.spec}` : ""}</b><span className="text-t-xs text-text-dim">{l.linkType === "substitute" ? "بديل" : "مرتبط"} · {l.category}</span></span>
                    <span className="tnum shrink-0 text-t-xs text-text-dim">{fmtCurrency(l.price, 2)} · مخزون {fmtMoney(l.stock_qty, 0)}</span></Link></li>))}</ul>
              </Card>)}
          </div>
          <div className="space-y-4">
            {d.suppliers && d.suppliers.length > 0 && (
              <Card title="الموردون" icon="local_shipping">
                <ul className="space-y-2.5">{d.suppliers.map((s) => (
                  <li key={s.name} className="flex items-center justify-between gap-2 text-t-sm"><span className="min-w-0"><Link href="/suppliers" className="block truncate font-bold hover:text-petrol hover:underline">{s.name}</Link><span className="text-t-xs text-text-dim">آخر توريد {ago(s.lastAt)}{s.lastCost != null ? ` · ${fmtCurrency(s.lastCost, 2)}` : ""}</span></span><span className="tnum shrink-0 text-t-xs text-text-dim">{fmtMoney(s.qty, 0)} وحدة</span></li>))}</ul>
              </Card>)}
            <Card title="سجل النشاط" icon="history">
              {d.timeline.length === 0 ? <p className="py-6 text-center text-t-sm text-text-dim">لا يوجد نشاط بعد</p> : (
                <ul className="space-y-2.5 border-s border-line ps-4">{d.timeline.slice(0, 14).map((e, i) => (
                  <li key={i} className="relative"><span className={`absolute -start-[21px] top-1 h-2.5 w-2.5 rounded-full ring-2 ring-ink-2 ${e.type === "sale" ? "bg-petrol" : e.type === "receive" ? "bg-emerald" : "bg-brass"}`} />
                    <div className="flex items-start justify-between gap-2 text-t-sm"><span className="break-words">{e.title}</span>{e.amount != null && <span className="tnum shrink-0 font-extrabold">{fmtCurrency(e.amount, 2)}</span>}</div><div className="text-t-xs text-text-dim">{fmtDT(e.at)}</div></li>))}</ul>)}
            </Card>
          </div>
        </div>)}

      {tab === "movements" && (
        <Card title="حركة المخزون" icon="swap_vert" actions={<div className="flex gap-2"><select value={mkind} onChange={(e) => setMkind(e.target.value)} aria-label="نوع الحركة" className="rounded-lg border border-line bg-ink-2 px-2 py-1 text-t-sm"><option value="">كل الحركات</option><option value="sale">بيع</option><option value="receive">استلام</option><option value="transfer">تحويل</option><option value="return">مرتجع</option><option value="adjust">تسوية جرد</option></select><Input type="search" value={mq} onChange={(e) => setMq(e.target.value)} placeholder="بحث بالمستند أو الموقع" aria-label="بحث" className="!w-44" /></div>}>
          <p className="mb-2 text-t-xs text-text-dim">سجل للقراءة فقط — لا يمكن تعديل حركة تاريخية من هنا. التعديل يتم عبر سندات الاستلام والتحويل والجرد.</p>
          {moves.length === 0 ? <EmptyState icon="swap_vert" title="لا توجد حركات" /> : (
            <div className="max-h-[65vh] overflow-auto rounded-lg border border-line"><table className="w-full min-w-[680px] border-separate border-spacing-0 text-t-sm">
              <thead className="sticky top-0 z-10"><tr><Th>التاريخ</Th><Th>النوع</Th><Th>المستند</Th><Th>الموقع</Th><Th end>الكمية</Th><Th>المستخدم</Th><Th>ملاحظة</Th></tr></thead>
              <tbody>{moves.map((m, i) => (
                <tr key={i} className="hover:bg-ink-3/50"><Td cls="whitespace-nowrap text-text-dim">{fmtDT(m.at)}</Td>
                  <Td><span className={`rounded-md px-1.5 py-0.5 text-t-xs font-bold ${KIND_TONE[m.kind] ?? "bg-ink-3"}`}>{m.label}</span></Td>
                  <Td cls="tnum font-bold">{m.invoiceId ? <Link href={`/sales/history?invoiceNo=${encodeURIComponent(m.doc ?? "")}`} className="hover:text-petrol hover:underline">{m.doc}</Link> : m.doc || "—"}</Td>
                  <Td cls="text-text-dim">{m.kind === "transfer" ? `${m.from} ← ${m.to}`.replace("← ", "→ ") : m.to || m.from || "—"}</Td>
                  <Td end cls={`tnum font-extrabold ${m.qty < 0 ? "text-ember" : "text-emerald"}`}>{m.qty > 0 ? "+" : ""}{fmtMoney(m.qty, 0)}</Td><Td cls="text-text-dim">{m.user ?? "—"}</Td><Td cls="max-w-[200px] truncate text-text-dim">{m.supplier || m.note || "—"}</Td></tr>))}</tbody>
            </table></div>)}
        </Card>)}

      {tab === "sales" && d.sales && (
        <Card title="مبيعات الصنف" icon="point_of_sale">
          {d.sales.length === 0 ? <EmptyState icon="point_of_sale" title="لا توجد مبيعات لهذا الصنف" /> : (
            <div className="max-h-[65vh] overflow-auto rounded-lg border border-line"><table className="w-full min-w-[720px] border-separate border-spacing-0 text-t-sm">
              <thead className="sticky top-0 z-10"><tr><Th>التاريخ</Th><Th>الفاتورة</Th><Th>الفرع</Th><Th>العميل</Th><Th end>الكمية</Th><Th end>السعر</Th><Th end>الخصم</Th><Th end>الإجمالي</Th></tr></thead>
              <tbody>{d.sales.map((s, i) => (
                <tr key={i} className={`hover:bg-ink-3/50 ${s.isReturned ? "opacity-60" : ""}`}><Td cls="whitespace-nowrap text-text-dim">{fmtDT(s.at)}</Td>
                  <Td cls="tnum font-bold"><Link href={`/sales/history?invoiceNo=${encodeURIComponent(s.invoiceNo)}`} className="hover:text-petrol hover:underline">{s.invoiceNo}</Link>{s.isReturned && <span className="ms-1 text-t-xs text-ember">مرتجع</span>}</Td>
                  <Td cls="text-text-dim">{s.branch ?? "—"}</Td><Td>{s.customer || "بيع نقدي"}</Td><Td end cls="tnum">{fmtMoney(s.qty, 0)}</Td><Td end cls="tnum">{fmtMoney(s.price, 2)}</Td><Td end cls="tnum text-text-dim">{s.discount ? fmtMoney(s.discount, 2) : "—"}</Td><Td end cls="tnum font-extrabold">{fmtCurrency(s.total, 2)}</Td></tr>))}</tbody>
            </table></div>)}
        </Card>)}

      {tab === "purchases" && d.purchases && (
        <div className="grid gap-4 xl:grid-cols-3">
          <Card title="مشتريات الصنف (الاستلام)" icon="shopping_bag" className="xl:col-span-2">
            {d.purchases.length === 0 ? <EmptyState icon="shopping_bag" title="لا توجد عمليات استلام" /> : (
              <div className="max-h-[65vh] overflow-auto rounded-lg border border-line"><table className="w-full min-w-[620px] border-separate border-spacing-0 text-t-sm">
                <thead className="sticky top-0 z-10"><tr><Th>التاريخ</Th><Th>المورد</Th><Th>المستند</Th><Th end>الكمية</Th><Th end>التكلفة</Th><Th end>الإجمالي</Th><Th>المستودع</Th></tr></thead>
                <tbody>{d.purchases.map((m, i) => (
                  <tr key={i} className="hover:bg-ink-3/50"><Td cls="whitespace-nowrap text-text-dim">{fmtDT(m.at)}</Td><Td>{m.supplier ?? "—"}</Td><Td cls="tnum">{m.doc ?? "—"}</Td><Td end cls="tnum">{fmtMoney(m.qty, 0)}</Td><Td end cls="tnum">{m.unitCost == null ? "—" : fmtMoney(m.unitCost, 2)}</Td><Td end cls="tnum font-extrabold">{m.total == null ? "—" : fmtCurrency(m.total, 2)}</Td><Td cls="text-text-dim">{m.location}</Td></tr>))}</tbody>
              </table></div>)}
          </Card>
          <Card title="الموردون" icon="local_shipping" className="self-start">
            {!d.suppliers?.length ? <p className="py-6 text-center text-t-sm text-text-dim">لا موردون مسجّلون</p> : (
              <ul className="space-y-3">{d.suppliers.map((s) => <li key={s.name} className="text-t-sm"><div className="flex justify-between gap-2"><b>{s.name}</b><span className="tnum font-extrabold">{fmtCurrency(s.spend, 2)}</span></div><div className="text-t-xs text-text-dim">{fmtMoney(s.qty, 0)} وحدة · آخر سعر {s.lastCost != null ? fmtCurrency(s.lastCost, 2) : "—"} · {ago(s.lastAt)}</div></li>)}</ul>)}
          </Card>
        </div>)}

      {tab === "pricing" && (
        <Card title="التسعير والربحية" icon="sell">
          <dl className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4">
            {([["سعر البيع (قبل الضريبة)", fmtCurrency(p.price, 2)], ["سعر البيع (شامل الضريبة)", fmtCurrency(p.priceVat, 2)], ...(p.cost != null ? [["التكلفة المعتمدة", fmtCurrency(p.cost, 2)], ["ربح الوحدة", p.unitProfit != null ? fmtCurrency(p.unitProfit, 2) : "—"], ["هامش الربح", p.margin != null ? `${p.margin}%` : "—"]] : []), ["الحد الأدنى للمخزون", String(p.minQty || "—")], ["الوحدة", p.unit || "—"], ["فترة التغيير (كم)", p.serviceIntervalKm ? fmtMoney(p.serviceIntervalKm, 0) : "—"]] as [string, string][]).map(([l, v]) => (
              <div key={l}><dt className="text-t-xs text-text-dim">{l}</dt><dd className="tnum text-t-lg font-extrabold">{v}</dd></div>))}
          </dl>
          <p className="mt-4 rounded-lg bg-ink-3 px-3 py-2 text-t-xs leading-6 text-text-dim">السعر شامل الضريبة يُحسب في قاعدة البيانات من سعر البيع ونسبة ضريبة الشركة. تغيير السعر يسري على العمليات الجديدة فقط ولا يغيّر الفواتير ولا القيود السابقة. لقوائم الأسعار الخاصة ومعدلات الخصم بالكمية: <Link href="/settings/price-lists" className="font-bold text-petrol underline">قوائم الأسعار</Link> · <Link href="/products/manage" className="font-bold text-petrol underline">أدوات الأصناف</Link>.</p>
        </Card>)}

      {tab === "barcode" && (
        <Card title="الباركود" icon="barcode" actions={<Button size="sm" onClick={() => setLabels(true)}><MIcon name="print" className="!text-[16px]" />طباعة الملصقات</Button>}>
          {!(p.barcode || p.sku) ? <EmptyState icon="barcode" title="لا يوجد باركود ولا SKU لهذا الصنف" description="أضف باركوداً من نموذج التعديل." action={canEdit ? <Button onClick={() => setEdit(true)}>تعديل الصنف</Button> : undefined} /> : (
            <div className="flex flex-wrap items-center gap-6">
              <div className="rounded-card border border-line bg-ink-2 p-4 text-center" dangerouslySetInnerHTML={{ __html: barcodeSvg((p.barcode || p.sku)!, { height: 70, module: 1.8 }) + `<div style="font:600 13px monospace;direction:ltr;margin-top:4px">${(p.barcode || p.sku)!.replace(/[<>&]/g, "")}</div>` }} />
              <div className="flex flex-col gap-2"><span className="text-t-sm text-text-dim">النوع: Code 128</span>
                <div className="flex gap-2"><Button size="sm" variant="outline" onClick={() => copy((p.barcode || p.sku)!)}><MIcon name="content_copy" className="!text-[16px]" />نسخ</Button><Button size="sm" variant="outline" onClick={downloadSvg}><MIcon name="download" className="!text-[16px]" />تنزيل SVG</Button></div></div>
            </div>)}
        </Card>)}

      <ProductForm open={edit} product={{ ...p, hasImage: p.hasImage, brand: p.brand } as never} categories={categories} canCost={d.canCost} onClose={() => setEdit(false)} onSaved={() => { setEdit(false); flash(true, "تم حفظ الصنف"); load(); }} />
      <BarcodeLabels open={labels} items={[{ id: p.id, name: p.name, spec: p.spec, sku: p.sku, barcode: p.barcode, priceVat: p.priceVat }]} onClose={() => setLabels(false)} />
    </div>
  );
}
