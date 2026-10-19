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
  po_id: string | null;
};

// ══════════════════ عروض الأسعار ══════════════════
export type QuotationStatus = "received" | "converted" | "rejected";

export type Quotation = {
  id: string;
  quotation_no: string;
  supplier_id: string;
  supplier_name: string | null;
  valid_until: string | null;
  note: string | null;
  status: QuotationStatus;
  total: number;
  created_at: string;
};

export type QuotationItem = {
  id: string;
  product_id: string | null;
  product_label: string;
  qty: number;
  unit_cost: number;
  line_total: number;
};

export type QuotationDetail = Quotation & { items: QuotationItem[] };

// ══════════════════ أوامر الشراء ══════════════════
export type POStatus =
  | "pending_approval" | "approved" | "rejected" | "cancelled"
  | "partially_received" | "received" | "invoiced";

export type PO = {
  id: string;
  po_no: string;
  supplier_id: string;
  supplier_name: string | null;
  quotation_id: string | null;
  status: POStatus;
  expected_date: string | null;
  note: string | null;
  subtotal: number;
  vat_total: number;
  total: number;
  approved_by_name: string | null;
  approved_at: string | null;
  rejected_reason: string | null;
  invoice_id: string | null;
  invoice_no: string | null;
  created_at: string;
};

export type POItem = {
  id: string;
  product_id: string | null;
  product_label: string;
  qty: number;
  unit_cost: number;
  line_total: number;
  qty_received: number;
};

export type POReceiptItem = { po_item_id: string; product_label: string; qty_received: number };

export type POReceipt = {
  id: string;
  receipt_no: string;
  note: string | null;
  received_by_name: string | null;
  created_at: string;
  items: POReceiptItem[];
};

export type PODetail = PO & { items: POItem[]; receipts: POReceipt[] };

// تنسيق الأرقام يحترم إعداد "تنسيق الأرقام" بالنظام (لاتينية/عربية هندية) — راجع lib/format.ts
export { money } from "@/lib/format";
