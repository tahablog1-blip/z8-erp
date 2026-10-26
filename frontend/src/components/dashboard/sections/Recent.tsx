"use client";
import Link from "next/link";
import type { Executive } from "@/lib/dashboard/types";
import { fmtCurrency } from "@/lib/dashboard/format";
import { useDx } from "@/lib/dashboard/i18n";
import { Widget, SectionEmpty } from "../Widget";
import { MIcon } from "@/components/m-icon";

const STATUS_TONE: Record<string, string> = { paid: "bg-emerald-bg text-emerald", partial: "bg-brass-bg text-brass", credit: "bg-brass-bg text-brass", refunded: "bg-ember-bg text-ember" };

function when(iso: string, isEn: boolean) {
  try { return `\u2066${new Date(iso).toLocaleString(isEn ? "en-US" : "ar-SA-u-nu-latn", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}\u2069`; } catch { return iso; }
}

export function RecentTransactions({ data, loading }: { data: Executive | null; loading: boolean }) {
  const { d, isEn } = useDx();
  const rows = data?.recent ?? [];
  return (
    <Widget title={d("recent.title")} icon="receipt" loading={loading} failed={!!data?.errors?.includes("recent")} skeletonHeight={260} href="/sales/history" bodyClassName="!px-0">
      {!rows.length ? <SectionEmpty icon="receipt" title={d("empty.noTx")} /> : (
        <>
          {/* جدول للشاشات المتوسطة فأكبر */}
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full text-t-sm">
              <thead><tr className="border-b border-line text-t-xs text-text-dim">
                <th className="px-5 py-2 text-start font-bold">{d("rc.invoice")}</th><th className="px-2 py-2 text-start font-bold">{d("rc.customer")}</th>
                <th className="px-2 py-2 text-start font-bold">{d("rc.type")}</th><th className="px-2 py-2 text-start font-bold">{d("rc.branch")}</th>
                <th className="px-2 py-2 text-end font-bold">{d("rc.amount")}</th><th className="px-2 py-2 text-start font-bold">{d("rc.status")}</th>
                <th className="px-2 py-2 text-start font-bold">{d("rc.date")}</th><th className="px-5 py-2"><span className="sr-only">{d("view")}</span></th>
              </tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-b border-line/60 last:border-0 hover:bg-ink-3/50">
                    <td className="tnum px-5 py-2 font-bold">{r.invoiceNo}</td>
                    <td className="max-w-[160px] truncate px-2 py-2">{r.customer || d("rc.cashSale")}</td>
                    <td className="px-2 py-2 text-text-dim">{r.source === "car" ? d("rc.service") : d("rc.retail")}</td>
                    <td className="px-2 py-2 text-text-dim">{r.branch ?? "—"}</td>
                    <td className="tnum px-2 py-2 text-end font-extrabold">{fmtCurrency(r.total, 2)}</td>
                    <td className="px-2 py-2"><span className={`rounded-full px-2 py-0.5 text-t-xs font-extrabold ${STATUS_TONE[r.status] ?? "bg-ink-3"}`}>{d(`st.${r.status}` as any)}</span></td>
                    <td className="tnum px-2 py-2 text-t-xs text-text-dim">{when(r.at, isEn)}</td>
                    <td className="px-5 py-2 text-end"><Link href={`/sales/history?invoiceNo=${encodeURIComponent(r.invoiceNo)}`} aria-label={`${d("view")} ${r.invoiceNo}`} className="inline-grid h-8 w-8 place-items-center rounded-md text-petrol hover:bg-petrol-soft"><MIcon name="visibility" className="!text-[18px]" /></Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {/* بطاقات للجوال */}
          <ul className="divide-y divide-line/60 md:hidden">
            {rows.map((r) => (
              <li key={r.id}>
                <Link href={`/sales/history?invoiceNo=${encodeURIComponent(r.invoiceNo)}`} className="flex items-center justify-between gap-3 px-4 py-3">
                  <span className="min-w-0">
                    <span className="tnum block text-t-sm font-bold">{r.invoiceNo}</span>
                    <span className="block truncate text-t-xs text-text-dim">{r.customer || d("rc.cashSale")}</span>
                    <span className="tnum block text-t-xs text-text-dim">{when(r.at, isEn)}</span>
                  </span>
                  <span className="shrink-0 text-end">
                    <span className="tnum block text-t-sm font-extrabold">{fmtCurrency(r.total, 2)}</span>
                    <span className={`mt-0.5 inline-block rounded-full px-2 py-0.5 text-t-xs font-extrabold ${STATUS_TONE[r.status] ?? "bg-ink-3"}`}>{d(`st.${r.status}` as any)}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </Widget>
  );
}
