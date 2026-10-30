"use client";
// AddNoteModal — زر «+ إضافة ملاحظة» داخل شاشة أوامر العمل (بنود 1/25)
// التدفق السريع: نوع → منتج (اختياري) → وصف → صورة → إرسال
// كل بيانات العميل/السيارة تتسحب تلقائياً من workOrderId — صفر إدخال يدوي
//
// طريقة التركيب في prepare/page.tsx:
//   import AddNoteModal from "@/components/AddNoteModal";
//   const [noteOpen, setNoteOpen] = useState(false);
//   <Button variant="ghost" onClick={() => setNoteOpen(true)}>+ إضافة ملاحظة</Button>
//   {noteOpen && active && (
//     <AddNoteModal workOrderId={active.id} onClose={() => setNoteOpen(false)} />
//   )}
import { useEffect, useRef, useState } from "react";
import { api, authHeaders } from "@/lib/api";
import { Button, Card, Input } from "@/components/ui";
import { MIcon } from "@/components/m-icon";

type Product = { id: string; name: string; spec?: string | null; barcode?: string | null };

const NOTE_TYPES: { key: string; label: string; icon: string }[] = [
  { key: "out_of_stock",      label: "منتج غير متوفر",     icon: "inventory_2" },
  { key: "low_stock",         label: "كمية غير كافية",     icon: "warning" },
  { key: "needs_replacement", label: "منتج يحتاج تغيير",   icon: "autorenew" },
  { key: "part_replacement",  label: "قطعة تحتاج تغيير",   icon: "build" },
  { key: "technical",         label: "مشكلة فنية",         icon: "settings" },
  { key: "car_note",          label: "ملاحظة على السيارة", icon: "directions_car" },
  { key: "extra_service",     label: "خدمة إضافية مقترحة", icon: "add_circle" },
  { key: "customer_declined", label: "العميل رفض خدمة",    icon: "block" },
  { key: "operational",       label: "مشكلة تشغيلية",      icon: "factory" },
  { key: "other",             label: "أخرى",               icon: "edit_note" },
];

export default function AddNoteModal({ workOrderId, onClose }:
  { workOrderId: string; onClose: () => void }) {

  const [type, setType] = useState("");
  const [description, setDescription] = useState("");
  const [qty, setQty] = useState("1");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [ok, setOk] = useState("");

  // بحث المنتج بالاسم/الباركود (بند 1)
  const [prodQ, setProdQ] = useState("");
  const [products, setProducts] = useState<Product[]>([]);
  const [product, setProduct] = useState<Product | null>(null);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    const q = prodQ.trim();
    if (q.length < 2) { setProducts([]); return; }
    searchTimer.current = setTimeout(async () => {
      try {
        const all = await api<Product[]>(`/products?search=${encodeURIComponent(q)}`);
        setProducts(all.slice(0, 8));
      } catch { setProducts([]); }
    }, 300);
  }, [prodQ]);

  const needsProduct = ["out_of_stock", "low_stock", "needs_replacement", "part_replacement"].includes(type);

  async function submit() {
    setErr("");
    if (!type) { setErr("اختر نوع الملاحظة"); return; }
    if (!description.trim() && !product) { setErr("اكتب وصف الملاحظة"); return; }
    setBusy(true);
    try {
      // 1) إنشاء الملاحظة — الكمية المتوفرة يجلبها السيرفر من المخزون تلقائياً
      const r = await api<{ id: string; noteNumber: string; availableQuantity: number | null }>(
        "/service-notes", {
          method: "POST",
          body: JSON.stringify({
            workOrderId, type,
            description: description.trim() || (product ? `${product.name} — يحتاج متابعة` : ""),
            productId: product?.id ?? null,
            requiredQuantity: needsProduct ? Math.max(1, Number(qty) || 1) : null,
          }),
        });

      // 2) رفع الصورة إن وجدت (بند 7)
      if (file) {
        const fd = new FormData();
        fd.append("file", file);
        const res = await fetch(`/api/service-notes/${r.id}/attachments`, {
          method: "POST",
          headers: authHeaders(),
          body: fd,
        });
        if (!res.ok) throw new Error("الملاحظة سُجلت لكن رفع الصورة فشل");
      }

      setOk(`تم تسجيل الملاحظة ${r.noteNumber}` +
        (r.availableQuantity != null ? ` — المتوفر بالمخزون: ${r.availableQuantity}` : ""));
      setTimeout(onClose, 1600);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "تعذر الحفظ");
    } finally { setBusy(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-3" onClick={onClose}>
      <Card className="max-h-[92vh] w-full max-w-xl overflow-y-auto">
        <div onClick={(e) => e.stopPropagation()} className="space-y-3">
          <div className="text-t-lg font-black">+ إضافة ملاحظة</div>

          {/* نوع الملاحظة — أزرار كبيرة تناسب التابلت (بند 26) */}
          <div className="grid grid-cols-2 gap-2">
            {NOTE_TYPES.map((t) => (
              <button key={t.key}
                className={`rounded-card border px-3 py-3 text-right text-t-sm font-bold transition-colors ${
                  type === t.key ? "border-petrol bg-petrol/10 text-petrol" : "border-line bg-ink-2 hover:border-petrol/50"}`}
                onClick={() => setType(t.key)}>
                <MIcon name={t.icon} className="!text-[16px]" /> {t.label}
              </button>
            ))}
          </div>

          {/* المنتج/القطعة — بحث اسم/باركود (بند 1) */}
          {needsProduct && (
            <div>
              {product ? (
                <div className="flex items-center justify-between rounded-card border border-petrol bg-petrol/5 px-3 py-2.5">
                  <span className="text-t-md font-bold">
                    {product.name} {product.spec ?? ""}
                  </span>
                  <button className="text-t-sm text-ember" onClick={() => setProduct(null)}>تغيير</button>
                </div>
              ) : (
                <>
                  <Input placeholder="ابحث عن المنتج بالاسم أو الباركود…"
                    value={prodQ} onChange={(e) => setProdQ(e.target.value)} />
                  {products.length > 0 && (
                    <div className="mt-1 overflow-hidden rounded-card border border-line">
                      {products.map((p) => (
                        <button key={p.id}
                          className="block w-full border-b border-line/50 bg-ink-2 px-3 py-2 text-right text-t-sm last:border-0 hover:bg-ink-3"
                          onClick={() => { setProduct(p); setProducts([]); setProdQ(""); }}>
                          {p.name} {p.spec ?? ""} {p.barcode ? `· ${p.barcode}` : ""}
                        </button>
                      ))}
                    </div>
                  )}
                </>
              )}
              <div className="mt-2 flex items-center gap-2">
                <span className="text-t-sm text-text-dim">الكمية المطلوبة</span>
                <Input className="!w-20 text-center tnum" inputMode="numeric" value={qty}
                  onChange={(e) => setQty(e.target.value.replace(/\D/g, ""))} />
                <span className="text-t-xs text-text-dim">— المتوفر يُجلب من المخزون تلقائياً</span>
              </div>
            </div>
          )}

          {/* الوصف */}
          <textarea
            className="h-24 w-full rounded-lg border border-line bg-ink-2 p-3 text-t-md placeholder:text-text-dim/60 focus:border-petrol focus:outline-none"
            placeholder='وصف الملاحظة — مثال: "فلتر الهواء متسخ ويحتاج تغيير، والقطعة غير متوفرة حالياً"'
            value={description} onChange={(e) => setDescription(e.target.value)} />

          {/* الصورة — كاميرا مباشرة أو ملف (بند 7) */}
          <label className="flex cursor-pointer items-center justify-between rounded-lg border border-dashed border-line px-3 py-3 text-t-sm hover:border-petrol">
            <span>{file ? `${file.name}` : "التقاط / إرفاق صورة (اختياري)"}</span>
            {file && <button className="text-ember" onClick={(e) => { e.preventDefault(); setFile(null); }}>حذف</button>}
            <input type="file" accept="image/*,video/*" capture="environment" className="hidden"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          </label>

          {err && <p className="rounded-lg bg-ember-bg px-3 py-2 text-center text-t-sm font-bold text-ember">{err}</p>}
          {ok && <p className="rounded-lg bg-emerald-bg px-3 py-2 text-center text-t-sm font-bold text-emerald">{ok}</p>}

          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={onClose}>إلغاء</Button>
            <Button disabled={busy || !!ok} onClick={submit}>
              {busy ? "جارٍ الحفظ…" : "حفظ وإرسال"}
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}

