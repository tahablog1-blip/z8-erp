"use client";
import { useCx, type CKey } from "@/lib/customers/i18n";
import { initials } from "@/lib/customers/format";
import type { CustomerRow, Segment } from "@/lib/customers/types";

/** ألوان الحالة موحّدة في كل شاشات العملاء (نفس رموز التصميم: emerald/petrol/ember/brass/neutral) */
const TONES = {
  active: "bg-emerald-bg text-emerald", new: "bg-petrol-soft text-petrol", overdue: "bg-ember-bg text-ember",
  inactive: "bg-ink-3 text-text-dim", at_risk: "bg-brass-bg text-brass", disabled: "bg-ink-3 text-text-dim",
  vip: "bg-brass-bg text-brass", credit: "bg-petrol-soft text-petrol", regular: "bg-ink-3 text-text-dim", no_activity: "bg-ink-3 text-text-dim",
} as const;

export type StatusKey = "active" | "new" | "overdue" | "inactive" | "disabled";
export function statusOf(r: Pick<CustomerRow, "isActive" | "overdue" | "segment">): StatusKey {
  if (!r.isActive) return "disabled";
  if ((r.overdue ?? 0) > 0) return "overdue";
  if (r.segment === "new") return "new";
  if (r.segment === "inactive") return "inactive";
  return "active";
}

export function StatusBadge({ status }: { status: StatusKey }) {
  const { c } = useCx();
  return <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-t-xs font-extrabold ${TONES[status]}`}>
    <i className="h-1.5 w-1.5 rounded-full bg-current" />{c(`st.${status}` as CKey)}</span>;
}
export function SegmentBadge({ seg }: { seg: Segment | "credit" }) {
  const { c } = useCx();
  return <span className={`inline-flex whitespace-nowrap rounded-md px-1.5 py-0.5 text-t-xs font-bold ${TONES[seg]}`}>{c(`seg.${seg}` as CKey)}</span>;
}

export function Avatar({ name, size = 36 }: { name: string; size?: number }) {
  return <span aria-hidden style={{ width: size, height: size, fontSize: size * 0.38 }}
    className="grid shrink-0 place-items-center rounded-full bg-petrol-soft font-black text-petrol">{initials(name)}</span>;
}
