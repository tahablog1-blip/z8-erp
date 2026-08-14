// modules/invoices/types.ts — عقود الفاتورة والوردية المشتركة بين الشاشات

export type PaymentMethod = "cash" | "card" | "transfer" | "credit";

export const PAYMENT_LABELS: Record<PaymentMethod, string> = {
  cash: "نقدي", card: "شبكة", transfer: "تحويل", credit: "آجل",
};

export type Invoice = {
  id: string;
  branch_id: string;
  branch_name: string | null;
  invoice_no: string;
  invoice_uuid: string;
  invoice_type: "simplified" | "standard";
  source: "pos" | "car";
  car_id: string | null;
  customer_id: string | null;
  customer_name: string | null;
  customer_vat: string | null;
  issued_at: string;
  qr_tlv: string | null;
  zatca_status: string;
  total_ex: number;
  total_vat: number;
  total_inc: number;
  paid_total: number;
  credit_total: number;
  is_returned: boolean;
  shift_id: string | null;
};

export type InvoiceItem = {
  id: string;
  product_id: string | null;
  label: string;
  barcode?: string;
  qty: number;
  unit_price: number;
  unit_price_vat: number;
  discount_amount: number;
  line_ex: number;
  line_vat: number;
  line_inc: number;
};

export type InvoicePayment = {
  id: string;
  method: PaymentMethod;
  amount: number;
  created_at: string;
};

export type InvoiceDetail = Invoice & {
  cashier_name: string | null;
  customer_phone: string | null;
  items: InvoiceItem[];
  payments: InvoicePayment[];
  car: {
    plate: string | null;
    model: string | null;
    brand: string | null;
    model_year: string | null;
    color: string | null;
    chassis_number: string | null;
    odometer_current: number | null;
    odometer_previous: number | null;
    checklist?: { key: string; label: string; status: string; note: string | null }[] | null;
    notes: string | null;
    registrar_name: string | null;
  } | null;
};

export type Shift = {
  id: string;
  branch_id: string;
  branch_name: string | null;
  user_id: string;
  user_name: string | null;
  opened_at: string;
  closed_at: string | null;
  opening_cash: number;
  closing_cash_counted: number | null;
  closing_notes: string | null;
  status: "open" | "closed";
  invoice_count?: number;
  total_sales?: number;
};

export type ShiftReport = {
  shift: Shift;
  sales: { invoiceCount: number; totalEx: number; totalVat: number; totalInc: number };
  byMethod: Record<PaymentMethod, number>;
  returns: { count: number; totalInc: number; cashRefunds: number };
  cash: { opening: number; expected: number; counted: number | null; difference: number | null };
  topItems: { label: string; qty: number; total: number }[];
};

export const money = (n: number) =>
  Number(n || 0).toLocaleString("ar-SA-u-nu-latn", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
