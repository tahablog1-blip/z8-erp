"use client";
import { useState } from "react";
import { MIcon } from "@/components/m-icon";
import { PERIODS, type PeriodKey } from "@/lib/dashboard/periods";
import { useDx } from "@/lib/dashboard/i18n";

export type FilterState = { period: PeriodKey; from: string; to: string; branchId: string | null };

/** شريط الفلتر الشامل: فترات جاهزة + فترة مخصصة + الفرع. أي تغيير يعيد تحميل كل اللوحة بطلب واحد. */
export function GlobalFilters({ value, branches, onChange, onRefresh, refreshing, lastUpdated }: {
  value: FilterState; branches: { id: string; name: string }[] | null;
  onChange: (v: FilterState) => void; onRefresh: () => void; refreshing: boolean; lastUpdated: Date | null;
}) {
  const { d, isEn } = useDx();
  const [customOpen, setCustomOpen] = useState(value.period === "custom");
  const [cf, setCf] = useState(value.from), [ct, setCt] = useState(value.to);
  const bad = !cf || !ct || cf > ct;

  return (
    <div className="space-y-2" role="search" aria-label={d("period")}>
      <div className="flex flex-wrap items-center gap-2">
        <div className="-mx-1 flex max-w-full gap-1 overflow-x-auto px-1 pb-1 [scrollbar-width:none]" role="tablist" aria-label={d("period")}>
          {PERIODS.map((p) => {
            const on = value.period === p.key;
            return (
              <button key={p.key} role="tab" aria-selected={on} onClick={() => { setCustomOpen(false); onChange({ ...value, period: p.key }); }}
                className={`shrink-0 whitespace-nowrap rounded-none border px-3 py-1.5 text-t-sm font-bold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-petrol ${on ? "border-petrol bg-petrol text-white" : "border-line bg-ink-2 text-text-dim hover:border-petrol hover:text-petrol"}`}>
                {isEn ? p.en : p.ar}
              </button>
            );
          })}
          <button role="tab" aria-selected={value.period === "custom"} onClick={() => setCustomOpen((o) => !o)}
            className={`inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-none border px-3 py-1.5 text-t-sm font-bold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-petrol ${value.period === "custom" ? "border-petrol bg-petrol text-white" : "border-line bg-ink-2 text-text-dim hover:border-petrol hover:text-petrol"}`}>
            <MIcon name="date_range" className="!text-[16px]" />{d("custom")}
          </button>
        </div>
        <div className="ms-auto flex items-center gap-2">
          {branches && branches.length > 1 && (
            <label className="flex items-center gap-1.5 text-t-sm font-bold text-text-dim">
              <MIcon name="store" className="!text-[17px]" /><span className="sr-only">{d("branch")}</span>
              <select value={value.branchId ?? ""} onChange={(e) => onChange({ ...value, branchId: e.target.value || null })}
                className="max-w-[160px] rounded-lg border border-line bg-ink-2 px-2.5 py-1.5 text-t-sm font-bold text-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-petrol">
                <option value="">{d("allBranches")}</option>
                {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </label>
          )}
          <button onClick={onRefresh} aria-label={d("refresh")} title={lastUpdated ? `${d("updated")} ${lastUpdated.toLocaleTimeString(isEn ? "en-US" : "ar-SA-u-nu-latn", { hour: "2-digit", minute: "2-digit" })}` : d("refresh")}
            className="grid h-9 w-9 place-items-center rounded-lg border border-line bg-ink-2 text-text-dim hover:border-petrol hover:text-petrol focus-visible:outline focus-visible:outline-2 focus-visible:outline-petrol">
            <MIcon name="refresh" className={`!text-[19px] ${refreshing ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>
      {customOpen && (
        <div className="flex flex-wrap items-end gap-2 rounded-card border border-line bg-ink-2 p-3">
          <label className="text-t-xs font-bold text-text-dim">{d("from")}
            <input type="date" value={cf} max={ct || undefined} onChange={(e) => setCf(e.target.value)} className="mt-1 block rounded-lg border border-line bg-ink px-2.5 py-1.5 text-t-sm text-text" />
          </label>
          <label className="text-t-xs font-bold text-text-dim">{d("to")}
            <input type="date" value={ct} min={cf || undefined} onChange={(e) => setCt(e.target.value)} className="mt-1 block rounded-lg border border-line bg-ink px-2.5 py-1.5 text-t-sm text-text" />
          </label>
          <button disabled={bad} onClick={() => onChange({ ...value, period: "custom", from: cf, to: ct })}
            className="rounded-lg bg-petrol px-4 py-1.5 text-t-sm font-bold text-white disabled:opacity-45">{d("apply")}</button>
        </div>
      )}
    </div>
  );
}
