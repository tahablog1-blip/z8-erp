"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { api } from "@/lib/api";
import { MIcon } from "@/components/m-icon";
import { PERIODS, rangeFor, type PeriodKey } from "@/lib/dashboard/periods";
import { Badge, type Tone } from "@/components/ui";
import { STATUS_LABEL, type ItemStatus } from "@/lib/inventory/types";

const ITEM_TONE: Record<ItemStatus, Tone> = { ok: "success", low: "warning", out: "danger", dead: "neutral" };
export function StatusPill({ s }: { s: ItemStatus }) {
  return <Badge tone={ITEM_TONE[s]} dot>{STATUS_LABEL[s]}</Badge>;
}

export const fmtN = (n: number | null | undefined) => (n == null ? "—" : Number(n).toLocaleString("en-US"));
export const fmtM = (n: number | null | undefined) => (n == null ? "—" : Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
/** مبلغ بإشارة صحيحة داخل سياق RTL (السالب يظهر -123 لا 123-) */
export const Money = ({ v }: { v: number | null | undefined }) => <span dir="ltr" className="inline-block">{fmtM(v)}</span>;
export const fmtD = (s: string | null | undefined) => (s ? new Date(s).toLocaleDateString("en-GB") : "—");
export const fmtDT = (s: string | null | undefined) => (s ? new Date(s).toLocaleString("en-GB", { hour12: false, dateStyle: "short", timeStyle: "short" }) : "—");

export type Period = { key: PeriodKey; from: string; to: string };
export const defaultPeriod = (): Period => ({ key: "month", ...rangeFor("month") });
const DEFAULT_KEYS = ["today", "week", "month"];

/** فترة الحركة فقط — لا تؤثر على الرصيد الحالي (الرصيد دائماً لحظي من السيرفر) */
export function PeriodPicker({ value, onChange, keys = DEFAULT_KEYS }: { value: Period; onChange: (p: Period) => void; keys?: string[] }) {
  const [custom, setCustom] = useState(value.key === "custom");
  const QUICK = PERIODS.filter((p) => keys.includes(p.key));
  return (
    <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="فترة الحركة">
      {QUICK.map((p) => (
        <button key={p.key} aria-pressed={value.key === p.key} onClick={() => { setCustom(false); onChange({ key: p.key, ...rangeFor(p.key) }); }}
          className={`rounded-full border px-3 py-1 text-t-xs font-bold ${value.key === p.key ? "border-petrol bg-petrol text-white" : "border-line bg-ink-2 text-text-dim hover:border-petrol"}`}>{p.ar}</button>
      ))}
      <button aria-pressed={custom || value.key === "custom"} onClick={() => setCustom((c) => !c)}
        className={`inline-flex items-center gap-1 rounded-full border px-3 py-1 text-t-xs font-bold ${value.key === "custom" ? "border-petrol bg-petrol text-white" : "border-line bg-ink-2 text-text-dim hover:border-petrol"}`}>
        <MIcon name="date_range" className="!text-[14px]" />مخصص</button>
      {custom && (
        <span className="flex items-center gap-1">
          <input type="date" aria-label="من" value={value.from} max={value.to} onChange={(e) => e.target.value && onChange({ key: "custom", from: e.target.value, to: value.to })} className="rounded-lg border border-line bg-ink-2 px-2 py-1 text-t-xs" />
          <input type="date" aria-label="إلى" value={value.to} min={value.from} onChange={(e) => e.target.value && onChange({ key: "custom", from: value.from, to: e.target.value })} className="rounded-lg border border-line bg-ink-2 px-2 py-1 text-t-xs" />
        </span>
      )}
    </div>
  );
}

export function useDebounced<T>(v: T, ms = 350): T {
  const [d, setD] = useState(v);
  useEffect(() => { const t = setTimeout(() => setD(v), ms); return () => clearTimeout(t); }, [v, ms]);
  return d;
}

/** جلب بيانات للقراءة مع إلغاء الطلب القديم — يعيد { data, loading, error, reload } */
export function useFetch<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [tick, setTick] = useState(0);
  const seq = useRef(0);
  useEffect(() => {
    if (path == null) return;
    const my = ++seq.current;
    setLoading(true); setError("");
    api<T>(path).then((d) => { if (my === seq.current) setData(d); })
      .catch((e: unknown) => { if (my === seq.current) setError(e instanceof Error ? e.message : "تعذر تحميل البيانات"); })
      .finally(() => { if (my === seq.current) setLoading(false); });
  }, [path, tick]);
  return { data, loading, error, reload: () => setTick((t) => t + 1) };
}

export function Panel({ title, icon, actions, children }: { title: string; icon?: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-card border border-line bg-ink-2 shadow-card">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
        <h2 className="flex items-center gap-1.5 text-t-md font-black">{icon && <MIcon name={icon} className="!text-[18px] text-petrol" />}{title}</h2>
        {actions}
      </header>
      <div className="p-4">{children}</div>
    </section>
  );
}

export function qs(o: Record<string, string | number | null | undefined>) {
  const u = new URLSearchParams();
  Object.entries(o).forEach(([k, v]) => { if (v !== null && v !== undefined && v !== "") u.set(k, String(v)); });
  return u.toString();
}
