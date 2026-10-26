"use client";
import { useEffect, useState } from "react";
import { Button, Input, Select } from "@/components/ui";
import { MIcon } from "@/components/m-icon";
import { EMPTY_PFILTERS, type Facets, type PFilters } from "@/lib/products/types";

const Row = ({ label, children }: { label: string; children: React.ReactNode }) => <div className="space-y-1.5"><div className="text-t-xs font-extrabold text-text-dim">{label}</div>{children}</div>;
const Range = ({ a, b, onA, onB }: { a: string; b: string; onA: (v: string) => void; onB: (v: string) => void }) => (
  <div className="grid grid-cols-2 gap-2"><Input type="number" min={0} value={a} placeholder="من" aria-label="من" className="tnum" onChange={(e) => onA(e.target.value)} /><Input type="number" min={0} value={b} placeholder="إلى" aria-label="إلى" className="tnum" onChange={(e) => onB(e.target.value)} /></div>);

export function ProductFilters({ open, value, facets, onApply, onClose }: { open: boolean; value: PFilters; facets: Facets | null; onApply: (f: PFilters) => void; onClose: () => void }) {
  const [f, setF] = useState(value);
  useEffect(() => { if (open) setF(value); }, [open, value]);
  useEffect(() => { if (!open) return; const k = (e: KeyboardEvent) => e.key === "Escape" && onClose(); window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k); }, [open, onClose]);
  if (!open) return null;
  const set = <K extends keyof PFilters>(k: K, v: PFilters[K]) => setF((p) => ({ ...p, [k]: v }));
  return (
    <div className="fixed inset-0 z-[80]" role="dialog" aria-modal="true" aria-label="فلاتر متقدمة">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <aside className="cx-drawer absolute inset-y-0 end-0 flex w-full max-w-sm flex-col border-s border-line bg-ink-2 shadow-2xl">
        <header className="flex items-center justify-between border-b border-line px-4 py-3">
          <h2 className="flex items-center gap-2 text-t-lg font-black"><MIcon name="tune" className="!text-[20px] text-petrol" />فلاتر متقدمة</h2>
          <button onClick={onClose} aria-label="إغلاق" className="grid h-9 w-9 place-items-center rounded-lg text-text-dim hover:bg-ink-3"><MIcon name="close" className="!text-[20px]" /></button>
        </header>
        <div className="flex-1 space-y-5 overflow-y-auto p-4">
          <Row label="حالة الصنف"><Select value={f.status} onChange={(e) => set("status", e.target.value as PFilters["status"])}><option value="active">نشط</option><option value="inactive">غير نشط</option><option value="all">الكل</option></Select></Row>
          <Row label="نوع الصنف"><Select value={f.type} onChange={(e) => set("type", e.target.value as PFilters["type"])}><option value="">الكل</option><option value="product">منتج بمخزون</option><option value="service">خدمة</option><option value="oil">زيت</option><option value="oilFilter">فلتر زيت</option></Select></Row>
          <Row label="التصنيف"><Select value={f.category} onChange={(e) => set("category", e.target.value)}><option value="">الكل</option>{facets?.categories.map((c) => <option key={c.name} value={c.name}>{c.name} ({c.count})</option>)}</Select></Row>
          <Row label="العلامة التجارية (شركة الزيت)"><Select value={f.brand} onChange={(e) => set("brand", e.target.value)}><option value="">الكل</option>{facets?.brands.map((b) => <option key={b.name} value={b.name}>{b.name} ({b.count})</option>)}</Select></Row>
          <Row label="المورد"><Select value={f.supplier} onChange={(e) => set("supplier", e.target.value)}><option value="">الكل</option>{facets?.suppliers.map((s) => <option key={s} value={s}>{s}</option>)}</Select></Row>
          <Row label="الموقع (المستودع/الفرع)"><Select value={f.loc} onChange={(e) => set("loc", e.target.value)}><option value="">كل المواقع</option>{facets?.locations.map((l) => <option key={l.id} value={l.type === "warehouse" ? "warehouse" : l.id}>{l.name}</option>)}</Select></Row>
          <Row label="المخزون"><Select value={f.stock} onChange={(e) => set("stock", e.target.value as PFilters["stock"])}><option value="">الكل</option><option value="in">متوفر</option><option value="low">منخفض</option><option value="out">نافد</option></Select></Row>
          <Row label="الحركة (آخر 90 يوماً)"><Select value={f.movement} onChange={(e) => set("movement", e.target.value as PFilters["movement"])}><option value="">الكل</option><option value="fast">سريع الحركة</option><option value="slow">بطيء الحركة</option><option value="dead">راكد (بلا مبيعات)</option></Select></Row>
          <Row label="نطاق سعر البيع (قبل الضريبة)"><Range a={f.priceMin} b={f.priceMax} onA={(v) => set("priceMin", v)} onB={(v) => set("priceMax", v)} /></Row>
          <Row label="نطاق الكمية بالمخزون"><Range a={f.stockMin} b={f.stockMax} onA={(v) => set("stockMin", v)} onB={(v) => set("stockMax", v)} /></Row>
        </div>
        <footer className="flex gap-2 border-t border-line p-3"><Button variant="ghost" className="flex-1" onClick={() => setF(EMPTY_PFILTERS)}>مسح الكل</Button><Button className="flex-1" onClick={() => { onApply(f); onClose(); }}>تطبيق</Button></footer>
      </aside>
    </div>
  );
}
