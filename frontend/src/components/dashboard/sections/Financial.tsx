"use client";
import { useMemo } from "react";
import type { Executive } from "@/lib/dashboard/types";
import { bucketize, fillDays } from "@/lib/dashboard/periods";
import { fmtCompact, fmtCurrency, fmtDay, fmtPct } from "@/lib/dashboard/format";
import { useDx } from "@/lib/dashboard/i18n";
import { Widget, SectionEmpty } from "../Widget";
import { AreaChart } from "../charts/AreaChart";
import { Donut } from "../charts/Donut";

const failed = (d: Executive | null, k: string) => !!d?.errors?.includes(k);

/** الإيرادات والمصروفات والربح عبر الزمن — من القيود المحاسبية */
export function FinancialOverview({ data, loading }: { data: Executive | null; loading: boolean }) {
  const { d } = useDx();
  const chart = useMemo(() => {
    if (!data?.pnl) return null;
    const filled = fillDays(data.pnl.daily, data.period, (date) => ({ date, revenue: 0, cogs: 0, opex: 0 }));
    const { rows } = bucketize(filled, (a, b) => ({ date: a.date, revenue: a.revenue + b.revenue, cogs: a.cogs + b.cogs, opex: a.opex + b.opex }));
    return {
      labels: rows.map((r) => fmtDay(r.date)),
      revenue: rows.map((r) => r.revenue), expenses: rows.map((r) => r.cogs + r.opex),
      profit: rows.map((r) => r.revenue - r.cogs - r.opex),
      empty: rows.every((r) => !r.revenue && !r.cogs && !r.opex),
    };
  }, [data]);
  return (
    <Widget title={d("fin.title")} icon="monitoring" loading={loading} failed={failed(data, "pnl")} skeletonHeight={290} href="/accounting" hrefLabel={d("details")}>
      {!chart || chart.empty ? <SectionEmpty icon="show_chart" title={d("empty.noData")} hint={d("fin.noAccounting")} /> : (
        <>
          <div className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-t-xs font-bold text-text-dim">
            {[["fin.revenue", "var(--chart-revenue)"], ["fin.expenses", "var(--chart-expense)"], ["fin.profit", "var(--chart-profit)"]].map(([k, c]) => (
              <span key={k} className="inline-flex items-center gap-1.5"><i className="h-2 w-2 rounded-full" style={{ background: c }} />{d(k as any)}</span>
            ))}
          </div>
          <AreaChart ariaLabel={d("fin.title")} labels={chart.labels} height={250} formatValue={fmtCurrency} formatTick={fmtCompact}
            series={[
              { key: "rev", label: d("fin.revenue"), color: "var(--chart-revenue)", values: chart.revenue, area: true },
              { key: "exp", label: d("fin.expenses"), color: "var(--chart-expense)", values: chart.expenses },
              { key: "profit", label: d("fin.profit"), color: "var(--chart-profit)", values: chart.profit, dashed: true },
            ]} />
        </>
      )}
    </Widget>
  );
}

/** قائمة الأرباح والخسائر المختصرة مع مقارنة الفترة السابقة */
export function PnlSnapshot({ data, loading }: { data: Executive | null; loading: boolean }) {
  const { d } = useDx();
  const p = data?.pnl, pp = data?.pnlPrev;
  const rows: { k: any; v: number; pv?: number; strong?: boolean; neg?: boolean }[] = p ? [
    { k: "pnl.revenue", v: p.revenue, pv: pp?.revenue },
    { k: "pnl.cogs", v: -p.cogs, pv: pp ? -pp.cogs : undefined, neg: true },
    { k: "pnl.gross", v: p.grossProfit, pv: pp?.grossProfit, strong: true },
    { k: "pnl.opex", v: -p.opex, pv: pp ? -pp.opex : undefined, neg: true },
    { k: "pnl.net", v: p.netProfit, pv: pp?.netProfit, strong: true },
  ] : [];
  return (
    <Widget title={d("pnl.title")} icon="balance" loading={loading} failed={failed(data, "pnl")} skeletonHeight={230} href="/accounting" hrefLabel={d("details")}>
      {!p || (!p.revenue && !p.cogs && !p.opex) ? <SectionEmpty icon="balance" title={d("empty.noData")} hint={d("fin.noAccounting")} /> : (
        <table className="w-full text-t-sm">
          <tbody>
            {rows.map((r) => {
              const pct = r.pv ? ((r.v - r.pv) / Math.abs(r.pv)) * 100 : null;
              return (
                <tr key={r.k} className={`border-b border-line/60 last:border-0 ${r.strong ? "font-black" : ""}`}>
                  <td className="py-2 pe-2">{d(r.k)}</td>
                  <td className={`tnum py-2 text-end ${r.v < 0 && !r.neg ? "text-ember" : ""}`} dir="ltr">{fmtCurrency(r.v)}</td>
                  <td className="tnum w-16 py-2 ps-2 text-end text-t-xs font-bold text-text-dim" dir="ltr">{pct == null ? "" : `${pct > 0 ? "+" : ""}${fmtPct(pct, 0)}`}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </Widget>
  );
}

/** تحليل المصروفات: حلقة بنسب أعلى البنود + ترتيب */
const PALETTE = ["var(--petrol)", "var(--brass)", "var(--chart-expense)", "var(--emerald)", "var(--chart-neutral)", "var(--ember)"];
export function ExpenseAnalytics({ data, loading }: { data: Executive | null; loading: boolean }) {
  const { d } = useDx();
  const exp = data?.pnl?.expenses ?? [];
  const total = exp.reduce((s, e) => s + e.amount, 0);
  const top = exp.slice(0, 6);
  return (
    <Widget title={d("exp.title")} icon="pie_chart" loading={loading} failed={failed(data, "pnl")} skeletonHeight={220} href="/accounting" hrefLabel={d("details")}>
      {!top.length ? <SectionEmpty icon="receipt_long" title={d("empty.noData")} hint={d("empty.change")} /> : (
        <div className="flex flex-wrap items-center gap-5">
          <Donut ariaLabel={d("exp.title")} centerLabel={d("exp.total")} centerValue={fmtCompact(total)}
            segments={top.map((e, i) => ({ key: e.code, label: e.name, value: e.amount, color: PALETTE[i % PALETTE.length] }))} />
          <ul className="min-w-[180px] flex-1 space-y-2">
            {top.map((e, i) => (
              <li key={e.code} className="flex items-center justify-between gap-2 text-t-sm">
                <span className="flex min-w-0 items-center gap-1.5"><i className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: PALETTE[i % PALETTE.length] }} /><span className="truncate font-bold">{e.name}</span></span>
                <span className="tnum shrink-0 text-text-dim">{fmtCurrency(e.amount)} · {fmtPct(total ? (e.amount / total) * 100 : 0, 0)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Widget>
  );
}
