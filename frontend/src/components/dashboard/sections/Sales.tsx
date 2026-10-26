"use client";
import { useMemo } from "react";
import type { Executive } from "@/lib/dashboard/types";
import { bucketize, fillDays } from "@/lib/dashboard/periods";
import { fmtCompact, fmtCurrency, fmtDay, fmtMoney } from "@/lib/dashboard/format";
import { useDx } from "@/lib/dashboard/i18n";
import { Widget, SectionEmpty } from "../Widget";
import { AreaChart } from "../charts/AreaChart";
import { Donut } from "../charts/Donut";

const failed = (d: Executive | null, k: string) => !!d?.errors?.includes(k);

export function SalesPerformance({ data, loading }: { data: Executive | null; loading: boolean }) {
  const { d } = useDx();
  const s = data?.sales;
  const chart = useMemo(() => {
    if (!s || !data) return null;
    const filled = fillDays(s.daily, data.period, (date) => ({ date, count: 0, total: 0, profit: 0 }));
    const { rows } = bucketize(filled, (a, b) => ({ date: a.date, count: a.count + b.count, total: a.total + b.total, profit: a.profit + b.profit }));
    return { labels: rows.map((r) => fmtDay(r.date)), total: rows.map((r) => r.total), profit: rows.map((r) => r.profit) };
  }, [s, data]);
  const stats: [string, string][] = s ? [
    [d("sales.count"), fmtMoney(s.invoiceCount, 0)], [d("sales.avg"), fmtCurrency(s.avgInvoice)],
    [d("sales.discounts"), fmtCurrency(s.discounts)], [d("sales.refunds"), `${fmtCurrency(s.refunds)}${s.refundCount ? ` (${s.refundCount})` : ""}`],
    [d("sales.vat"), fmtCurrency(s.vat)], [d("sales.credit"), fmtCurrency(s.credit)],
  ] : [];
  return (
    <Widget title={d("sales.title")} icon="point_of_sale" loading={loading} failed={failed(data, "sales")} skeletonHeight={300} href="/sales/history">
      {!s || !chart || s.invoiceCount === 0 ? <SectionEmpty icon="point_of_sale" title={d("empty.noData")} hint={d("empty.change")} /> : (
        <>
          <dl className="mb-3 grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3">
            {stats.map(([k, v]) => (
              <div key={k} className="min-w-0"><dt className="truncate text-t-xs text-text-dim">{k}</dt><dd className="tnum truncate text-t-md font-extrabold">{v}</dd></div>
            ))}
          </dl>
          <AreaChart ariaLabel={d("sales.title")} labels={chart.labels} height={190} formatValue={fmtCurrency} formatTick={fmtCompact}
            series={[
              { key: "t", label: d("kpi.revenue"), color: "var(--chart-revenue)", values: chart.total, area: true },
              { key: "p", label: d("kpi.gross"), color: "var(--chart-profit)", values: chart.profit, dashed: true },
            ]} />
        </>
      )}
    </Widget>
  );
}

const METHOD_COLOR: Record<string, string> = { cash: "var(--emerald)", card: "var(--petrol)", transfer: "var(--brass)", credit: "var(--chart-expense)" };
export function PaymentMethods({ data, loading }: { data: Executive | null; loading: boolean }) {
  const { d } = useDx();
  const m = (data?.sales?.methods ?? []).filter((x) => x.total > 0);
  const total = m.reduce((s, x) => s + x.total, 0);
  const label = (k: string) => (["cash", "card", "transfer", "credit"].includes(k) ? d(`pay.${k}` as any) : k);
  return (
    <Widget title={d("pay.title")} icon="credit_card" loading={loading} failed={failed(data, "sales")} skeletonHeight={190}>
      {!m.length ? <SectionEmpty icon="credit_card" title={d("empty.noData")} /> : (
        <div className="flex flex-wrap items-center gap-5">
          <Donut ariaLabel={d("pay.title")} centerValue={fmtCompact(total)} segments={m.map((x) => ({ key: x.method, label: label(x.method), value: x.total, color: METHOD_COLOR[x.method] ?? "var(--chart-neutral)" }))} />
          <ul className="min-w-[160px] flex-1 space-y-2">
            {m.map((x) => (
              <li key={x.method} className="flex items-center justify-between gap-2 text-t-sm">
                <span className="flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-sm" style={{ background: METHOD_COLOR[x.method] ?? "var(--chart-neutral)" }} /><span className="font-bold">{label(x.method)}</span></span>
                <span className="tnum text-text-dim">{fmtCurrency(x.total)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Widget>
  );
}
