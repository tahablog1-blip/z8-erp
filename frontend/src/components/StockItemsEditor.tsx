"use client";
// components/StockItemsEditor.tsx — محرّر أصناف السند (استلام / تحويل / تعديل / شراء)
// مكوّن واحد بيخدم كل الحالات. الإضافة بالبحث المباشر (اسم أو باركود) أو بسكانر الباركود.
// productLabel بيتخزّن كنسخة نصية وقت الحركة — لكي السند القديم يفضل مقروء
// حتى لو الصنف اتعدّل اسمه أو اتحذف بعدين.
import { useMemo, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { Button, Input } from "@/components/ui";
import { Product, productLabel } from "@/modules/products/types";
import { MIcon } from "@/components/m-icon";

export type StockLine = {
  productId: string;
  productLabel: string;
  barcode: string | null;
  qty: number;
  unitCost?: number;
};

const MAX_RESULTS = 20;

/** خانة بحث مباشر: اسم (كلمات متعددة) أو باركود. Enter على باركود مطابق = إضافة فورية. */
function ProductPicker({ products, onPick, placeholder }: {
  products: Product[];
  onPick: (p: Product) => void;
  placeholder: string;
}) {
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  const byBarcode = useMemo(() => {
    const m = new Map<string, Product>();
    for (const p of products) {
      const b = (p.barcode || "").trim().toLowerCase();
      if (b && !m.has(b)) m.set(b, p);
    }
    return m;
  }, [products]);

  const results = useMemo(() => {
    const tokens = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (!tokens.length) return [] as Product[];
    const out: Product[] = [];
    for (const p of products) {
      const hay = `${productLabel(p)} ${p.barcode || ""}`.toLowerCase();
      if (tokens.every((t) => hay.includes(t))) {
        out.push(p);
        if (out.length >= MAX_RESULTS) break;
      }
    }
    return out;
  }, [products, q]);

  function refocus() {
    boxRef.current?.querySelector("input")?.focus();
  }

  function choose(p: Product) {
    onPick(p);
    setQ("");
    setActive(0);
    setMsg({ ok: true, text: `تمت الإضافة: ${productLabel(p)}` });
    refocus();
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, Math.max(results.length - 1, 0)));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const raw = q.trim();
      if (!raw) return;
      const hit = byBarcode.get(raw.toLowerCase());
      if (hit) { choose(hit); return; }
      // باركود رقمي طويل غير موجود: لا نخمّن صنفاً
      if (/^\d{8,}$/.test(raw)) {
        setMsg({ ok: false, text: `الباركود غير مسجل: ${raw}` });
        setQ("");
        return;
      }
      if (results[active]) { choose(results[active]); return; }
      setMsg({ ok: false, text: "لا يوجد صنف مطابق" });
    }
  }

  return (
    <div ref={boxRef} className="space-y-1.5">
      <Input
        value={q}
        autoComplete="off"
        placeholder={placeholder}
        onChange={(e) => { setQ(e.target.value); setActive(0); setMsg(null); }}
        onKeyDown={onKeyDown}
      />
      {msg && (
        <div role="status" className={`text-t-xs font-bold ${msg.ok ? "text-emerald" : "text-ember"}`}>
          {msg.text}
        </div>
      )}
      {q.trim() !== "" && results.length > 0 && (
        <div className="max-h-56 overflow-y-auto rounded-lg border border-line bg-white">
          {results.map((p, idx) => (
            <button
              key={p.id}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => choose(p)}
              className={`block w-full px-3 py-2 text-right text-t-sm ${idx === active ? "bg-ink-3" : "hover:bg-ink-3"}`}
            >
              <div className="font-bold">{productLabel(p)}</div>
              {p.barcode && (
                <div dir="ltr" className="text-right font-mono text-t-xs text-text-dim">{p.barcode}</div>
              )}
            </button>
          ))}
        </div>
      )}
      {q.trim() !== "" && results.length === 0 && (
        <div className="text-t-xs text-text-dim">لا توجد نتائج — اضغط Enter لو ده باركود</div>
      )}
    </div>
  );
}

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
  const topRef = useRef<HTMLDivElement>(null);

  function setLine(i: number, patch: Partial<StockLine>) {
    onChange(items.map((it, idx) => (idx === i ? { ...it, ...patch } : it)));
  }
  function removeLine(i: number) {
    onChange(items.filter((_, idx) => idx !== i));
  }
  function lineFrom(p: Product): Omit<StockLine, "qty"> {
    return {
      productId: p.id,
      productLabel: productLabel(p),
      barcode: p.barcode ?? null,
      ...(withCost ? { unitCost: Number(p.cost_price) || 0 } : {}),
    };
  }

  // إضافة من الخانة العليا: لو الصنف موجود نزوّد كميته، وإلا نملأ أول سطر فاضي أو نضيف سطراً
  function addProduct(p: Product) {
    const idx = items.findIndex((it) => it.productId === p.id);
    if (idx >= 0) {
      setLine(idx, { qty: (items[idx].qty || 0) + 1 });
      return;
    }
    const empty = items.findIndex((it) => !it.productId);
    if (empty >= 0) {
      setLine(empty, { ...lineFrom(p), qty: items[empty].qty || 1 });
      return;
    }
    onChange([...items, { ...lineFrom(p), qty: 1 }]);
  }

  // اختيار صنف لسطر فاضي موجود
  function pickIntoLine(i: number, p: Product) {
    const other = items.findIndex((it, idx) => idx !== i && it.productId === p.id);
    if (other >= 0) {
      onChange(
        items
          .map((it, idx) => (idx === other ? { ...it, qty: (it.qty || 0) + 1 } : it))
          .filter((_, idx) => idx !== i),
      );
      return;
    }
    setLine(i, lineFrom(p));
  }

  function focusTop() {
    topRef.current?.querySelector("input")?.focus();
  }

  const totalQty = items.reduce((s, it) => s + (it.qty || 0), 0);
  const totalCost = items.reduce((s, it) => s + (it.unitCost || 0) * (it.qty || 0), 0);

  return (
    <div className="space-y-2">
      <div ref={topRef}>
        <ProductPicker
          products={products}
          onPick={addProduct}
          placeholder="امسح الباركود أو اكتب اسم الصنف..."
        />
      </div>

      <div className="overflow-x-auto rounded-lg border border-line">
        <table className="w-full border-collapse text-t-sm">
          <thead>
            <tr className="bg-ink-3 text-t-xs font-extrabold text-text-dim">
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
                  ابحث أو امسح الباركود لإضافة أول صنف
                </td>
              </tr>
            ) : items.map((it, i) => {
              const avail = availability?.[it.productId];
              const short = avail !== undefined && it.qty > avail;
              return (
                <tr key={i} className="border-t border-line/70">
                  <td className="px-2 py-1.5">
                    {it.productId ? (
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="font-bold">{it.productLabel}</div>
                          {it.barcode && (
                            <div dir="ltr" className="text-right font-mono text-t-xs text-text-dim">{it.barcode}</div>
                          )}
                        </div>
                        <button
                          type="button"
                          onClick={() => setLine(i, { productId: "", productLabel: "", barcode: null })}
                          className="shrink-0 text-t-xs font-bold text-petrol hover:underline"
                        >
                          تغيير
                        </button>
                      </div>
                    ) : (
                      <ProductPicker
                        products={products}
                        onPick={(p) => pickIntoLine(i, p)}
                        placeholder="ابحث بالاسم أو الباركود..."
                      />
                    )}
                    {avail !== undefined && it.productId && (
                      <div className={`mt-1 text-t-xs ${short ? "font-bold text-ember" : "text-text-dim"}`}>
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
                            className="rounded-md px-2 py-1 text-text-dim hover:bg-ember-bg hover:text-ember">
                      <MIcon name="delete" className="!text-[16px]" />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button variant="ghost" onClick={focusTop}>+ إضافة صنف</Button>
        <div className="text-t-sm text-text-dim">
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
