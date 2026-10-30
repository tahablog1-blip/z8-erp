"use client";
import Link from "next/link";
import { MIcon } from "@/components/m-icon";
import { Sparkline } from "./charts/Sparkline";
import { Skeleton } from "./Widget";
import { fmtPct } from "@/lib/dashboard/format";
import { useDx } from "@/lib/dashboard/i18n";

/** شارة التغيير مقارنة بالفترة السابقة. goodWhenUp=false للمصروفات (الارتفاع سيّئ) */
export function DeltaBadge({ pct, goodWhenUp = true }: { pct: number | null; goodWhenUp?: boolean }) {
  const { d } = useDx();
  if (pct == null) return <span className="text-t-xs text-text-dim" title={d("vsPrev")}>—</span>;
  const up = pct > 0.05, down = pct < -0.05;
  const good = up ? goodWhenUp : down ? !goodWhenUp : true;
  const tone = !up && !down ? "bg-ink-3 text-text-dim" : good ? "bg-emerald-bg text-emerald" : "bg-ember-bg text-ember";
  return (
    <span title={d("vsPrev")} className={`tnum inline-flex items-center gap-0.5 rounded-none px-1.5 py-0.5 text-t-xs font-extrabold ${tone}`} dir="ltr">
      <MIcon name={up ? "arrow_upward" : down ? "arrow_downward" : "remove"} className="!text-[13px]" />
      {fmtPct(Math.abs(pct))}
    </span>
  );
}

export type KpiProps = {
  label: string; tip?: string; icon: string; value: string; pct?: number | null; goodWhenUp?: boolean;
  spark?: number[]; sparkColor?: string; sub?: string; subTone?: "danger" | "warning" | "neutral"; href?: string; accent?: string;
};

export function KpiCard({ label, tip, icon, value, pct, goodWhenUp = true, spark, sparkColor, sub, subTone = "neutral", href, accent = "var(--petrol)" }: KpiProps) {
  const body = (
    <div className="flex h-full flex-col gap-1.5 p-3.5 sm:p-4" title={tip}>
      <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
        <span className="flex min-w-0 basis-full items-center gap-1.5 text-t-sm font-bold text-text-dim sm:basis-auto sm:flex-1">
          <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md" style={{ background: `color-mix(in srgb, ${accent} 14%, transparent)`, color: accent }}>
            <MIcon name={icon} className="!text-[16px]" />
          </span>
          <span className="truncate">{label}</span>
        </span>
        {pct !== undefined && <DeltaBadge pct={pct} goodWhenUp={goodWhenUp} />}
      </div>
      <div className="tnum text-t-2xl font-black leading-tight tracking-tight">{value}</div>
      <div className="mt-auto flex items-end justify-between gap-2">
        <span className={`truncate text-t-xs font-bold ${subTone === "danger" ? "text-ember" : subTone === "warning" ? "text-brass" : "text-text-dim"}`}>{sub ?? " "}</span>
      </div>
      {spark && spark.length > 1 && <Sparkline values={spark} color={sparkColor ?? accent} />}
    </div>
  );
  const cls = "group block h-full min-w-0 rounded-card border border-line bg-ink-2 shadow-card transition hover:-translate-y-0.5 hover:border-petrol/50 hover:shadow-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-petrol";
  return href ? <Link href={href} className={cls}>{body}</Link> : <div className={cls}>{body}</div>;
}

export function KpiSkeleton() {
  return (
    <div className="rounded-card border border-line bg-ink-2 p-4 shadow-card">
      <Skeleton className="mb-3 w-1/2" height={14} /><Skeleton className="mb-3 w-3/4" height={28} /><Skeleton className="w-full" height={30} />
    </div>
  );
}
