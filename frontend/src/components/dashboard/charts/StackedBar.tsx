"use client";
export type StackSegment = { key: string; label: string; value: number; color: string };

/** شريط مجزّأ (أعمار الذمم): حجم كل شريحة = نسبتها من الإجمالي، والأرقام تحتها */
export function StackedBar({ segments, format, ariaLabel }: { segments: StackSegment[]; format: (n: number) => string; ariaLabel: string }) {
  const total = segments.reduce((s, x) => s + Math.max(0, x.value), 0);
  return (
    <div>
      <div className="flex h-3 w-full overflow-hidden rounded-full bg-ink-3" role="img" aria-label={ariaLabel} dir="ltr">
        {total > 0 && segments.filter((s) => s.value > 0).map((s) => (
          <span key={s.key} title={`${s.label}: ${format(s.value)}`} style={{ width: `${(s.value / total) * 100}%`, background: s.color, minWidth: 4 }} />
        ))}
      </div>
      <ul className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3">
        {segments.map((s) => (
          <li key={s.key} className="flex items-center justify-between gap-2 text-t-xs">
            <span className="inline-flex min-w-0 items-center gap-1.5 text-text-dim"><span className="h-2 w-2 shrink-0 rounded-full" style={{ background: s.color }} /><span className="truncate">{s.label}</span></span>
            <b className="tnum shrink-0 text-text">{format(s.value)}</b>
          </li>
        ))}
      </ul>
    </div>
  );
}
