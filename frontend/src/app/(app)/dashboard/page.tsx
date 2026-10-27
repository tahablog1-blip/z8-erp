"use client";
// لوحة القيادة التنفيذية — طلب واحد /reports/executive يغذّي كل الأقسام، والأقسام تظهر حسب صلاحيات المستخدم
// (data.access). التصميم: فلتر شامل → مؤشرات → رسوم وتحليلات → جداول → تنبيهات/إجراءات. RTL أولاً والإنجليزية جاهزة.
import { Button } from "@/components/ui";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { MIcon } from "@/components/m-icon";
import { useDx } from "@/lib/dashboard/i18n";
import { useExecutive } from "@/lib/dashboard/useExecutive";
import { PERIODS, rangeFor, type PeriodKey } from "@/lib/dashboard/periods";
import { formatDateLong } from "@/lib/format";
import { GlobalFilters, type FilterState } from "@/components/dashboard/GlobalFilters";
import { Kpis } from "@/components/dashboard/sections/Kpis";
import { FinancialOverview, PnlSnapshot, ExpenseAnalytics } from "@/components/dashboard/sections/Financial";
import { SalesPerformance, PaymentMethods } from "@/components/dashboard/sections/Sales";
import { BranchPerformance } from "@/components/dashboard/sections/Branches";
import { CashFlow, Receivables, Payables } from "@/components/dashboard/sections/CashAging";
import { InventoryCenter } from "@/components/dashboard/sections/Inventory";
import { TopProducts, TopCustomers } from "@/components/dashboard/sections/Tops";
import { RecentTransactions } from "@/components/dashboard/sections/Recent";
import { SmartAlerts } from "@/components/dashboard/sections/Alerts";
import { QuickActions } from "@/components/dashboard/sections/QuickActions";
import { OpsStrip } from "@/components/dashboard/sections/Ops";

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** الحالة الابتدائية من الرابط (?p=&from=&to=&branch=) — تدعم المشاركة والرجوع من صفحات التفاصيل */
function initialFilter(): FilterState {
  const base: FilterState = { period: "month", ...rangeFor("month"), branchId: null };
  if (typeof window === "undefined") return base;
  const sp = new URLSearchParams(window.location.search);
  const p = sp.get("p") as PeriodKey | null;
  const branchId = sp.get("branch") || null;
  if (p === "custom" && ISO.test(sp.get("from") ?? "") && ISO.test(sp.get("to") ?? "")) return { period: "custom", from: sp.get("from")!, to: sp.get("to")!, branchId };
  if (p && PERIODS.some((x) => x.key === p)) return { period: p as Exclude<PeriodKey, "custom">, ...rangeFor(p as Exclude<PeriodKey, "custom">), branchId };
  return { ...base, branchId };
}

export default function DashboardPage() {
  const { user, hasPerm } = useAuth();
  const { d } = useDx();
  const [filter, setFilter] = useState<FilterState>(initialFilter);
  const { data, loading, refreshing, error, reload } = useExecutive(filter.from, filter.to, filter.branchId);
  const [branches, setBranches] = useState<{ id: string; name: string }[] | null>(null);
  const [updated, setUpdated] = useState<Date | null>(null);

  useEffect(() => { if (data) setUpdated(new Date()); }, [data]);
  useEffect(() => {                       // قائمة الفروع للفلتر (للأدوار اللي ترى مقارنة الفروع فقط)
    if (data?.access.branches && !branches) api<{ id: string; name: string }[]>("/branches").then(setBranches).catch(() => setBranches([]));
  }, [data?.access.branches, branches]);

  const change = useCallback((v: FilterState) => {
    const next = v.period === "custom" ? v : { ...v, ...rangeFor(v.period) };
    setFilter(next);
    const qs = new URLSearchParams();
    qs.set("p", next.period);
    if (next.period === "custom") { qs.set("from", next.from); qs.set("to", next.to); }
    if (next.branchId) qs.set("branch", next.branchId);
    window.history.replaceState(null, "", `?${qs}`);
  }, []);

  const access = data?.access;
  const nothing = !!access && !access.sales && !access.finance && !access.inventory && !access.ops;
  const branchName = useMemo(() => branches?.find((b) => b.id === filter.branchId)?.name, [branches, filter.branchId]);
  const L = loading;

  if (error && !data) {
    return (
      <div className="mx-auto max-w-md py-16 text-center" role="alert">
        <MIcon name="cloud_off" className="!text-[44px] text-ember" />
        <h1 className="mt-2 page-title">{d("loadFail")}</h1>
        <p className="page-desc">{error}</p>
        <Button className="mt-4" onClick={reload}>{d("retry")}</Button>
      </div>
    );
  }
  if (nothing) {
    return (
      <div className="mx-auto max-w-md py-16 text-center">
        <MIcon name="lock" className="!text-[44px] text-text-dim" />
        <h1 className="mt-2 page-title">{d("noPerm")}</h1>
        <p className="page-desc">{d("noPermHint")}</p>
      </div>
    );
  }

  const a = access;
  // ترتيب الجوال: مؤشرات ← تنبيهات ← مبيعات ← نقدية ← ذمم ← تحليلات ← جداول؛ على الشاشات الكبيرة الترتيب الطبيعي
  return (
    <div className="mx-auto w-full max-w-[1600px] space-y-4 pb-8">
      <header className="flex flex-wrap items-end justify-between gap-2">
        <div className="min-w-0">
          <h1 className="page-title">{d("title")}</h1>
          <p className="page-desc">
            {user?.fullName ? `${user.fullName} · ` : ""}{branchName ? `${branchName} · ` : ""}{formatDateLong(new Date().toISOString())}
          </p>
        </div>
      </header>

      <GlobalFilters value={filter} branches={branches} onChange={change} onRefresh={reload} refreshing={refreshing} lastUpdated={updated} />

      {error && data && (
        <div role="alert" className="flex items-center justify-between gap-2 rounded-card border border-ember/30 bg-ember-bg px-3 py-2 text-t-sm text-ember">
          <span>{d("loadFail")}</span><button onClick={reload} className="font-bold underline">{d("retry")}</button>
        </div>
      )}

      <OpsStrip data={data} />

      <section aria-label={d("title")} className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpis data={data} loading={L} />
      </section>

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-12">
        {(L || a?.sales || a?.finance || a?.inventory) && <div className="order-1 flex flex-col gap-3 xl:order-none xl:col-span-4"><SmartAlerts data={data} loading={L} /><div className="flex-1"><QuickActions /></div></div>}
        {(L || a?.finance) && <div className="order-3 xl:order-none xl:col-span-8"><FinancialOverview data={data} loading={L} /></div>}
        {(L || a?.sales) && <div className="order-2 xl:order-none xl:col-span-8"><SalesPerformance data={data} loading={L} /></div>}
        {(L || a?.finance) && <div className="order-4 xl:order-none xl:col-span-4"><PnlSnapshot data={data} loading={L} /></div>}
        {(L || a?.finance) && <div className="order-5 xl:order-none xl:col-span-6"><CashFlow data={data} loading={L} /></div>}
        {(L || a?.finance) && <div className="order-6 xl:order-none xl:col-span-3"><Receivables data={data} loading={L} /></div>}
        {(L || a?.finance) && <div className="order-7 xl:order-none xl:col-span-3"><Payables data={data} loading={L} /></div>}
        {(L || a?.branches) && <div className="order-8 xl:order-none xl:col-span-12"><BranchPerformance data={data} loading={L} activeId={filter.branchId} onPick={(id) => change({ ...filter, branchId: id })} /></div>}
        {(L || a?.inventory) && <div className="order-9 xl:order-none xl:col-span-7"><InventoryCenter data={data} loading={L} /></div>}
        {(L || a?.sales) && <div className="order-10 xl:order-none xl:col-span-5"><PaymentMethods data={data} loading={L} /></div>}
        {(L || a?.sales) && <div className="order-11 xl:order-none xl:col-span-6"><TopProducts data={data} loading={L} /></div>}
        {(L || a?.sales) && <div className="order-12 xl:order-none xl:col-span-6"><TopCustomers data={data} loading={L} /></div>}
        {(L || a?.finance) && <div className="order-[13] xl:order-none xl:col-span-5"><ExpenseAnalytics data={data} loading={L} /></div>}
        {(L || a?.sales) && <div className="order-[14] xl:order-none xl:col-span-7"><RecentTransactions data={data} loading={L} /></div>}
      </div>

    </div>
  );
}
