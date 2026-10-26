"use client";
import { useEffect, useRef, useState } from "react";

/** عرض العنصر الفعلي (px) — الرسوم بتتبني بقياس حقيقي بدل viewBox مشوّه */
export function useWidth<T extends HTMLElement>(fallback = 600) {
  const ref = useRef<T>(null);
  const [w, setW] = useState(fallback);
  useEffect(() => {
    const el = ref.current; if (!el) return;
    setW(el.clientWidth || fallback);
    const ro = new ResizeObserver((e) => setW(Math.round(e[0].contentRect.width) || fallback));
    ro.observe(el);
    return () => ro.disconnect();
  }, [fallback]);
  return [ref, w] as const;
}

/** مقياس "لطيف": حدود ومحاور بأرقام مدورة */
export function niceScale(min: number, max: number, ticks = 4): { min: number; max: number; ticks: number[] } {
  if (min === max) { max = min + 1; }
  const span = max - min;
  const rough = span / ticks;
  const pow = Math.pow(10, Math.floor(Math.log10(rough)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * pow).find((s) => s >= rough) ?? 10 * pow;
  const lo = Math.floor(min / step) * step, hi = Math.ceil(max / step) * step;
  const out: number[] = [];
  for (let v = lo; v <= hi + step / 2; v += step) out.push(Math.abs(v) < 1e-9 ? 0 : v);
  return { min: lo, max: hi, ticks: out };
}
