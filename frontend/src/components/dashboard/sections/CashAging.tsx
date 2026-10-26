"use client";
import { useMemo } from "react";
import type { Executive } from "@/lib/dashboard/types";
import { bucketize, fillDays } from "@/lib/dashboard/periods";
import { fmtCompact, fmtCurrency, fmtDay } from "@/lib/dashboard/format";
import { useDx } from "@/lib/dashboard/i18n";
import { Widget, SectionEmpty } from "../Widget";
import { AreaChart } from "../charts/AreaChart";
import { StackedBar } from "../charts/StackedBar";
import { HBars } from "../charts/HBars";

const failed = (d: Executive | null, k: string) => !!d?.errors?.includes(k);

export function CashFlow({ data, loading }: { data: Executive | null; loading: boolean }) {
  const { d } = useDx();
  const c = data?.cash;
  const chart = useMemo(() => {
    if (!c || !data) return null;
    const filled = fillDays(c.daily, data.period, (date) => ({ date, in: 0, out: 0 }));
    const { rows } = bucketize(filled, (a, b) => ({ date: a.date, in: a.in + b.in, out: a.out + b.out }));
    return { labels: rows.map((r) => fmtDay(r.date)), inn: rows.map((r) => r.in), out: rows.map((r) => r.out), empty: rows.every((r) => !r.in && !r.out) };
  }, [c, data]);
  return (
    <Widget title={d("cash.title")} icon="swap_vert" loading={loading} failed={failed(data, "cash")} skeletonHeight={260} href="/treasury">
      {!c || !chart ? <SectionEmpty icon="swap_vert" title={d("empty.noData")} /> : (
        <>
          <dl className="mb-3 grid grid-cols-3 gap-3">
            {[[d("cash.in"), c.cashIn, "text-emerald"], [d("cash.out"), c.cashOut, "text-ember"], [d("cash.net"), c.net, c.net < 0 ? "text-ember" : ""]].map(([k, v, cls]) => (
              <div key={k as string} className="min-w-0"><dt className="truncate text-t-xs text-text-dim">{k}</dt><dd className={`tnum truncate text-t-md font-extrabold ${cls}`}>{fmtCurrency(v as number)}</dd></div>
            ))}
          </dl>
          {chart.empty ? <SectionEmpty icon="swap_vert" title={d("empty.noData")} hint={d("empty.change")} /> : (
            <AreaChart ariaLabel={d("cash.title")} labels={chart.labels} height={170} formatValue={fmtCurrency} formatTick={fmtCompact}
              series={[
                { key: "in", label: d("cash.in"), color: "var(--chart-profit)", values: chart.inn, area: true },
                { key: "out", label: d("cash.out"), color: "var(--chart-expense)", values: chart.out },
              ]} />
          )}
          {c.accounts.length > 0 && (
            <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 border-t border-line pt-2.5 text-t-xs text-text-dim">
              {c.accounts.map((a) => <li key={a.code}><span className="font-bold">{a.name}</span> <span className={`tnum ${a.balance < 0 ? "text-ember" : ""}`}>{fmtCurrency(a.balance)}</span></li>)}
            </ul>
          )}
        </>
      )}
    </Widget>
  );
}

const AGE_COLORS = ["var(--emerald)", "var(--brass)", "var(--chart-expense)", "var(--ember)", "var(--chart-negative)"];

export function Receivables({ data, loading }: { data: Executive | null; loading: boolean }) {
  const { d } = useDx();
  const a = data?.receivables;
  return (
    <Widget title={d("ar.title")} icon="request_quote" loading={loading} failed={failed(data, "receivables")} skeletonHeight={200} href="/customers">
      {!a || a.total <= 0 ? <SectionEmpty icon="task_alt" title={d("empty.noDebt")} /> : (
        <div className="space-y-4">
          <div className="tnum text-t-2xl font-black">{fmtCurrency(a.total)}</div>
          <StackedBar ariaLabel={d("ar.title")} format={fmtCurrency} segments={[
            { key: "c", label: d("aging.current"), value: a.current, color: AGE_COLORS[0] },
            { key: "a", label: d("aging.d31_60"), value: a.d31_60, color: AGE_COLORS[2] },
            { key: "b", label: d("aging.d61_90"), value: a.d61_90, color: AGE_COLORS[3] },
            { key: "d", label: d("aging.d90plus"), value: a.d90plus, color: AGE_COLORS[4] },
          ]} />
          {a.top.length > 0 && (
            <div><h3 className="mb-2 text-t-xs font-extrabold text-text-dim">{d("topDebtors")}</h3>
              <HBars color="var(--brass)" rows={a.top.slice(0, 5).map((t) => ({ key: t.customerId, label: t.name, value: t.total, display: fmtCurrency(t.total), href: `/customers/${t.customerId}` }))} />
            </div>
          )}
        </div>
      )}
    </Widget>
  );
}

export function Payables({ data, loading }: { data: Executive | null; loading: boolean }) {
  const { d } = useDx();
  const a = data?.payables;
  return (
    <Widget title={d("ap.title")} icon="local_shipping" loading={loading} failed={failed(data, "payables")} skeletonHeight={200} href="/suppliers">
      {!a || a.total <= 0 ? <SectionEmpty icon="task_alt" title={d("empty.noDebt")} /> : (
        <div className="space-y-4">
          <div className="tnum text-t-2xl font-black">{fmtCurrency(a.total)}</div>
          <StackedBar ariaLabel={d("ap.title")} format={fmtCurrency} segments={[
            { key: "c", label: d("aging.current"), value: a.current, color: AGE_COLORS[0] },
            { key: "a", label: d("aging.d1_30"), value: a.d1_30, color: AGE_COLORS[1] },
            { key: "b", label: d("aging.d31_60"), value: a.d31_60, color: AGE_COLORS[2] },
            { key: "c2", label: d("aging.d61_90"), value: a.d61_90, color: AGE_COLORS[3] },
            { key: "d", label: d("aging.d90plus"), value: a.d90plus, color: AGE_COLORS[4] },
          ]} />
          {a.top.length > 0 && (
            <div><h3 className="mb-2 text-t-xs font-extrabold text-text-dim">{d("topSuppliers")}</h3>
              <HBars color="var(--chart-neutral)" rows={a.top.slice(0, 5).map((t) => ({ key: t.supplierId, label: t.name, value: t.total, display: fmtCurrency(t.total), href: "/suppliers" }))} />
            </div>
          )}
        </div>
      )}
    </Widget>
  );
}
