"use client";
import Link from "next/link";
import type { Executive } from "@/lib/dashboard/types";
import { fmtCurrency, fmtMoney } from "@/lib/dashboard/format";
import { useDx } from "@/lib/dashboard/i18n";
import { Widget, SectionEmpty } from "../Widget";
import { HBars } from "../charts/HBars";
import { StackedBar } from "../charts/StackedBar";

export function InventoryCenter({ data, loading }: { data: Executive | null; loading: boolean }) {
  const { d } = useDx();
  const v = data?.inventory;
  const a = v?.aging ?? {};
  return (
    <Widget title={d("inv.title")} icon="inventory_2" loading={loading} failed={!!data?.errors?.includes("inventory")} skeletonHeight={300} href="/inventory">
      {!v || (!v.items && !v.totalValue) ? <SectionEmpty icon="inventory_2" title={d("empty.noData")} /> : (
        <div className="space-y-4">
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {([
              [d("kpi.inventory"), fmtCurrency(v.totalValue), ""],
              [d("lowStock"), fmtMoney(v.lowStock, 0), v.lowStock ? "text-brass" : ""],
              [d("outOfStock"), fmtMoney(v.outOfStock, 0), v.outOfStock ? "text-ember" : ""],
              [d("turnover"), v.turnover != null ? `${fmtMoney(v.turnover, 2)}×` : "—", ""],
            ] as const).map(([k, val, cls]) => (
              <div key={k} className="min-w-0"><dt className="truncate text-t-xs text-text-dim">{k}</dt><dd className={`tnum truncate text-t-lg font-black ${cls}`}>{val}</dd></div>
            ))}
          </dl>
          <StackedBar ariaLabel={d("inv.title")} format={fmtCurrency} segments={[
            { key: "f", label: d("inv.fresh"), value: a.fresh ?? 0, color: "var(--emerald)" },
            { key: "30", label: d("aging.ar30"), value: a.d30 ?? 0, color: "var(--brass)" },
            { key: "60", label: d("aging.d31_60"), value: a.d60 ?? 0, color: "var(--chart-expense)" },
            { key: "90", label: d("inv.dead"), value: a.d90 ?? 0, color: "var(--ember)" },
          ]} />
          <div className="grid gap-5 md:grid-cols-2">
            <div>
              <h3 className="mb-2 text-t-xs font-extrabold text-text-dim">{d("inv.byCategory")}</h3>
              {v.byCategory.length ? <HBars rows={v.byCategory.map((c) => ({ key: c.category, label: c.category || "—", value: c.value, display: fmtCurrency(c.value) }))} /> : <p className="text-t-sm text-text-dim">—</p>}
            </div>
            <div>
              <h3 className="mb-2 text-t-xs font-extrabold text-text-dim">{d("inv.lowList")}</h3>
              {!v.lowItems.length ? <p className="flex items-center gap-1.5 text-t-sm text-emerald">{d("empty.noInv")}</p> : (
                <ul className="space-y-1.5">
                  {v.lowItems.map((x, i) => (
                    <li key={i} className="flex items-center justify-between gap-2 text-t-sm">
                      <span className="min-w-0 truncate font-bold">{x.name}<span className="ms-1 text-t-xs font-normal text-text-dim">{x.locName}</span></span>
                      <span className={`tnum shrink-0 rounded-full px-2 py-0.5 text-t-xs font-extrabold ${x.outOfStock ? "bg-ember-bg text-ember" : "bg-brass-bg text-brass"}`}>{fmtMoney(x.qty, 0)} / {fmtMoney(x.minQty, 0)}</span>
                    </li>
                  ))}
                </ul>
              )}
              <Link href="/inventory" className="mt-2 inline-block text-t-xs font-bold text-petrol hover:underline">{d("viewAll")}</Link>
            </div>
          </div>
        </div>
      )}
    </Widget>
  );
}
