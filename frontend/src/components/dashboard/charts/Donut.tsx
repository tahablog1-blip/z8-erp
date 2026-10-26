"use client";
export type DonutSegment = { key: string; label: string; value: number; color: string };

/** حلقة بنسب — مع نص مركزي. بتستخدم فقط لتوزيع بسيط (طرق الدفع / فئات المصروفات). */
export function Donut({ segments, size = 148, thickness = 18, centerLabel, centerValue, ariaLabel }: {
  segments: DonutSegment[]; size?: number; thickness?: number; centerLabel?: string; centerValue?: string; ariaLabel: string;
}) {
  const total = segments.reduce((s, x) => s + Math.max(0, x.value), 0);
  const r = (size - thickness) / 2, c = 2 * Math.PI * r;
  let offset = 0;
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }} dir="ltr">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={ariaLabel} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--ink4)" strokeWidth={thickness} opacity="0.55" />
        {total > 0 && segments.filter((s) => s.value > 0).map((s) => {
          const len = (s.value / total) * c;
          const el = <circle key={s.key} cx={size / 2} cy={size / 2} r={r} fill="none" stroke={s.color} strokeWidth={thickness}
            strokeDasharray={`${Math.max(len - 2, 0)} ${c - Math.max(len - 2, 0)}`} strokeDashoffset={-offset} strokeLinecap="butt" />;
          offset += len; return el;
        })}
      </svg>
      <div className="absolute inset-0 grid place-items-center text-center">
        <div>
          {centerValue && <div className="tnum text-t-lg font-black leading-tight">{centerValue}</div>}
          {centerLabel && <div className="text-t-xs text-text-dim">{centerLabel}</div>}
        </div>
      </div>
    </div>
  );
}
