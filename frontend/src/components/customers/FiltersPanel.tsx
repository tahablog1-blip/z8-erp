"use client";
import { useEffect, useState } from "react";
import { Button, Input, Select } from "@/components/ui";
import { MIcon } from "@/components/m-icon";
import { useCx } from "@/lib/customers/i18n";
import { EMPTY_FILTERS, type Filters } from "@/lib/customers/types";

const Row = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div className="space-y-1.5"><div className="text-t-xs font-extrabold text-text-dim">{label}</div>{children}</div>
);
const Range = ({ a, b, onA, onB, type = "number" }: { a: string; b: string; onA: (v: string) => void; onB: (v: string) => void; type?: string }) => {
  const { c } = useCx();
  return (
    <div className="grid grid-cols-2 gap-2">
      <Input type={type} value={a} placeholder={c("from")} aria-label={c("from")} className="tnum" onChange={(e) => onA(e.target.value)} />
      <Input type={type} value={b} placeholder={c("to")} aria-label={c("to")} className="tnum" onChange={(e) => onB(e.target.value)} />
    </div>
  );
};
const Check = ({ label, on, set }: { label: string; on: boolean; set: (v: boolean) => void }) => (
  <label className="flex min-h-[36px] cursor-pointer items-center gap-2 text-t-sm font-bold">
    <input type="checkbox" checked={on} onChange={(e) => set(e.target.checked)} className="h-4 w-4 accent-[var(--petrol)]" />{label}
  </label>
);

export function FiltersPanel({ open, value, onApply, onClose }: { open: boolean; value: Filters; onApply: (f: Filters) => void; onClose: () => void }) {
  const { c } = useCx();
  const [f, setF] = useState(value);
  useEffect(() => { if (open) setF(value); }, [open, value]);
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k);
  }, [open, onClose]);
  if (!open) return null;
  const set = <K extends keyof Filters>(k: K, v: Filters[K]) => setF((p) => ({ ...p, [k]: v }));
  return (
    <div className="fixed inset-0 z-[80]" role="dialog" aria-modal="true" aria-label={c("filters")}>
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <aside className="cx-drawer absolute inset-y-0 end-0 flex w-full max-w-sm flex-col border-s border-line bg-ink-2 shadow-2xl">
        <header className="flex items-center justify-between border-b border-line px-4 py-3">
          <h2 className="flex items-center gap-2 text-t-lg font-black"><MIcon name="tune" className="!text-[20px] text-petrol" />{c("filters")}</h2>
          <button onClick={onClose} aria-label="إغلاق" className="grid h-9 w-9 place-items-center rounded-lg text-text-dim hover:bg-ink-3"><MIcon name="close" className="!text-[20px]" /></button>
        </header>
        <div className="flex-1 space-y-5 overflow-y-auto p-4">
          <Row label={c("f.status")}>
            <Select value={f.status} onChange={(e) => set("status", e.target.value as Filters["status"])}>
              <option value="active">{c("st.active")}</option><option value="inactive">{c("st.disabled")}</option><option value="all">{c("f.all")}</option>
            </Select>
          </Row>
          <Row label={c("f.type")}>
            <Select value={f.type} onChange={(e) => set("type", e.target.value as Filters["type"])}>
              <option value="">{c("f.all")}</option><option value="individual">{c("individual")}</option><option value="company">{c("company")}</option>
            </Select>
          </Row>
          <Row label={c("f.segment")}>
            <Select value={f.segment} onChange={(e) => set("segment", e.target.value as Filters["segment"])}>
              <option value="">{c("f.all")}</option>
              {(["vip", "new", "regular", "at_risk", "inactive", "no_activity"] as const).map((s) => <option key={s} value={s}>{c(`seg.${s}` as never)}</option>)}
            </Select>
          </Row>
          <Row label={c("f.pay")}>
            <Select value={f.pay} onChange={(e) => set("pay", e.target.value as Filters["pay"])}>
              <option value="">{c("f.all")}</option><option value="cash">{c("f.cash")}</option><option value="credit">{c("f.credit")}</option>
            </Select>
          </Row>
          <div className="space-y-0.5">
            <Check label={c("f.hasBalance")} on={f.hasBalance} set={(v) => set("hasBalance", v)} />
            <Check label={c("f.overdue")} on={f.overdue} set={(v) => set("overdue", v)} />
            <Check label={c("f.noActivity")} on={f.noActivity} set={(v) => set("noActivity", v)} />
          </div>
          <Row label={c("f.reg")}><Range type="date" a={f.regFrom} b={f.regTo} onA={(v) => set("regFrom", v)} onB={(v) => set("regTo", v)} /></Row>
          <Row label={c("f.last")}><Range type="date" a={f.lastFrom} b={f.lastTo} onA={(v) => set("lastFrom", v)} onB={(v) => set("lastTo", v)} /></Row>
          <Row label={c("f.sales")}><Range a={f.salesMin} b={f.salesMax} onA={(v) => set("salesMin", v)} onB={(v) => set("salesMax", v)} /></Row>
          <Row label={c("f.bal")}><Range a={f.balMin} b={f.balMax} onA={(v) => set("balMin", v)} onB={(v) => set("balMax", v)} /></Row>
        </div>
        <footer className="flex gap-2 border-t border-line p-3">
          <Button variant="ghost" className="flex-1" onClick={() => setF(EMPTY_FILTERS)}>{c("clearAll")}</Button>
          <Button className="flex-1" onClick={() => { onApply(f); onClose(); }}>{c("apply")}</Button>
        </footer>
      </aside>
    </div>
  );
}
