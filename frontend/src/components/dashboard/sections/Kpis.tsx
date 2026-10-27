"use client";
import { useMemo } from "react";
import type { Executive } from "@/lib/dashboard/types";
import { fillDays } from "@/lib/dashboard/periods";
import { fmtCurrency, fmtPct, growth } from "@/lib/dashboard/format";
import { useDx } from "@/lib/dashboard/i18n";
import { KpiCard, KpiSkeleton } from "../KpiCard";

/** مركز مؤشرات الأداء — كل بطاقة تظهر فقط لو المستخدم يملك صلاحية بياناتها */
export function Kpis({ data, loading }: { data: Executive | null; loading: boolean }) {
  const { d } = useDx();
  const range = data?.period;
  const spark = useMemo(() => {
    if (!data || !range) return null;
    const days = (rows: { date: string }[], pick: (r: any) => number) =>
      fillDays(rows as any[], range, (date) => ({ date } as any)).map((r) => Number(pick(r) ?? 0));
    return {
      rev: data.sales ? days(data.sales.daily, (r) => r.total) : [],
      gross: data.sales ? days(data.sales.daily, (r) => r.profit) : [],
      exp: data.pnl ? days(data.pnl.daily, (r) => r.opex) : [],
      net: data.pnl ? days(data.pnl.daily, (r) => (r.revenue ?? 0) - (r.cogs ?? 0) - (r.opex ?? 0)) : [],
      cash: data.cash ? days(data.cash.daily, (r) => (r.in ?? 0) - (r.out ?? 0)) : [],
    };
  }, [data, range]);

  if (loading || !data || !spark) {
    return <>{Array.from({ length: 8 }).map((_, i) => <KpiSkeleton key={i} />)}</>;
  }
  const { sales, salesPrev, pnl, pnlPrev, cash, receivables: ar, payables: ap, inventory: inv } = data;
  const from = data.period.from, to = data.period.to;
  const cards: React.ReactNode[] = [];

  if (sales) cards.push(
    <KpiCard key="rev" icon="payments" label={d("kpi.revenue")} tip={d("kpi.revenue.tip")} accent="var(--chart-revenue)"
      value={fmtCurrency(sales.totalInc)} pct={salesPrev ? growth(sales.totalInc, salesPrev.totalInc) : null} spark={spark.rev}
      sub={`${sales.invoiceCount} ${d("invoices")}`} href={`/sales/history?from=${from}&to=${to}`} />);
  if (pnl) {
    const gm = pnl.revenue ? (pnl.grossProfit / pnl.revenue) * 100 : null;
    cards.push(
      <KpiCard key="gross" icon="trending_up" label={d("kpi.gross")} tip={d("kpi.gross.tip")} accent="var(--chart-profit)"
        value={fmtCurrency(pnl.grossProfit)} pct={pnlPrev ? growth(pnl.grossProfit, pnlPrev.grossProfit) : null} spark={spark.gross}
        sub={gm != null ? `${d("margin")} ${fmtPct(gm)}` : undefined} href="/reports/analysis?tab=profit" />,
      <KpiCard key="exp" icon="receipt_long" label={d("kpi.expenses")} tip={d("kpi.expenses.tip")} accent="var(--chart-expense)" goodWhenUp={false}
        value={fmtCurrency(pnl.opex)} pct={pnlPrev ? growth(pnl.opex, pnlPrev.opex) : null} spark={spark.exp} href="/accounting" />,
      <KpiCard key="net" icon="account_balance" label={d("kpi.net")} tip={d("kpi.net.tip")} accent={pnl.netProfit < 0 ? "var(--chart-negative)" : "var(--chart-profit)"}
        value={fmtCurrency(pnl.netProfit)} pct={pnlPrev ? growth(pnl.netProfit, pnlPrev.netProfit) : null} spark={spark.net}
        sub={pnl.revenue ? `${d("margin")} ${fmtPct((pnl.netProfit / pnl.revenue) * 100)}` : undefined} href="/accounting" />);
  }
  if (cash) cards.push(
    <KpiCard key="cash" icon="account_balance_wallet" label={d("kpi.cash")} tip={d("kpi.cash.tip")} accent="var(--petrol)"
      value={fmtCurrency(cash.balance)} spark={spark.cash} subTone={cash.balance < 0 ? "danger" : "neutral"}
      sub={`${d("cash.net")}: ${fmtCurrency(cash.net)}`} href="/treasury" />);
  if (ar) cards.push(
    <KpiCard key="ar" icon="request_quote" label={d("kpi.receivables")} tip={d("kpi.receivables.tip")} accent="var(--brass)"
      value={fmtCurrency(ar.total)} subTone={ar.overdue > 0 ? "warning" : "neutral"}
      sub={ar.overdue > 0 ? `${d("overdue")}: ${fmtCurrency(ar.overdue)}` : `${ar.customers}`} href="/customers" />);
  if (ap) cards.push(
    <KpiCard key="ap" icon="local_shipping" label={d("kpi.payables")} accent="var(--chart-neutral)"
      value={fmtCurrency(ap.total)} subTone={ap.overdue > 0 ? "danger" : "neutral"}
      sub={ap.overdue > 0 ? `${d("overdue")}: ${fmtCurrency(ap.overdue)}` : `${ap.invoices} ${d("invoices")}`} href="/suppliers" />);
  if (inv) cards.push(
    <KpiCard key="inv" icon="inventory_2" label={d("kpi.inventory")} tip={d("kpi.inventory.tip")} accent="var(--petrol)"
      value={fmtCurrency(inv.totalValue)} subTone={inv.outOfStock ? "danger" : inv.lowStock ? "warning" : "neutral"}
      sub={inv.lowStock ? `${d("lowStock")}: ${inv.lowStock}` : `${inv.items} ${d("inv.items")}`} href="/inventory" />);

  return <>{cards}</>;
}
