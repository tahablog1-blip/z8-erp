"use client";
import type { Executive } from "@/lib/dashboard/types";
import { fmtCurrency, fmtPct } from "@/lib/dashboard/format";
import { useDx } from "@/lib/dashboard/i18n";
import { Widget, SectionEmpty } from "../Widget";
import { DeltaBadge } from "../KpiCard";

/** جدول مقارنة الفروع — الضغط على فرع يطبّق فلتر الفرع على اللوحة كلها */
export function BranchPerformance({ data, loading, activeId, onPick }: { data: Executive | null; loading: boolean; activeId: string | null; onPick: (id: string | null) => void }) {
  const { d } = useDx();
  const rows = data?.branches ?? [];
  const showProfit = rows.some((r) => r.netProfit != null);
  const best = rows.length ? Math.max(...rows.map((r) => r.sales)) : 0;
  return (
    <Widget title={d("branches.title")} icon="store" loading={loading} failed={!!data?.errors?.includes("branches")} skeletonHeight={200} href="/branches" hrefLabel={d("details")}>
      {!rows.length ? <SectionEmpty icon="store" title={d("empty.noData")} /> : (
        <div className="-mx-4 overflow-x-auto px-4 sm:-mx-5 sm:px-5">
          <table className="w-full min-w-[560px] text-t-sm">
            <thead>
              <tr className="border-b border-line text-t-xs text-text-dim">
                <th className="py-2 pe-2 text-start font-bold">{d("branches.branch")}</th>
                <th className="px-2 py-2 text-end font-bold">{d("branches.sales")}</th>
                <th className="px-2 py-2 text-end font-bold">{d("branches.tx")}</th>
                <th className="px-2 py-2 text-end font-bold">{d("branches.profit")}</th>
                {showProfit && <th className="px-2 py-2 text-end font-bold">{d("branches.expenses")}</th>}
                <th className="px-2 py-2 text-end font-bold">{d("branches.margin")}</th>
                <th className="ps-2 py-2 text-end font-bold">{d("branches.growth")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className={`border-b border-line/60 last:border-0 ${activeId === r.id ? "bg-petrol-soft" : ""}`}>
                  <td className="py-2 pe-2">
                    <button onClick={() => onPick(activeId === r.id ? null : r.id)} title={d("branches.open")} className="text-start font-bold text-petrol hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-petrol">{r.name}</button>
                    <div className="mt-1 h-1 w-full max-w-[120px] overflow-hidden rounded-full bg-ink-3"><div className="h-full rounded-full bg-petrol" style={{ width: `${best ? (r.sales / best) * 100 : 0}%` }} /></div>
                  </td>
                  <td className="tnum px-2 py-2 text-end font-extrabold">{fmtCurrency(r.sales)}</td>
                  <td className="tnum px-2 py-2 text-end">{r.transactions}</td>
                  <td className="tnum px-2 py-2 text-end">{fmtCurrency(r.grossProfit)}</td>
                  {showProfit && <td className="tnum px-2 py-2 text-end">{r.expenses == null ? "—" : fmtCurrency(r.expenses)}</td>}
                  <td className="tnum px-2 py-2 text-end">{fmtPct(r.margin)}</td>
                  <td className="ps-2 py-2 text-end"><DeltaBadge pct={r.growth} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Widget>
  );
}
