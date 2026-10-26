"use client";
// CustomerForm — إضافة/تعديل عميل: أقسام واضحة، تحقق فوري، كشف تكرار (جوال/بريد/ضريبي)، تحذير تغييرات غير محفوظة.
// نفس عقد POST/PUT /customers الحالي بالحرف (لا حقول جديدة تُرسل).
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { Button, ErrorNote, Field, Input, Modal, Select, Textarea } from "@/components/ui";
import { appConfirm } from "@/components/dialog";
import { MIcon } from "@/components/m-icon";
import { useCx } from "@/lib/customers/i18n";
import type { DupMatch } from "@/lib/customers/types";
import type { Customer } from "@/modules/customers/types";
import type { PriceList } from "@/modules/price-lists/types";

const EMPTY = {
  name: "", customerType: "individual" as "individual" | "company", phone: "", email: "", vatNumber: "", crNumber: "", address: "",
  buildingNo: "", street: "", district: "", city: "", postalCode: "", additionalNo: "",
  creditLimit: "", priceListId: "", contractDiscountPct: "", contractValidFrom: "", contractValidUntil: "", contractNotes: "",
};
type Form = typeof EMPTY;

function fromCustomer(c: Customer): Form {
  return {
    name: c.name, customerType: c.customer_type, phone: c.phone || "", email: c.email || "", vatNumber: c.vat_number || "", crNumber: c.cr_number || "",
    address: c.address || "", buildingNo: c.building_no || "", street: c.street || "", district: c.district || "", city: c.city || "",
    postalCode: c.postal_code || "", additionalNo: c.additional_no || "",
    creditLimit: c.credit_limit != null ? String(c.credit_limit) : "", priceListId: c.price_list_id || "",
    contractDiscountPct: c.contract_discount_pct != null ? String(c.contract_discount_pct) : "",
    contractValidFrom: c.contract_valid_from || "", contractValidUntil: c.contract_valid_until || "", contractNotes: c.contract_notes || "",
  };
}

function validate(f: Form): Partial<Record<keyof Form, string>> {
  const e: Partial<Record<keyof Form, string>> = {};
  if (!f.name.trim()) e.name = "الاسم مطلوب";
  const ph = f.phone.replace(/\D/g, "");
  if (f.phone.trim() && !/^(05\d{8}|9665\d{8}|5\d{8})$/.test(ph)) e.phone = "رقم جوال سعودي غير صحيح (05XXXXXXXX)";
  if (f.email.trim() && !/^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(f.email.trim())) e.email = "بريد إلكتروني غير صحيح";
  if (f.vatNumber.trim() && !/^\d{15}$/.test(f.vatNumber.trim())) e.vatNumber = "الرقم الضريبي 15 رقماً";
  if (f.customerType === "company" && !f.vatNumber.trim()) e.vatNumber = undefined;   // تنبيه فقط (hint) — لا يمنع الحفظ كما في السلوك الحالي
  if (f.creditLimit.trim() && !(Number(f.creditLimit) >= 0)) e.creditLimit = "قيمة غير صحيحة";
  if (f.contractDiscountPct.trim() && !(Number(f.contractDiscountPct) >= 0 && Number(f.contractDiscountPct) <= 100)) e.contractDiscountPct = "من 0 إلى 100";
  return e;
}

const Section = ({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) => (
  <fieldset className="space-y-2.5 rounded-xl border border-line p-3.5">
    <legend className="px-1.5 text-t-sm font-extrabold">{title}{hint && <span className="ms-2 text-t-xs font-normal text-text-dim">{hint}</span>}</legend>
    {children}
  </fieldset>
);
const Err = ({ m }: { m?: string }) => (m ? <p role="alert" className="mt-1 text-t-xs font-bold text-ember">{m}</p> : null);

export function CustomerForm({ open, customer, onClose, onSaved }: {
  open: boolean; customer?: Customer | null; onClose: () => void; onSaved: (c: Customer) => void;
}) {
  const { isEn } = useCx();
  const initial = useMemo(() => (customer ? fromCustomer(customer) : EMPTY), [customer]);
  const [f, setF] = useState<Form>(initial);
  const [touched, setTouched] = useState<Partial<Record<keyof Form, boolean>>>({});
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [dups, setDups] = useState<DupMatch[]>([]);
  const [priceLists, setPriceLists] = useState<PriceList[]>([]);
  const dirty = JSON.stringify(f) !== JSON.stringify(initial);
  const errors = validate(f);
  const showErr = (k: keyof Form) => (touched[k] ? errors[k] : undefined);
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((p) => ({ ...p, [k]: v }));
  const blur = (k: keyof Form) => () => setTouched((t) => ({ ...t, [k]: true }));

  useEffect(() => { if (open) { setF(initial); setTouched({}); setErr(""); setDups([]); } }, [open, initial]);
  useEffect(() => { if (open) api<PriceList[]>("/price-lists").then(setPriceLists).catch(() => {}); }, [open]);

  // كشف التكرار (بعد توقف الكتابة 500ms) — على الجوال/البريد/الضريبي/الاسم
  const seq = useRef(0);
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(async () => {
      const qs = new URLSearchParams();
      if (!errors.phone && f.phone.trim()) qs.set("phone", f.phone.trim());
      if (!errors.email && f.email.trim()) qs.set("email", f.email.trim());
      if (!errors.vatNumber && f.vatNumber.trim()) qs.set("vat", f.vatNumber.trim());
      if (f.name.trim().length >= 3) qs.set("name", f.name.trim());
      if (customer) qs.set("excludeId", customer.id);
      if (![...qs.keys()].some((k) => k !== "excludeId")) { setDups([]); return; }
      const my = ++seq.current;
      try { const r = await api<DupMatch[]>(`/customers/check-duplicate?${qs}`); if (my === seq.current) setDups(r); } catch { /* */ }
    }, 500);
    return () => clearTimeout(t);
  }, [open, f.phone, f.email, f.vatNumber, f.name, customer]);   // eslint-disable-line react-hooks/exhaustive-deps

  async function close() {
    if (dirty && !busy && !(await appConfirm(isEn ? "Discard unsaved changes?" : "لديك تغييرات غير محفوظة. هل تريد إغلاق النموذج وتجاهلها؟"))) return;
    onClose();
  }

  async function save() {
    setTouched({ name: true, phone: true, email: true, vatNumber: true, creditLimit: true, contractDiscountPct: true });
    if (Object.values(errors).some(Boolean)) return;
    setErr(""); setBusy(true);
    const body = {
      ...f, name: f.name.trim(), email: f.email.trim() || null,
      creditLimit: f.creditLimit.trim() === "" ? null : Number(f.creditLimit), priceListId: f.priceListId || null,
      contractDiscountPct: f.contractDiscountPct.trim() === "" ? null : Number(f.contractDiscountPct),
      contractValidFrom: f.contractValidFrom || null, contractValidUntil: f.contractValidUntil || null, contractNotes: f.contractNotes.trim() || null,
    };
    try {
      const saved = customer
        ? await api<Customer>(`/customers/${customer.id}`, { method: "PUT", body: JSON.stringify(body) })
        : await api<Customer>("/customers", { method: "POST", body: JSON.stringify(body) });
      onSaved(saved);
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  }

  const isCompany = f.customerType === "company";
  return (
    <Modal open={open} size="lg" onClose={close} title={customer ? "تعديل العميل" : "إضافة عميل"}>
      <form className="space-y-3" noValidate onSubmit={(e) => { e.preventDefault(); save(); }}>
        {dups.length > 0 && (
          <div role="alert" className="rounded-xl border border-brass/40 bg-brass-bg p-3 text-t-sm">
            <div className="mb-1.5 flex items-center gap-1.5 font-extrabold text-brass"><MIcon name="warning" className="!text-[18px]" />يوجد عميل مشابه بالفعل، هل تريد فتحه بدل إنشاء عميل جديد؟</div>
            <ul className="space-y-1">
              {dups.map((d) => (
                <li key={d.id} className="flex flex-wrap items-center justify-between gap-2">
                  <span><b>{d.name}</b> <span className="tnum text-text-dim">{d.no}{d.phone ? ` · ${d.phone}` : ""}</span>
                    <span className="ms-1 text-t-xs text-text-dim">({d.reasons.map((r) => ({ phone: "الجوال", email: "البريد", vat: "الرقم الضريبي", name: "الاسم" } as Record<string, string>)[r] ?? r).join("، ")})</span></span>
                  <Link href={`/customers/${d.id}`} className="font-bold text-petrol underline">فتح الملف</Link>
                </li>
              ))}
            </ul>
          </div>
        )}

        <Section title="البيانات الأساسية">
          <div className="grid gap-2.5 sm:grid-cols-3">
            <Field label="نوع العميل *">
              <Select value={f.customerType} onChange={(e) => set("customerType", e.target.value as Form["customerType"])}>
                <option value="individual">فرد</option><option value="company">شركة</option>
              </Select>
            </Field>
            <div className="sm:col-span-2">
              <Field label={isCompany ? "اسم الشركة *" : "الاسم *"}>
                <Input value={f.name} autoFocus aria-invalid={!!showErr("name")} onBlur={blur("name")} onChange={(e) => set("name", e.target.value)} />
              </Field><Err m={showErr("name")} />
            </div>
            <div>
              <Field label="رقم الجوال"><Input value={f.phone} inputMode="tel" dir="ltr" className="tnum text-end" placeholder="05XXXXXXXX" aria-invalid={!!showErr("phone")} onBlur={blur("phone")} onChange={(e) => set("phone", e.target.value)} /></Field>
              <Err m={showErr("phone")} />
            </div>
            <div className="sm:col-span-2">
              <Field label="البريد الإلكتروني"><Input type="email" dir="ltr" className="text-end" value={f.email} aria-invalid={!!showErr("email")} onBlur={blur("email")} onChange={(e) => set("email", e.target.value)} /></Field>
              <Err m={showErr("email")} />
            </div>
          </div>
        </Section>

        {isCompany && (
          <Section title="بيانات المنشأة" hint="مطلوبة للفاتورة الضريبية القياسية">
            <div className="grid gap-2.5 sm:grid-cols-2">
              <div>
                <Field label="الرقم الضريبي"><Input value={f.vatNumber} dir="ltr" className="tnum text-end" inputMode="numeric" maxLength={15} aria-invalid={!!showErr("vatNumber")} onBlur={blur("vatNumber")} onChange={(e) => set("vatNumber", e.target.value)} /></Field>
                <Err m={showErr("vatNumber")} />
              </div>
              <Field label="السجل التجاري"><Input value={f.crNumber} dir="ltr" className="tnum text-end" onChange={(e) => set("crNumber", e.target.value)} /></Field>
            </div>
            <p className="text-t-xs font-bold text-text-dim">العنوان الوطني</p>
            <div className="grid gap-2.5 sm:grid-cols-3">
              <Field label="رقم المبنى"><Input value={f.buildingNo} className="tnum" onChange={(e) => set("buildingNo", e.target.value)} /></Field>
              <Field label="الشارع"><Input value={f.street} onChange={(e) => set("street", e.target.value)} /></Field>
              <Field label="الحي"><Input value={f.district} onChange={(e) => set("district", e.target.value)} /></Field>
              <Field label="المدينة"><Input value={f.city} onChange={(e) => set("city", e.target.value)} /></Field>
              <Field label="الرمز البريدي"><Input value={f.postalCode} className="tnum" onChange={(e) => set("postalCode", e.target.value)} /></Field>
              <Field label="الرقم الإضافي"><Input value={f.additionalNo} className="tnum" onChange={(e) => set("additionalNo", e.target.value)} /></Field>
            </div>
          </Section>
        )}

        <Section title="البيانات المالية">
          <div className="grid gap-2.5 sm:grid-cols-2">
            <div>
              <Field label="حد الائتمان (ر.س)" hint="فارغ = بلا حد — البيع الآجل غير مقيّد"><Input type="number" min={0} step={0.01} className="tnum" value={f.creditLimit} placeholder="بلا حد" aria-invalid={!!showErr("creditLimit")} onBlur={blur("creditLimit")} onChange={(e) => set("creditLimit", e.target.value)} /></Field>
              <Err m={showErr("creditLimit")} />
            </div>
            <Field label="قائمة الأسعار" hint="فارغ = السعر العادي">
              <Select value={f.priceListId} onChange={(e) => set("priceListId", e.target.value)}>
                <option value="">السعر العادي</option>{priceLists.map((pl) => <option key={pl.id} value={pl.id}>{pl.name}</option>)}
              </Select>
            </Field>
          </div>
          <details className="rounded-lg bg-ink-3 p-3" open={!!(f.contractDiscountPct || f.contractNotes)}>
            <summary className="cursor-pointer text-t-sm font-bold">عقد/اتفاقية تسعير (اختياري)</summary>
            <div className="mt-2.5 grid gap-2.5 sm:grid-cols-3">
              <div>
                <Field label="نسبة خصم العقد (%)"><Input type="number" min={0} max={100} step={0.01} className="tnum" value={f.contractDiscountPct} aria-invalid={!!showErr("contractDiscountPct")} onBlur={blur("contractDiscountPct")} onChange={(e) => set("contractDiscountPct", e.target.value)} /></Field>
                <Err m={showErr("contractDiscountPct")} />
              </div>
              <Field label="سارية من"><Input type="date" value={f.contractValidFrom} onChange={(e) => set("contractValidFrom", e.target.value)} /></Field>
              <Field label="سارية حتى"><Input type="date" value={f.contractValidUntil} onChange={(e) => set("contractValidUntil", e.target.value)} /></Field>
            </div>
            <div className="mt-2.5"><Field label="ملاحظات العقد"><Textarea rows={2} value={f.contractNotes} onChange={(e) => set("contractNotes", e.target.value)} /></Field></div>
          </details>
        </Section>

        {!isCompany && (
          <Section title="العنوان"><Textarea rows={2} value={f.address} onChange={(e) => set("address", e.target.value)} aria-label="العنوان" /></Section>
        )}

        <ErrorNote msg={err} />
        <div className="sticky bottom-0 -mx-1 flex items-center justify-between gap-2 border-t border-line bg-ink-2 px-1 pt-3">
          <span className="text-t-xs text-text-dim">{dirty ? "تغييرات غير محفوظة" : "* حقول مطلوبة"}</span>
          <div className="flex gap-2">
            <Button type="button" variant="ghost" onClick={close}>إلغاء</Button>
            <Button type="submit" loading={busy} disabled={busy}>{busy ? "جارِ الحفظ..." : "حفظ"}</Button>
          </div>
        </div>
      </form>
    </Modal>
  );
}
