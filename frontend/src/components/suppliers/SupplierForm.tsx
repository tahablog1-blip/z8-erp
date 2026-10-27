"use client";
// نموذج إضافة/تعديل مورد — الحقول المدعومة فعلاً في النظام فقط (لا كود/بريد/سجل تجاري/IBAN لأنها غير موجودة في قاعدة البيانات).
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Button, ErrorNote, Field, Input, Modal, Select, Textarea } from "@/components/ui";

export type SupplierFormValues = { name: string; phone: string; vatNumber: string; address: string; paymentTermsDays: number; category: string; rating: number; ratingNote: string };
export const EMPTY_SUPPLIER: SupplierFormValues = { name: "", phone: "", vatNumber: "", address: "", paymentTermsDays: 0, category: "", rating: 0, ratingNote: "" };

export function SupplierForm({ open, editId, initial, categories, onClose, onSaved }: {
  open: boolean; editId: string | null; initial: SupplierFormValues; categories: string[]; onClose: () => void; onSaved: () => void;
}) {
  const [f, setF] = useState(initial);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) { setF(initial); setErr(""); } }, [open, initial]);
  const set = <K extends keyof SupplierFormValues>(k: K, v: SupplierFormValues[K]) => setF((o) => ({ ...o, [k]: v }));
  const vatBad = f.vatNumber.trim() !== "" && !/^\d{15}$/.test(f.vatNumber.trim());

  async function save() {
    if (!f.name.trim()) { setErr("اسم المورد مطلوب."); return; }
    setErr(""); setBusy(true);
    try {
      const body = JSON.stringify({ ...f, name: f.name.trim(), category: f.category.trim() || null, rating: f.rating > 0 ? f.rating : null, ratingNote: f.ratingNote.trim() || null });
      if (editId) await api(`/suppliers/${editId}`, { method: "PUT", body }); else await api("/suppliers", { method: "POST", body });
      onSaved();
    } catch (e) { setErr(e instanceof Error ? e.message : "تعذر الحفظ"); } finally { setBusy(false); }
  }
  return (
    <Modal open={open} title={editId ? "تعديل مورد" : "إضافة مورد"} onClose={onClose} size="lg">
      <div className="space-y-4">
        <fieldset className="space-y-3"><legend className="text-t-sm font-black">البيانات الأساسية</legend>
          <Field label="اسم المورد"><Input value={f.name} maxLength={200} onChange={(e) => set("name", e.target.value)} autoFocus /></Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="التصنيف" hint="حر: زيوت، قطع غيار، خدمات…"><Input value={f.category} list="sup-cats" onChange={(e) => set("category", e.target.value)} /><datalist id="sup-cats">{categories.map((c) => <option key={c} value={c} />)}</datalist></Field>
            <Field label="مدة السداد الافتراضية (أيام)"><Input type="number" min={0} value={f.paymentTermsDays} onChange={(e) => set("paymentTermsDays", Math.max(0, Number(e.target.value) || 0))} /></Field>
          </div>
        </fieldset>
        <fieldset className="space-y-3"><legend className="text-t-sm font-black">بيانات الاتصال والعنوان</legend>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="الجوال / الهاتف"><Input dir="ltr" value={f.phone} onChange={(e) => set("phone", e.target.value)} /></Field>
            <Field label="الرقم الضريبي (VAT)" hint={vatBad ? "الرقم الضريبي السعودي 15 رقماً" : undefined}><Input dir="ltr" inputMode="numeric" value={f.vatNumber} aria-invalid={vatBad} onChange={(e) => set("vatNumber", e.target.value)} /></Field>
          </div>
          <Field label="العنوان"><Textarea rows={2} value={f.address} onChange={(e) => set("address", e.target.value)} /></Field>
        </fieldset>
        <fieldset className="space-y-3"><legend className="text-t-sm font-black">التقييم اليدوي</legend>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="التقييم (من 5)"><Select value={String(f.rating)} onChange={(e) => set("rating", Number(e.target.value))}><option value="0">بدون تقييم</option>{[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n} / 5</option>)}</Select></Field>
            <Field label="ملاحظة التقييم"><Input value={f.ratingNote} onChange={(e) => set("ratingNote", e.target.value)} /></Field>
          </div>
        </fieldset>
        <p className="text-t-xs text-text-dim">الرصيد يُحسب من دفتر المورد (فواتير الشراء الآجلة وسندات الصرف) ولا يُعدَّل من هنا.</p>
        <ErrorNote msg={err} />
        <div className="flex gap-2"><Button onClick={save} loading={busy} disabled={busy}>{editId ? "حفظ التعديلات" : "إضافة المورد"}</Button><Button variant="outline" onClick={onClose}>إلغاء</Button></div>
      </div>
    </Modal>
  );
}
