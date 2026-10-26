"use client";
import Link from "next/link";
import type { Executive } from "@/lib/dashboard/types";
import { fmtCurrency } from "@/lib/dashboard/format";
import { useDx, type DKey } from "@/lib/dashboard/i18n";
import { Widget, SectionEmpty } from "../Widget";
import { MIcon } from "@/components/m-icon";

const TONE = {
  danger: { box: "border-ember/30 bg-ember-bg", ic: "text-ember", icon: "error" },
  warning: { box: "border-brass/30 bg-brass-bg", ic: "text-brass", icon: "warning" },
  info: { box: "border-petrol/25 bg-petrol-soft", ic: "text-petrol", icon: "info" },
} as const;

export function SmartAlerts({ data, loading }: { data: Executive | null; loading: boolean }) {
  const { d } = useDx();
  const items = data?.alerts ?? [];
  return (
    <Widget title={d("alerts.title")} icon="notifications_active" loading={loading} skeletonHeight={140}>
      {!items.length ? (
        <SectionEmpty icon="verified" title={d("alerts.none")} />
      ) : (
        <ul className="space-y-2">
          {items.map((a) => {
            const t = TONE[a.tone] ?? TONE.info;
            return (
              <li key={a.key}>
                <Link href={a.href} className={`flex items-center gap-2.5 rounded-xl border px-3 py-2.5 transition hover:brightness-95 focus-visible:outline focus-visible:outline-2 focus-visible:outline-petrol ${t.box}`}>
                  <MIcon name={t.icon} filled className={`!text-[20px] ${t.ic}`} />
                  <span className="min-w-0 flex-1 text-t-sm font-bold">{d(`al.${a.key}` as DKey)}</span>
                  <span className="tnum shrink-0 text-t-sm font-black">{a.count != null ? a.count : fmtCurrency(a.amount)}</span>
                  <MIcon name="chevron_left" className="!text-[18px] text-text-dim ltr:rotate-180" />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </Widget>
  );
}
