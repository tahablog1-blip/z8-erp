"use client";
import Link from "next/link";

export type HBarRow = { key: string; label: string; value: number; display: string; sub?: string; href?: string; color?: string };

/** أشرطة أفقية مرتبة (فئات/موردين/مدينين) — الشريط الأطول = 100% */
export function HBars({ rows, color = "var(--petrol)" }: { rows: HBarRow[]; color?: string }) {
  const max = Math.max(1, ...rows.map((r) => Math.abs(r.value)));
  return (
    <ul className="space-y-3">
      {rows.map((r) => {
        const inner = (
          <>
            <div className="mb-1 flex items-baseline justify-between gap-3 text-t-sm">
              <span className="truncate font-bold">{r.label}</span>
              <span className="tnum shrink-0 font-extrabold">{r.display}</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-none bg-ink-3">
              <div className="h-full rounded-none transition-[width] duration-500" style={{ width: `${(Math.abs(r.value) / max) * 100}%`, background: r.color ?? color }} />
            </div>
            {r.sub && <div className="mt-1 text-t-xs text-text-dim">{r.sub}</div>}
          </>
        );
        return (
          <li key={r.key}>
            {r.href ? <Link href={r.href} className="block rounded-md outline-offset-2 transition hover:opacity-80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-petrol">{inner}</Link> : inner}
          </li>
        );
      })}
    </ul>
  );
}
