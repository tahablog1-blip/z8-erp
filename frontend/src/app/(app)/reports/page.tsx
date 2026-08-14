"use client";
// شاشة التقارير — الإقرار الضريبي وملخّص المبيعات
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Badge, Card, ErrorNote, Field, Input, Select, Tabs } from "@/components/ui";
import { SalesSummary, VatReturn, money } from "@/modules/accounting/types";
import { printReport, tableHTML, kpisHTML } from "@/lib/print";

type Tab = "vat" | "sales" | "techs";

// ── تقرير إنتاجية الفنيين ──
type TechReport = {
  from: string; to: string; totalCars: number;
  rows: { id: string; name: string; role: string | null; branchId: string | null;
          filling: number; fitting: number; checking: number; totalCars: number }[];
};
const ROLE_AR: Record<string, string> = { filling: "تعبئة", fitting: "فك وتركيب", checking: "تشييك" };

export default function ReportsPage() {
  // ── مقارنة الفروع: نوافذ متحركة + الشهر التقويمي (من يوم 1 حتى الآن، وتصفح الماضي) ──
  const [cmpDays, setCmpDays] = useState(30);
  const [cmpMonth, setCmpMonth] = useState<string | null>(null);  // "YYYY-MM" أو null = وضع الأيام
  const [cmp, setCmp] = useState<null | { days: number; month?: string | null; branches: { id: string; name: string; invoices: number; revenue: number; avgInvoice: number; grossProfit?: number; carsServed: number }[] }>(null);
  const [cmpErr, setCmpErr] = useState("");
  useEffect(() => {
    const q = cmpMonth ? `month=${cmpMonth}` : `days=${cmpDays}`;
    setCmpErr("");
    api<typeof cmp>(`/reports/branches-compare?${q}`)
      .then(setCmp)
      .catch((e) => setCmpErr(e instanceof Error ? e.message : "تعذر التحميل"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cmpDays, cmpMonth]);
  const thisMonth = new Date().toISOString().slice(0, 7);
  function shiftMonth(delta: number) {
    const [y, m] = (cmpMonth ?? thisMonth).split("-").map(Number);
    const d = new Date(y, m - 1 + delta, 1);
    const next = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    if (next <= thisMonth) setCmpMonth(next);
  }
  const monthLabel = (() => {
    if (!cmpMonth) return "";
    const [y, m] = cmpMonth.split("-").map(Number);
    return new Date(y, m - 1, 1).toLocaleDateString("ar", { month: "long", year: "numeric" });
  })();
  const { hasPerm } = useAuth();
  const canVat = hasPerm("accounting.view_vat");
  const canSales = hasPerm("reports.sales");

  const [tab, setTab] = useState<Tab>(canVat ? "vat" : "sales");
  const [vat, setVat] = useState<VatReturn | null>(null);
  const [sales, setSales] = useState<SalesSummary | null>(null);
  const [techs, setTechs] = useState<TechReport | null>(null);
  const [techBranch, setTechBranch] = useState("");
  const [branchList, setBranchList] = useState<{ id: string; name: string }[]>([]);
  useEffect(() => {
    api<{ id: string; name: string }[]>("/branches").then(setBranchList).catch(() => {});
  }, []);
  const [pageErr, setPageErr] = useState("");

  const today = new Date().toISOString().slice(0, 10);
  const [from, setFrom] = useState(today.slice(0, 8) + "01");
  const [to, setTo] = useState(today);
  const [groupBy, setGroupBy] = useState<"day" | "month">("day");

  async function loadVat() {
    try { setVat(await api<VatReturn>(`/reports/vat-return?from=${from}&to=${to}`)); setPageErr(""); }
    catch (e: any) { setPageErr(e.message); }
  }
  async function loadSales() {
    try { setSales(await api<SalesSummary>(`/reports/sales-summary?from=${from}&to=${to}&groupBy=${groupBy}`)); setPageErr(""); }
    catch (e: any) { setPageErr(e.message); }
  }
  async function loadTechs() {
    try {
      const b = techBranch ? `&branchId=${techBranch}` : "";
      setTechs(await api<TechReport>(`/cars/tech-report?from=${from}&to=${to}${b}`));
      setPageErr("");
    } catch (e: any) { setPageErr(e.message); }
  }

  useEffect(() => {
    if (tab === "vat" && canVat) loadVat();
    if (tab === "sales" && canSales) loadSales();
    if (tab === "techs" && canSales) loadTechs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, techBranch]);

  function refresh() {
    if (tab === "vat") loadVat();
    else if (tab === "sales") loadSales();
    else loadTechs();
  }

  // ══════════ الطباعة ══════════
  function printCurrent() {
    const period = `الفترة من ${from} إلى ${to}`;
    if (tab === "vat" && vat) {
      const body =
        kpisHTML([
          { label: "صافي ضريبة المخرجات", value: money(vat.outputVat) },
          { label: "ضريبة المدخلات", value: money(vat.inputVat) },
          { label: vat.netVat >= 0 ? "مستحق للهيئة" : "مسترد", value: money(Math.abs(vat.netVat)) },
        ]) +
        `<h2 class="sec">ضريبة المخرجات (المبيعات)</h2>` +
        tableHTML(["البند", "القيمة (ر.س)"], [
          ["المبيعات قبل الضريبة", money(vat.salesEx)],
          ["إجمالي الضريبة قبل المرتجعات", money(vat.grossVat)],
          [`مرتجعات (${vat.returnsCount})`, "-" + money(vat.returnsVat)],
          ["صافي ضريبة المخرجات", money(vat.outputVat)],
        ], { numericCols: [1] }) +
        `<h2 class="sec">ضريبة المدخلات (المشتريات)</h2>` +
        tableHTML(["البند", "القيمة (ر.س)"], [
          ["المشتريات قبل الضريبة", money(vat.purchasesEx)],
          ["إجمالي ضريبة المدخلات", money(vat.inputVat)],
        ], { numericCols: [1] }) +
        `<h2 class="sec">تفصيل حسب المصدر</h2>` +
        tableHTML(["المصدر", "عدد الفواتير", "قبل الضريبة", "ضريبة المخرجات"],
          Object.entries(vat.bySource).map(([src, v]: [string, any]) => [
            src === "car" ? "خدمة (سيارات)" : "بيع بالقطعة",
            v.invoiceCount, money(v.salesEx), money(v.outputVat),
          ]), { numericCols: [1, 2, 3] });
      printReport("الإقرار الضريبي (VAT)", period, body);
    }
    if (tab === "sales" && sales) {
      const src = (title: string, x: SalesSummary["service"]) =>
        `<h2 class="sec">${title}</h2>` +
        tableHTML(["البند", "القيمة"], [
          ["عدد الفواتير", x.invoiceCount],
          ["الإجمالي شامل الضريبة", money(x.totalInc)],
          ["متوسط الفاتورة", money(x.avgTicket)],
          ["مجمل الربح", `${money(x.grossProfit)} (${x.marginPct}%)`],
        ], { numericCols: [1] }) +
        (x.topItems.length ? `<h2 class="sec">الأكثر مبيعاً — ${title}</h2>` +
          tableHTML(["الصنف", "الكمية", "الإجمالي"],
            x.topItems.slice(0, 10).map((it) => [it.label, it.qty, money(it.totalInc)]),
            { numericCols: [1, 2] }) : "");
      const body =
        kpisHTML([
          { label: "إجمالي المبيعات", value: money(sales.totals.totalInc) },
          { label: "عدد الفواتير", value: String(sales.totals.invoiceCount) },
          { label: "مجمل الربح", value: money(sales.totals.grossProfit) },
        ]) +
        src("خدمة (فواتير مرتبطة بسيارة)", sales.service) +
        src("بيع بالقطعة (كاشير مباشر)", sales.retail) +
        (sales.daily.length ? `<h2 class="sec">الاتجاه الزمني</h2>` +
          tableHTML(["اليوم", "المصدر", "عدد الفواتير", "الإجمالي"],
            sales.daily.map((d) => [d.day, d.source === "car" ? "خدمة" : "بيع", d.invoiceCount, money(d.totalInc)]),
            { numericCols: [2, 3] }) : "");
      printReport("ملخّص المبيعات", period, body);
    }
    if (tab === "techs" && techs) {
      const branchLabel = techBranch ? (branchList.find((b) => b.id === techBranch)?.name || "") : "كل الفروع";
      const body =
        kpisHTML([
          { label: "سيارات مسجَّل عليها فريق", value: String(techs.totalCars) },
          { label: "عدد الفنيين", value: String(techs.rows.length) },
          { label: "الفرع", value: branchLabel },
        ]) +
        `<h2 class="sec">إنتاجية الفنيين بالدور</h2>` +
        tableHTML(["الفني", "الدور", "تعبئة", "فك وتركيب", "تشييك", "إجمالي السيارات"],
          techs.rows.map((r) => [
            r.name, r.role ? ROLE_AR[r.role] || r.role : "—",
            r.filling, r.fitting, r.checking, r.totalCars,
          ]), { numericCols: [2, 3, 4, 5] });
      printReport("تقرير إنتاجية الفنيين", period, body);
    }
  }

  const sourceCard = (title: string, s: SalesSummary["service"]) => (
    <div className="rounded-lg border border-line p-4">
      <h3 className="mb-3 text-[13px] font-extrabold">{title}</h3>
      <div className="grid grid-cols-2 gap-3 text-[12.5px]">
        <div><div className="text-text-dim">عدد الفواتير</div><div className="tnum font-bold">{s.invoiceCount}</div></div>
        <div><div className="text-text-dim">متوسط الفاتورة</div><div className="tnum font-bold">{money(s.avgTicket)}</div></div>
        <div><div className="text-text-dim">الإجمالي شامل الضريبة</div><div className="tnum font-bold">{money(s.totalInc)}</div></div>
        <div><div className="text-text-dim">مجمل الربح</div>
          <div className={`tnum font-bold ${s.grossProfit >= 0 ? "text-emerald" : "text-ember"}`}>
            {money(s.grossProfit)} <span className="text-[11px] text-text-dim">({s.marginPct}%)</span>
          </div>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {Object.entries(s.byMethod).filter(([, v]) => v > 0).map(([m, v]) => (
          <span key={m} className="rounded-full bg-ink-3 px-2.5 py-1 text-[11px] font-bold">
            {m === "cash" ? "نقدي" : m === "card" ? "شبكة" : m === "transfer" ? "تحويل" : "آجل"}: <span className="tnum">{money(v)}</span>
          </span>
        ))}
      </div>
      {s.topItems.length > 0 && (
        <div className="mt-3">
          <p className="mb-1 text-[11px] font-bold text-text-dim">الأكثر مبيعاً</p>
          <div className="space-y-0.5 text-[11.5px]">
            {s.topItems.slice(0, 5).map((it) => (
              <div key={it.label} className="flex justify-between">
                <span className="truncate">{it.label}</span>
                <span className="tnum shrink-0">{it.qty} × — {money(it.totalInc)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );

  return (
    <div className="space-y-4">
      <h1 className="text-[19px] font-extrabold">التقارير</h1>

      {/* ══════════ 🏆 مقارنة الفروع ══════════ */}
      <Card>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-[14px] font-black">🏆 مقارنة أداء الفروع</h2>
          <div className="flex flex-wrap items-center gap-1.5">
            {[7, 30, 90].map((d) => (
              <button key={d} onClick={() => { setCmpMonth(null); setCmpDays(d); }}
                      className={`m3 rounded-full px-3 py-1.5 text-[11.5px] font-bold transition
                        ${!cmpMonth && cmpDays === d ? "bg-petrol text-white" : "border border-line bg-ink-2 text-text-dim hover:border-petrol"}`}>
                {d === 7 ? "أسبوع" : d === 30 ? "30 يوم" : "90 يوم"}
              </button>
            ))}
            <button onClick={() => setCmpMonth(thisMonth)}
                    className={`m3 rounded-full px-3 py-1.5 text-[11.5px] font-bold transition
                      ${cmpMonth ? "bg-petrol text-white" : "border border-line bg-ink-2 text-text-dim hover:border-petrol"}`}>
              📅 الشهر التقويمي
            </button>
            {cmpMonth && (
              <span className="flex items-center gap-1 rounded-full border border-line bg-ink-2 px-1.5 py-1">
                <button onClick={() => shiftMonth(-1)}
                        className="m3 grid h-6 w-6 place-items-center rounded-full text-[13px] font-black text-text-dim hover:text-petrol">‹</button>
                <span className="tnum min-w-[92px] text-center text-[11.5px] font-black">
                  {monthLabel}{cmpMonth === thisMonth && <span className="text-emerald"> · حتى الآن</span>}
                </span>
                <button onClick={() => shiftMonth(+1)} disabled={cmpMonth === thisMonth}
                        className="m3 grid h-6 w-6 place-items-center rounded-full text-[13px] font-black text-text-dim hover:text-petrol disabled:opacity-30">›</button>
              </span>
            )}
          </div>
        </div>
        {cmpErr ? (
          <p className="py-4 text-center text-[12px] font-bold text-ember">⚠ {cmpErr}</p>
        ) : !cmp ? <p className="py-4 text-center text-[12px] text-text-dim">جارٍ التحميل…</p> : (
          <div className="space-y-2.5">
            {cmp.branches.map((b, i) => {
              const max = cmp.branches[0]?.revenue || 1;
              return (
                <div key={b.id}>
                  <div className="flex items-center justify-between text-[12.5px] font-bold">
                    <span className="flex items-center gap-1.5">
                      <span className="tnum grid h-5 w-5 place-items-center rounded-md bg-ink-3 text-[10px] font-black text-text-dim">{i + 1}</span>
                      {b.name}
                    </span>
                    <span className="tnum text-text-dim">
                      {money(b.revenue)} ر.س · <span className="font-black text-emerald">ربح {money(b.grossProfit ?? 0)}</span> · {b.invoices} فاتورة · متوسط {money(b.avgInvoice)} · {b.carsServed} سيارة
                    </span>
                  </div>
                  <div className="mt-1 h-2 overflow-hidden rounded-full bg-ink-3">
                    <div className="h-full rounded-full bg-petrol transition-all duration-500"
                         style={{ width: `${max ? (b.revenue / max) * 100 : 0}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>
      <ErrorNote msg={pageErr} />

      <Card className="!p-0">
        <div className="px-5 pt-4">
          <Tabs value={tab} onChange={(t) => setTab(t as Tab)} items={[
            ...(canVat ? [{ key: "vat" as Tab, label: "الإقرار الضريبي" }] : []),
            ...(canSales ? [{ key: "sales" as Tab, label: "ملخّص المبيعات" }] : []),
            ...(canSales ? [{ key: "techs" as Tab, label: "إنتاجية الفنيين" }] : []),
          ]} />
        </div>

        <div className="space-y-4 p-5">
          <div className="flex flex-wrap items-end gap-2">
            <Field label="من"><Input type="date" className="tnum" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
            <Field label="إلى"><Input type="date" className="tnum" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
            {tab === "sales" && (
              <Field label="التجميع">
                <Select value={groupBy} onChange={(e) => setGroupBy(e.target.value as any)}>
                  <option value="day">يومي</option>
                  <option value="month">شهري</option>
                </Select>
              </Field>
            )}
            {tab === "techs" && branchList.length > 1 && (
              <Field label="الفرع">
                <Select value={techBranch} onChange={(e) => setTechBranch(e.target.value)}>
                  <option value="">كل الفروع</option>
                  {branchList.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                </Select>
              </Field>
            )}
            <button onClick={refresh}
                    className="rounded-lg bg-petrol px-4 py-2 text-[13px] font-bold text-white hover:bg-petrol-deep">
              تحديث
            </button>
            <button onClick={printCurrent}
                    disabled={tab === "vat" ? !vat : tab === "sales" ? !sales : !techs}
                    className="rounded-lg border border-line bg-ink-2 px-4 py-2 text-[13px] font-bold text-text hover:border-petrol hover:text-petrol disabled:opacity-50">
              🖨 طباعة التقرير
            </button>
          </div>

          {tab === "vat" && vat && (
            <div className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-lg border border-line p-4">
                  <h3 className="mb-2 text-[13px] font-extrabold">ضريبة المخرجات (المبيعات)</h3>
                  <div className="space-y-1 text-[12.5px]">
                    <div className="flex justify-between"><span className="text-text-dim">المبيعات قبل الضريبة</span><span className="tnum font-bold">{money(vat.salesEx)}</span></div>
                    <div className="flex justify-between"><span className="text-text-dim">إجمالي الضريبة قبل المرتجعات</span><span className="tnum">{money(vat.grossVat)}</span></div>
                    <div className="flex justify-between"><span className="text-text-dim">مرتجعات ({vat.returnsCount})</span><span className="tnum text-ember">-{money(vat.returnsVat)}</span></div>
                    <div className="flex justify-between border-t border-line pt-1 font-bold"><span>صافي ضريبة المخرجات</span><span className="tnum">{money(vat.outputVat)}</span></div>
                  </div>
                </div>
                <div className="rounded-lg border border-line p-4">
                  <h3 className="mb-2 text-[13px] font-extrabold">ضريبة المدخلات (المشتريات)</h3>
                  <div className="space-y-1 text-[12.5px]">
                    <div className="flex justify-between"><span className="text-text-dim">المشتريات قبل الضريبة</span><span className="tnum font-bold">{money(vat.purchasesEx)}</span></div>
                    <div className="flex justify-between border-t border-line pt-1 font-bold"><span>إجمالي ضريبة المدخلات</span><span className="tnum">{money(vat.inputVat)}</span></div>
                  </div>
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-lg bg-ink-3 p-3 text-[12.5px]">
                  <p className="mb-1.5 font-bold text-text-dim">تفصيل حسب المصدر</p>
                  {Object.entries(vat.bySource).map(([src, v]) => {
                    const stat = v as { invoiceCount: number; salesEx: number; outputVat: number };
                    return (
                      <div key={src} className="flex justify-between">
                        <span>{src === "car" ? "خدمة (سيارات)" : "بيع بالقطعة"}</span>
                        <span className="tnum">{stat.invoiceCount} فاتورة — {money(stat.outputVat)}</span>
                      </div>
                    );
                  })}
                </div>
                <div className={`flex items-center justify-between rounded-lg p-4 ${vat.netVat >= 0 ? "bg-ember-bg" : "bg-emerald-bg"}`}>
                  <span className="font-bold text-text-dim">{vat.netVat >= 0 ? "مستحق للهيئة" : "مسترد"}</span>
                  <span className={`tnum text-[20px] font-black ${vat.netVat >= 0 ? "text-ember" : "text-emerald"}`}>
                    {money(Math.abs(vat.netVat))} ر.س
                  </span>
                </div>
              </div>
            </div>
          )}

          {tab === "sales" && sales && (
            <div className="space-y-4">
              <div className="flex items-center justify-between rounded-lg bg-petrol-soft p-4">
                <div>
                  <div className="text-[12px] font-bold text-text-dim">إجمالي المبيعات ({sales.totals.invoiceCount} فاتورة)</div>
                  <div className="tnum text-[22px] font-black text-petrol">{money(sales.totals.totalInc)} ر.س</div>
                </div>
                <div className="text-left">
                  <div className="text-[12px] font-bold text-text-dim">مجمل الربح</div>
                  <div className="tnum text-[16px] font-bold">{money(sales.totals.grossProfit)}</div>
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                {sourceCard("خدمة (فواتير مرتبطة بسيارة)", sales.service)}
                {sourceCard("بيع بالقطعة (كاشير مباشر)", sales.retail)}
              </div>
              {sales.daily.length > 0 && (
                <div className="rounded-lg border border-line p-4">
                  <h3 className="mb-2 text-[13px] font-extrabold">الاتجاه الزمني</h3>
                  <div className="max-h-48 space-y-1 overflow-y-auto text-[12px]">
                    {sales.daily.map((d, i) => (
                      <div key={i} className="flex justify-between">
                        <span className="tnum text-text-dim">{d.day} · {d.source === "car" ? "خدمة" : "بيع"}</span>
                        <span className="tnum font-bold">{d.invoiceCount} فاتورة — {money(d.totalInc)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {tab === "techs" && techs && (
            <div className="space-y-4">
              <div className="flex items-center justify-between rounded-lg bg-petrol-soft p-4">
                <div>
                  <div className="text-[12px] font-bold text-text-dim">سيارات مسجَّل عليها فريق عمل خلال الفترة</div>
                  <div className="tnum text-[22px] font-black text-petrol">{techs.totalCars} سيارة</div>
                </div>
                <div className="text-left">
                  <div className="text-[12px] font-bold text-text-dim">عدد الفنيين</div>
                  <div className="tnum text-[16px] font-bold">{techs.rows.length}</div>
                </div>
              </div>

              {techs.rows.length === 0 ? (
                <p className="py-8 text-center text-[12.5px] text-text-dim">
                  لا توجد بيانات فنيين في هذه الفترة — الفنيون يُسجَّلون على السيارة لحظة اعتماد أمر العمل من التابلت
                </p>
              ) : (
                <div className="overflow-hidden rounded-lg border border-line">
                  <table className="w-full text-[12.5px]">
                    <thead className="bg-ink-3 text-[11.5px] font-black text-text-dim">
                      <tr>
                        <th className="px-3 py-2.5 text-right">الفني</th>
                        <th className="px-3 py-2.5 text-right">الدور</th>
                        <th className="px-3 py-2.5 text-center">تعبئة</th>
                        <th className="px-3 py-2.5 text-center">فك وتركيب</th>
                        <th className="px-3 py-2.5 text-center">تشييك</th>
                        <th className="px-3 py-2.5 text-center">إجمالي السيارات</th>
                        <th className="px-3 py-2.5 text-right">النشاط</th>
                      </tr>
                    </thead>
                    <tbody>
                      {techs.rows.map((r, i) => {
                        const max = techs.rows[0]?.totalCars || 1;
                        return (
                          <tr key={r.id} className="border-t border-line">
                            <td className="px-3 py-2.5 font-extrabold">
                              <span className="tnum ml-1.5 inline-grid h-5 w-5 place-items-center rounded-md bg-ink-3 text-[10px] font-black text-text-dim">{i + 1}</span>
                              {r.name}
                            </td>
                            <td className="px-3 py-2.5">
                              <Badge tone={r.role === "checking" ? "good" : "neutral"}>
                                {r.role ? ROLE_AR[r.role] || r.role : "—"}
                              </Badge>
                            </td>
                            <td className="tnum px-3 py-2.5 text-center font-bold">{r.filling || "—"}</td>
                            <td className="tnum px-3 py-2.5 text-center font-bold">{r.fitting || "—"}</td>
                            <td className="tnum px-3 py-2.5 text-center font-bold">{r.checking || "—"}</td>
                            <td className="tnum px-3 py-2.5 text-center font-black text-petrol">{r.totalCars}</td>
                            <td className="px-3 py-2.5">
                              <div className="h-2 w-full min-w-[80px] overflow-hidden rounded-full bg-ink-3">
                                <div className="h-full rounded-full bg-petrol transition-all duration-500"
                                     style={{ width: `${(r.totalCars / max) * 100}%` }} />
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {!canVat && !canSales && (
            <p className="py-8 text-center text-text-dim">لا تملك صلاحية عرض أي من هذه التقارير</p>
          )}
        </div>
      </Card>
    </div>
  );
}
