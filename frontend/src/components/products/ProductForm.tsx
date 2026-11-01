"use client";
// ProductForm — إضافة/تعديل صنف بنفس عقد POST/PUT /products الحالي بالحرف (لا حقول جديدة تُرسل).
// السعر = قبل الضريبة؛ السعر شامل الضريبة يُحسب في قاعدة البيانات (لا يُحسب هنا).
import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { Button, ErrorNote, Field, Input, Modal, Select, Switch } from "@/components/ui";
import { appConfirm } from "@/components/dialog";
import { ComboSelect } from "@/components/ComboSelect";
import { MIcon } from "@/components/m-icon";
import { barcodeSvg } from "@/lib/code128";
import { fmtCurrency } from "@/lib/customers/format";

type Editing = { id: string; name: string; spec: string | null; category: string; unit: string | null; barcode: string | null; sku: string | null; price: number; cost: number | null; minQty: number;
  serviceIntervalKm?: number | null; isService: boolean; isOil: boolean; isOilFilter: boolean; brand: string | null; hasImage?: boolean; oilType?: string | null };

const OIL_TYPES: Record<string, string> = { engine: "زيت ماكينة", differential: "زيت دفرنس", steering: "زيت دركسيون", brake: "زيت فرامل", gearbox: "زيت قير", transfer: "زيت دبل" };
const UNITS = ["قطعة", "لتر", "علبة", "كرتون", "جالون", "كيلو", "متر", "طقم"];
const EMPTY = { category: "", name: "", spec: "", unit: "قطعة", barcode: "", sku: "", price: "", costPrice: "", minQty: "0", serviceIntervalKm: "", isService: false, isOil: false, isOilFilter: false, oilBrand: "", oilType: "" };
type Form = typeof EMPTY;

function toForm(p: Editing): Form {
  return { category: p.category || "", name: p.name, spec: p.spec || "", unit: p.unit || "قطعة", barcode: p.barcode || "", sku: p.sku || "", price: String(p.price ?? ""),
    costPrice: p.cost != null ? String(p.cost) : "", minQty: String(p.minQty ?? 0), serviceIntervalKm: p.serviceIntervalKm == null ? "" : String(p.serviceIntervalKm),
    isService: p.isService, isOil: p.isOil, isOilFilter: p.isOilFilter, oilBrand: p.brand || "", oilType: p.oilType || "" };
}

function resizeToBase64(file: File, maxSide: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image(); const url = URL.createObjectURL(file);
    img.onload = () => {
      const k = Math.min(1, maxSide / Math.max(img.width, img.height));
      const c = document.createElement("canvas"); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url);
      resolve(c.toDataURL("image/jpeg", 0.85).split(",")[1]);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("تعذر قراءة الصورة")); }; img.src = url;
  });
}

const Section = ({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) => (
  <fieldset className="space-y-2.5 rounded-card border border-line p-3.5">
    <legend className="px-1.5 text-t-sm font-extrabold">{title}{hint && <span className="ms-2 text-t-xs font-normal text-text-dim">{hint}</span>}</legend>{children}
  </fieldset>
);

export function ProductForm({ open, product, categories, canCost, onClose, onSaved }: {
  open: boolean; product?: Editing | null; categories: string[]; canCost: boolean; onClose: () => void; onSaved: (id: string) => void;
}) {
  const initial = useMemo(() => (product ? toForm(product) : EMPTY), [product]);
  const [f, setF] = useState<Form>(initial);
  const [img, setImg] = useState<string | null | undefined>(undefined);   // undefined = بدون تغيير
  const [brands, setBrands] = useState<{ id: string; name: string }[]>([]);
  const [err, setErr] = useState(""); const [busy, setBusy] = useState(false);
  const [touched, setTouched] = useState(false); const [ver, setVer] = useState(0);
  const dirty = JSON.stringify(f) !== JSON.stringify(initial) || img !== undefined;
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((p) => ({ ...p, [k]: v }));

  useEffect(() => { if (open) { setF(initial); setImg(undefined); setErr(""); setTouched(false); setVer((x) => x + 1); } }, [open, initial]);
  useEffect(() => { if (open) api<{ id: string; name: string }[]>("/products/oil-brands").then(setBrands).catch(() => {}); }, [open]);

  const errors: Partial<Record<keyof Form, string>> = {};
  if (!f.name.trim()) errors.name = "اسم الصنف مطلوب";
  if (f.price === "" || !(Number(f.price) >= 0)) errors.price = "أدخل سعر بيع صحيحاً";
  if (f.costPrice !== "" && !(Number(f.costPrice) >= 0)) errors.costPrice = "تكلفة غير صحيحة";
  if (!(Number(f.minQty || 0) >= 0)) errors.minQty = "قيمة غير صحيحة";
  const cost = Number(f.costPrice), price = Number(f.price);
  const margin = price > 0 && cost > 0 ? ((price - cost) / price) * 100 : null;
  const bc = f.barcode.trim();

  async function close() {
    if (dirty && !busy && !(await appConfirm("لديك تغييرات غير محفوظة. هل تريد إغلاق النموذج وتجاهلها؟"))) return;
    onClose();
  }
  async function save() {
    setTouched(true);
    if (Object.keys(errors).length) return;
    setErr(""); setBusy(true);
    // الحقول الفارغة تُرسل null لا "" — الباركود/SKU أعمدة فريدة
    const body: Record<string, unknown> = {
      category: f.category.trim(), name: f.name.trim(), spec: f.spec.trim(), unit: f.unit, barcode: bc || null, sku: f.sku.trim() || null,
      price: Number(f.price), minQty: Number(f.minQty || 0), serviceIntervalKm: f.serviceIntervalKm === "" ? null : Number(f.serviceIntervalKm),
      isService: f.isService, isOil: f.isOil, isOilFilter: f.isOilFilter, oilBrand: f.oilBrand || null, oilType: f.oilType || null,
    };
    if (canCost && (f.costPrice !== "" || product)) body.costPrice = f.costPrice === "" ? 0 : Number(f.costPrice);
    try {
      const saved = product
        ? await api<{ id: string }>(`/products/${product.id}`, { method: "PUT", body: JSON.stringify(body) })
        : await api<{ id: string }>("/products", { method: "POST", body: JSON.stringify(body) });
      if (img !== undefined) await api(`/products/${saved.id}/image`, { method: "PUT", body: JSON.stringify({ imageBase64: img }) });
      onSaved(saved.id);
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  }
  const shown = (k: keyof Form) => (touched ? errors[k] : undefined);
  const Err = ({ m }: { m?: string }) => (m ? <p role="alert" className="mt-1 text-t-xs font-bold text-ember">{m}</p> : null);

  return (
    <Modal open={open} size="lg" onClose={close} title={product ? "تعديل الصنف" : "إضافة صنف"}>
      <form className="space-y-3" noValidate onSubmit={(e) => { e.preventDefault(); save(); }}>
        <Section title="المعلومات الأساسية">
          <div className="grid gap-2.5 sm:grid-cols-3">
            <div className="sm:col-span-2"><Field label="اسم الصنف *"><Input value={f.name} autoFocus aria-invalid={!!shown("name")} onChange={(e) => set("name", e.target.value)} /></Field><Err m={shown("name")} /></div>
            <Field label="المواصفة / اللزوجة"><Input value={f.spec} onChange={(e) => set("spec", e.target.value)} placeholder="مثال: 5W-30" /></Field>
            <Field label="الفئة" hint="فارغة = تُستنتج من الاسم"><ComboSelect key={`cat${ver}`} value={f.category} options={categories} placeholder="اسم الفئة" onChange={(v) => set("category", v)} /></Field>
            <Field label="الوحدة"><ComboSelect key={`unit${ver}`} value={f.unit} options={UNITS} placeholder="الوحدة" onChange={(v) => set("unit", v || "قطعة")} /></Field>
            <label className="flex items-center justify-between gap-2 rounded-lg border border-line bg-ink-3 px-3 py-2 sm:mt-6">
              <span className="text-t-sm font-bold">صنف خدمة (بلا مخزون)</span><Switch checked={f.isService} onChange={(v) => set("isService", v)} />
            </label>
          </div>
        </Section>

        <Section title="الأسعار" hint="السعر شامل الضريبة يُحسب تلقائياً في قاعدة البيانات">
          <div className="grid gap-2.5 sm:grid-cols-3">
            <div><Field label="سعر البيع (قبل الضريبة) *"><Input type="number" min={0} step="0.01" className="tnum" value={f.price} aria-invalid={!!shown("price")} onChange={(e) => set("price", e.target.value)} /></Field><Err m={shown("price")} /></div>
            {canCost && <div><Field label="سعر التكلفة"><Input type="number" min={0} step="0.01" className="tnum" value={f.costPrice} onChange={(e) => set("costPrice", e.target.value)} /></Field><Err m={shown("costPrice")} /></div>}
            {margin != null && canCost && (
              <div className="rounded-lg bg-ink-3 px-3 py-2 text-t-sm"><div className="text-t-xs text-text-dim">هامش السعر الحالي</div><b className="tnum">{fmtCurrency(price - cost, 2)} · {margin.toFixed(1)}%</b></div>)}
          </div>
        </Section>

        <Section title="التعريف والباركود">
          <div className="grid gap-2.5 sm:grid-cols-2">
            <Field label="الباركود"><Input value={f.barcode} dir="ltr" className="tnum text-end" onChange={(e) => set("barcode", e.target.value)} /></Field>
            <Field label="رمز SKU" hint="فارغ = يُولَّد تلقائياً"><Input value={f.sku} dir="ltr" className="tnum text-end" onChange={(e) => set("sku", e.target.value)} /></Field>
          </div>
          {bc && barcodeSvg(bc) && <div className="rounded-lg border border-line bg-ink-2 p-2 text-center" dangerouslySetInnerHTML={{ __html: barcodeSvg(bc, { height: 36 }) }} />}
        </Section>

        <Section title="إعدادات المخزون" hint="لا تغيّر الأرصدة — الأرصدة تتغير فقط عبر الاستلام والتحويل والجرد">
          <div className="grid gap-2.5 sm:grid-cols-2">
            <div><Field label="حد الانخفاض (الحد الأدنى)"><Input type="number" min={0} className="tnum" value={f.minQty} onChange={(e) => set("minQty", e.target.value)} /></Field><Err m={shown("minQty")} /></div>
            <Field label="فترة التغيير بالكيلومتر" hint="للزيوت — تُحسب بها الصيانة القادمة"><Input type="number" min={0} className="tnum" value={f.serviceIntervalKm} onChange={(e) => set("serviceIntervalKm", e.target.value)} /></Field>
          </div>
        </Section>

        <Section title="تصنيف الزيوت وبوابة العميل">
          <div className="grid gap-2.5 sm:grid-cols-2">
            <label className="flex items-center justify-between gap-2 rounded-lg border border-line bg-ink-3 px-3 py-2"><span className="text-t-sm font-bold">صنف زيت</span><Switch checked={f.isOil} onChange={(v) => set("isOil", v)} /></label>
            <label className="flex items-center justify-between gap-2 rounded-lg border border-line bg-ink-3 px-3 py-2"><span className="text-t-sm font-bold">فلتر زيت</span><Switch checked={f.isOilFilter} onChange={(v) => set("isOilFilter", v)} /></label>
            {f.isOil && <Field label="شركة الزيت"><Select value={f.oilBrand} onChange={(e) => set("oilBrand", e.target.value)}><option value="">— بدون شركة —</option>{brands.map((b) => <option key={b.id} value={b.name}>{b.name}</option>)}</Select></Field>}
            {(f.isOil || f.isService) && <Field label={f.isService ? "نوع الزيت المطلوب لهذه الخدمة" : "نوع الزيت"}><Select value={f.oilType} onChange={(e) => set("oilType", e.target.value)}><option value="">— غير مصنّف —</option>{Object.entries(OIL_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>}
          </div>
        </Section>

        <Section title="صورة الصنف">
          <div className="flex items-center gap-3">
            {img ? /* eslint-disable-next-line @next/next/no-img-element */ <img src={`data:image/jpeg;base64,${img}`} alt="" className="h-16 w-16 rounded-lg border border-line bg-ink-2 object-contain" />
              : product?.hasImage && img === undefined ? /* eslint-disable-next-line @next/next/no-img-element */ <img src={`/api/products/public/product-image/${product.id}`} alt="" className="h-16 w-16 rounded-lg border border-line bg-ink-2 object-contain" />
              : <span className="grid h-16 w-16 place-items-center rounded-lg border border-dashed border-line text-text-dim"><MIcon name="image" className="!text-[26px]" /></span>}
            <label className="cursor-pointer rounded-lg border border-line px-3 py-2 text-t-sm font-bold hover:border-petrol">{product?.hasImage || img ? "استبدال" : "رفع صورة"}
              <input type="file" accept="image/*" hidden onChange={async (e) => { const file = e.target.files?.[0]; e.target.value = ""; if (!file) return; try { setImg(await resizeToBase64(file, 400)); } catch (er) { setErr(er instanceof Error ? er.message : String(er)); } }} /></label>
            {(img || (product?.hasImage && img === undefined)) && <button type="button" onClick={() => setImg(null)} className="text-t-sm font-bold text-ember hover:underline">إزالة</button>}
          </div>
        </Section>

        <ErrorNote msg={err} />
        <div className="sticky bottom-0 -mx-1 flex items-center justify-between gap-2 border-t border-line bg-ink-2 px-1 pt-3">
          <span className="text-t-xs text-text-dim">{dirty ? "تغييرات غير محفوظة" : "* حقول مطلوبة"}</span>
          <div className="flex gap-2"><Button type="button" variant="ghost" onClick={close}>إلغاء</Button><Button type="submit" loading={busy}>{busy ? "جارِ الحفظ..." : "حفظ"}</Button></div>
        </div>
      </form>
    </Modal>
  );
}
