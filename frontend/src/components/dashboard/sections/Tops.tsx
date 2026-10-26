"use client";
import Link from "next/link";
import type { Executive } from "@/lib/dashboard/types";
import { fmtCurrency, fmtDate, fmtMoney, fmtPct } from "@/lib/dashboard/format";
import { useDx } from "@/lib/dashboard/i18n";
import { Widget, SectionEmpty } from "../Widget";

const th = "px-2 py-2 text-end font-bold";
export function TopProducts({ data, loading }: { data: Executive | null; loading: boolean }) {
  const { d } = useDx();
  const rows = data?.topProducts ?? [];
  return (
    <Widget title={d("topProducts.title")} icon="local_fire_department" loading={loading} failed={!!data?.errors?.includes("topProducts")} skeletonHeight={260} href="/products" bodyClassName="!px-0">
      {!rows.length ? <SectionEmpty icon="inventory_2" title={d("empty.noData")} hint={d("empty.change")} /> : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[460px] text-t-sm">
            <thead><tr className="border-b border-line text-t-xs text-text-dim">
              <th className="px-4 py-2 text-start font-bold sm:px-5">{d("tp.product")}</th><th className={th}>{d("tp.qty")}</th><th className={th}>{d("tp.revenue")}</th><th className={th}>{d("tp.profit")}</th><th className={`${th} pe-4 sm:pe-5`}>{d("tp.margin")}</th>
            </tr></thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.label + i} className="border-b border-line/60 last:border-0">
                  <td className="px-4 py-2 sm:px-5"><span className="tnum me-2 text-t-xs text-text-dim">{i + 1}</span><span className="font-bold">{r.label}</span></td>
                  <td className="tnum px-2 py-2 text-end">{fmtMoney(r.qty, 0)}</td>
                  <td className="tnum px-2 py-2 text-end font-extrabold">{fmtCurrency(r.revenue)}</td>
                  <td className="tnum px-2 py-2 text-end">{fmtCurrency(r.profit)}</td>
                  <td className={`tnum px-2 py-2 pe-4 text-end sm:pe-5 ${r.margin < 0 ? "text-ember" : ""}`}>{fmtPct(r.margin)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Widget>
  );
}

export function TopCustomers({ data, loading }: { data: Executive | null; loading: boolean }) {
  const { d } = useDx();
  const rows = data?.topCustomers ?? [];
  return (
    <Widget title={d("topCust.title")} icon="groups" loading={loading} failed={!!data?.errors?.includes("topCustomers")} skeletonHeight={260} href="/customers" bodyClassName="!px-0">
      {!rows.length ? <SectionEmpty icon="groups" title={d("empty.noData")} hint={d("empty.change")} /> : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[460px] text-t-sm">
            <thead><tr className="border-b border-line text-t-xs text-text-dim">
              <th className="px-4 py-2 text-start font-bold sm:px-5">{d("tc.customer")}</th><th className={th}>{d("tc.invoices")}</th><th className={th}>{d("tc.purchases")}</th><th className={th}>{d("tc.outstanding")}</th><th className={`${th} pe-4 sm:pe-5`}>{d("tc.last")}</th>
            </tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.customerId} className="border-b border-line/60 last:border-0">
                  <td className="px-4 py-2 sm:px-5"><Link href={`/customers/${r.customerId}`} className="font-bold text-petrol hover:underline">{r.name}</Link></td>
                  <td className="tnum px-2 py-2 text-end">{r.invoices}</td>
                  <td className="tnum px-2 py-2 text-end font-extrabold">{fmtCurrency(r.total)}</td>
                  <td className={`tnum px-2 py-2 text-end ${r.outstanding > 0 ? "text-brass" : "text-text-dim"}`}>{fmtCurrency(r.outstanding)}</td>
                  <td className="tnum px-2 py-2 pe-4 text-end text-t-xs text-text-dim sm:pe-5">{r.lastAt ? fmtDate(r.lastAt) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Widget>
  );
}
