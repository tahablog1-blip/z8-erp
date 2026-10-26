// lib/invoice-view.ts — نموذج عرض موحّد للفاتورة (مصدر واحد لقوالب A4 / الحراري / المعاينة).
// عرض وتنسيق فقط: كل القيم المالية تأتي من الباك اند كما هي (total_ex / total_vat / total_inc / discount_total / paid_total / credit_total)
// ولا يُعاد حسابها هنا. الحالة مشتقة من paid_total / credit_total / is_returned الحقيقية للفاتورة.
import { InvoiceDetail, PAYMENT_LABELS } from "@/modules/invoices/types";

export type StatusKey = "paid" | "partial" | "credit" | "returned";
export type InvoiceStatus = { key: StatusKey; ar: string; en: string };

export function invoiceStatus(inv: InvoiceDetail): InvoiceStatus {
  if (inv.is_returned) return { key: "returned", ar: "مرتجعة", en: "Returned" };
  if (inv.credit_total > 0) return inv.paid_total > 0
    ? { key: "partial", ar: "مدفوعة جزئياً", en: "Partially paid" }
    : { key: "credit", ar: "آجلة", en: "On credit" };
  return { key: "paid", ar: "مدفوعة", en: "Paid" };
}

export const invoiceTitle = (inv: InvoiceDetail) => inv.is_returned
  ? { ar: "فاتورة مرتجعة", en: "Return Invoice" }
  : inv.invoice_type === "standard"
    ? { ar: "فاتورة ضريبية", en: "Tax Invoice" }
    : { ar: "فاتورة ضريبية مبسطة", en: "Simplified Tax Invoice" };

export type Pair = { k: string; v: string; ltr?: boolean };
const has = (v: unknown) => v !== null && v !== undefined && String(v).trim() !== "";
const km = (n: number | string) => `\u2066${n}\u2069 كم`;   // رقم ثابت الاتجاه + وحدة عربية
const pair = (k: string, v: unknown, ltr = false): Pair | null => has(v) ? { k, v: String(v), ltr } : null;
const clean = (a: (Pair | null)[]): Pair[] => a.filter((x): x is Pair => !!x);

export type InvoiceView = {
  status: InvoiceStatus;
  title: { ar: string; en: string };
  customer: Pair[];
  vehicle: Pair[];
  items: { label: string; sku: string; qty: number; unit: number; discount: number; vat: number; ex: number; inc: number }[];
  hasDiscount: boolean;
  payments: { label: string; amount: number }[];
  extra: Pair[];
  next: number | null;
};

/** يجهّز أقسام الفاتورة للعرض — يُسقط الحقول الفارغة بدل عرض «—» */
export function buildInvoiceView(inv: InvoiceDetail): InvoiceView {
  const c = inv.car;
  const delta = c?.odometer_current && c?.odometer_previous ? c.odometer_current - c.odometer_previous : null;
  const next = nextServiceEstimate(inv);
  const t = c as (typeof c & { filler_name?: string | null; fitter1_name?: string | null; fitter2_name?: string | null; checker_name?: string | null }) | null;
  const fitters = t ? [t.fitter1_name, t.fitter2_name].filter(Boolean).join(" و") : "";
  return {
    status: invoiceStatus(inv),
    title: invoiceTitle(inv),
    customer: clean([
      pair("العميل", inv.customer_name || "بيع نقدي"),
      pair("الجوال", inv.customer_phone, true),
      pair("الرقم الضريبي", inv.customer_vat, true),
    ]),
    vehicle: c ? clean([
      pair("اللوحة", c.plate, true),
      pair("السيارة", [c.brand, c.model].filter(Boolean).join(" ")),
      pair("السنة", c.model_year, true),
      pair("اللون", c.color),
      pair("العداد الحالي", c.odometer_current ? km(c.odometer_current) : null),
      pair("العداد السابق", c.odometer_previous ? km(c.odometer_previous) : null),
      pair("المسافة منذ آخر خدمة", delta && delta > 0 ? km(delta) : null),
      pair("الممشى التقريبي للتغيير القادم", next ? `${km(next)} (تقريبي)` : null),
      pair("رقم الهيكل (VIN)", c.chassis_number, true),
      pair("فني التعبئة", t?.filler_name),
      pair("الفك والتركيب", fitters),
      pair("التشييك", t?.checker_name),
    ]) : [],
    items: inv.items.map((it) => ({
      label: it.label, sku: it.barcode || "", qty: it.qty, unit: it.unit_price, discount: it.discount_amount || 0,
      vat: it.line_vat, ex: it.line_ex, inc: it.line_inc,
    })),
    hasDiscount: (inv.discount_total || 0) > 0 || inv.items.some((it) => (it.discount_amount || 0) > 0),
    payments: inv.payments.filter((p) => p.amount > 0).map((p) => ({ label: PAYMENT_LABELS[p.method] ?? p.method, amount: p.amount })),
    extra: clean([
      pair("نوع العملية", inv.source === "car" ? "فاتورة خدمة" : "بيع مباشر"),
      pair("نقطة البيع", inv.branch_name),
      pair("الوردية", inv.shift_id ? inv.shift_id.slice(0, 8) : null, true),
    ]),
    next,
  };
}

/** الممشى التقريبي عند التغيير القادم — تقدير تقريبي فقط:
 *  5000 كم للزيوت المعدنية/نصف التخليقية، 10000 كم لو الصنف مكتوب عليه "سانتتيك/توليف/Synthetic" */
export function nextServiceEstimate(inv: InvoiceDetail): number | null {
  const cur = inv.car?.odometer_current;
  if (!cur) return null;
  if (!inv.items.some((it) => /زيت|oil/i.test(it.label))) return null;
  const synthetic = inv.items.some((it) => /سانتتيك|توليف|synthetic|full\s*syn/i.test(it.label));
  return cur + (synthetic ? 10000 : 5000);
}
