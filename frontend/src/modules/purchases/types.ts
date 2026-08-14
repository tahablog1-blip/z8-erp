// modules/purchases/types.ts — عقود فاتورة المشتريات المشتركة بين الشاشات
export type PurchaseInvoice = {
  id: string;
  supplier_id: string;
  supplier_name: string | null;
  invoice_no: string;
  supplier_invoice_ref: string | null;
  invoice_date: string;
  payment_terms: "cash" | "credit";
  due_date: string | null;
  subtotal: number;
  vat_total: number;
  total: number;
  paid_total: number;
  status: "unpaid" | "partially_paid" | "paid";
};

export type PurchaseInvoiceItem = {
  id: string;
  product_id: string | null;
  product_label: string;
  qty: number;
  unit_cost: number;
  line_total: number;
};

export type PurchaseInvoiceDetail = PurchaseInvoice & {
  items: PurchaseInvoiceItem[];
};

export const money = (n: number) =>
  Number(n || 0).toLocaleString("ar-SA-u-nu-latn", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
