"use client";
import { useId, useMemo, useState } from "react";
import { niceScale, useWidth } from "./useSize";

export type ChartSeries = { key: string; label: string; color: string; values: number[]; area?: boolean; dashed?: boolean };

/** رسم خطي/مساحي متعدد السلاسل بمحاور وشبكة وتلميح تفاعلي (مؤشر الماوس/اللمس) — SVG يدوي بلا مكتبات.
 *  المحور الزمني بيمشي يسار←يمين حتى في الواجهة العربية (أقدم → أحدث) عشان قراءة الاتجاه ثابتة. */
export function AreaChart({ labels, series, height = 260, formatValue, formatTick, ariaLabel }: {
  labels: string[]; series: ChartSeries[]; height?: number;
  formatValue: (n: number) => string; formatTick: (n: number) => string; ariaLabel: string;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const uid = useId().replace(/:/g, "");
  const n = labels.length;
  const m = { l: 52, r: 10, t: 12, b: 26 };
  const W = Math.max(width, 240), H = height;
  const pw = W - m.l - m.r, ph = H - m.t - m.b;

  const { y, scale } = useMemo(() => {
    const all = series.flatMap((s) => s.values);
    const sc = niceScale(Math.min(0, ...all), Math.max(0, ...all) * 1.04 || 1, 4);
    return { scale: sc, y: (v: number) => m.t + ph - ((v - sc.min) / (sc.max - sc.min || 1)) * ph };
  }, [series, ph, m.t]);
  const x = (i: number) => m.l + (n <= 1 ? pw / 2 : (i / (n - 1)) * pw);

  const path = (vals: number[]) => vals.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const areaPath = (vals: number[]) => `${path(vals)} L${x(n - 1).toFixed(1)},${y(0).toFixed(1)} L${x(0).toFixed(1)},${y(0).toFixed(1)} Z`;

  const step = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(pw / 78))));
  function onMove(e: React.PointerEvent<SVGSVGElement>) {
    const r = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - r.left - m.l;
    setHover(Math.max(0, Math.min(n - 1, Math.round((px / (pw || 1)) * (n - 1)))));
  }
  const tipLeft = hover == null ? 0 : x(hover);
  const flip = tipLeft > W * 0.62;

  return (
    <div ref={ref} dir="ltr" className="relative w-full select-none">
      <svg width={W} height={H} role="img" aria-label={ariaLabel} onPointerMove={onMove} onPointerLeave={() => setHover(null)} className="block touch-pan-y">
        <defs>
          {series.filter((s) => s.area).map((s) => (
            <linearGradient key={s.key} id={`${uid}${s.key}`} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor={s.color} stopOpacity="0.20" /><stop offset="100%" stopColor={s.color} stopOpacity="0" />
            </linearGradient>
          ))}
        </defs>
        {scale.ticks.map((t) => (
          <g key={t}>
            <line x1={m.l} x2={W - m.r} y1={y(t)} y2={y(t)} stroke="var(--chart-grid)" strokeDasharray={t === 0 ? undefined : "3 4"} strokeWidth={t === 0 ? 1.2 : 1} />
            <text x={m.l - 8} y={y(t)} textAnchor="end" dominantBaseline="middle" fontSize="10.5" fill="var(--text-dim)" className="tnum">{formatTick(t)}</text>
          </g>
        ))}
        {labels.map((l, i) => (i % step === 0 && (n - 1 - i >= step * 0.6 || i === n - 1)) && (
          <text key={i} x={x(i)} y={H - 7} textAnchor={i === 0 ? "start" : i === n - 1 ? "end" : "middle"} fontSize="10.5" fill="var(--text-dim)" className="tnum" direction="ltr" style={{ unicodeBidi: "isolate" }}>{l}</text>
        ))}
        {series.map((s) => s.area && n > 1 && <path key={`a${s.key}`} d={areaPath(s.values)} fill={`url(#${uid}${s.key})`} />)}
        {series.map((s) => n > 0 && (
          <path key={s.key} d={path(s.values)} fill="none" stroke={s.color} strokeWidth={s.key === series[0].key ? 2.2 : 1.8}
            strokeDasharray={s.dashed ? "5 4" : undefined} strokeLinejoin="round" strokeLinecap="round" />
        ))}
        {hover != null && (
          <g pointerEvents="none">
            <line x1={x(hover)} x2={x(hover)} y1={m.t} y2={H - m.b} stroke="var(--text-dim)" strokeOpacity="0.45" strokeDasharray="3 3" />
            {series.map((s) => <circle key={s.key} cx={x(hover)} cy={y(s.values[hover] ?? 0)} r="4" fill="var(--ink2)" stroke={s.color} strokeWidth="2" />)}
          </g>
        )}
      </svg>
      {hover != null && (
        <div role="tooltip" className="pointer-events-none absolute top-2 z-10 min-w-[150px] rounded-lg border border-line bg-ink-2 px-3 py-2 text-t-xs shadow-lg"
          style={flip ? { right: W - tipLeft + 12 } : { left: tipLeft + 12 }}>
          <div className="mb-1 font-bold text-text">{labels[hover]}</div>
          {series.map((s) => (
            <div key={s.key} className="flex items-center justify-between gap-4">
              <span className="inline-flex items-center gap-1.5 text-text-dim"><span className="h-2 w-2 rounded-full" style={{ background: s.color }} />{s.label}</span>
              <b className="tnum">{formatValue(s.values[hover] ?? 0)}</b>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
