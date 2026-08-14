"use client";
// components/StockItemsEditor.tsx — محرّر أصناف السند (استلام / تحويل / تعديل)
// مكوّن واحد بيخدم الثلاث حالات بدل تكرار نفس الجدول ثلاث مرات.
// productLabel بيتخزّن كنسخة نصية وقت الحركة — لكي السند القديم يفضل مقروء
// حتى لو الصنف اتعدّل اسمه أو اتحذف بعدين.
import { useMemo, useState } from "react";
import { Button, Input, Select } from "@/components/ui";
import { Product, productLabel } from "@/modules/products/types";

export type StockLine = {
  productId: string;
  productLabel: string;
  barcode: string | null;
  qty: number;
  unitCost?: number;
};

export function StockItemsEditor({
  products, items, onChange, withCost = false, availability,
}: {
  products: Product[];
  items: StockLine[];
  onChange: (items: StockLine[]) => void;
  withCost?: boolean;
  /** رصيد المصدر لكل صنف — بيتعرض كتحذير مبكر قبل ما السيرفر يرفض */
  availability?: Record<string, number>;
}) {
  const [q, setQ] = useState("");

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return products;
    return products.filter((p) =>
      productLabel(p).toLowerCase().includes(needle) ||
      (p.barcode || "").toLowerCase().includes(needle));
  }, [products, q]);

  function addLine() {
    onChange([...items, { productId: "", productLabel: "", barcode: null, qty: 1, ...(withCost ? { unitCost: 0 } : {}) }]);
  }
  function setLine(i: number, patch: Partial<StockLine>) {
    onChange(items.map((it, idx) => (idx === i ? { ...it, ...patch } : it)));
  }
  function removeLine(i: number) {
    onChange(items.filter((_, idx) => idx !== i));
  }
  function pickProduct(i: number, productId: string) {
    const p = products.find((x) => x.id === productId);
    setLine(i, {
      productId,
      productLabel: p ? productLabel(p) : "",
      barcode: p?.barcode ?? null,
      ...(withCost && p ? { unitCost: Number(p.cost_price) || 0 } : {}),
    });
  }

  const totalQty = items.reduce((s, it) => s + (it.qty || 0), 0);
  const totalCost = items.reduce((s, it) => s + (it.unitCost || 0) * (it.qty || 0), 0);

  return (
    <div className="space-y-2">
      <Input value={q} onChange={(e) => setQ(e.target.value)}
             placeholder="فلترة قائمة الأصناف بالاسم أو الباركود..." />

      <div className="overflow-x-auto rounded-lg border border-line">
        <table className="w-full border-collapse text-[12.5px]">
          <thead>
            <tr className="bg-ink-3 text-[11.5px] font-extrabold text-text-dim">
              <th className="px-2 py-2 text-right">الصنف</th>
              <th className="w-24 px-2 py-2 text-right">الكمية</th>
              {withCost && <th className="w-28 px-2 py-2 text-right">تكلفة الوحدة</th>}
              <th className="w-10 px-2 py-2" />
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <tr>
                <td colSpan={withCost ? 4 : 3} className="px-3 py-6 text-center text-text-dim">
                  أضف أول صنف للسند
                </td>
              </tr>
            ) : items.map((it, i) => {
              const avail = availability?.[it.productId];
              const short = avail !== undefined && it.qty > avail;
              return (
                <tr key={i} className="border-t border-line/70">
                  <td className="px-2 py-1.5">
                    <Select value={it.productId} onChange={(e) => pickProduct(i, e.target.value)}>
                      <option value="">— اختر الصنف —</option>
                      {/* الصنف المختار يفضل ظاهر حتى لو الفلترة استبعدته */}
                      {it.productId && !filtered.some((p) => p.id === it.productId) && (
                        <option value={it.productId}>{it.productLabel}</option>
                      )}
                      {filtered.map((p) => (
                        <option key={p.id} value={p.id}>{productLabel(p)}</option>
                      ))}
                    </Select>
                    {avail !== undefined && (
                      <div className={`mt-1 text-[11px] ${short ? "font-bold text-ember" : "text-text-dim"}`}>
                        المتاح في المصدر: <span className="tnum">{avail}</span>
                        {short && " — الكمية المطلوبة أكبر من الرصيد"}
                      </div>
                    )}
                  </td>
                  <td className="px-2 py-1.5">
                    <Input type="number" min={1} className="tnum" value={it.qty}
                           onChange={(e) => setLine(i, { qty: Math.max(1, +e.target.value || 1) })} />
                  </td>
                  {withCost && (
                    <td className="px-2 py-1.5">
                      <Input type="number" min={0} step="0.01" className="tnum" value={it.unitCost ?? 0}
                             onChange={(e) => setLine(i, { unitCost: +e.target.value || 0 })} />
                    </td>
                  )}
                  <td className="px-2 py-1.5 text-center">
                    <button onClick={() => removeLine(i)} aria-label="حذف السطر"
                            className="rounded-md px-2 py-1 text-text-dim hover:bg-ember-bg hover:text-ember">✕</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button variant="ghost" onClick={addLine}>+ إضافة صنف</Button>
        <div className="text-[12px] text-text-dim">
          إجمالي الكميات: <span className="tnum font-bold text-text">{totalQty}</span>
          {withCost && (
            <>
              <span className="mx-2">·</span>
              إجمالي التكلفة: <span className="tnum font-bold text-text">{totalCost.toFixed(2)}</span> ر.س
            </>
          )}
        </div>
      </div>
    </div>
  );
}
