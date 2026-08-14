// modules/suppliers/types.ts — عقود المورد المشتركة بين الشاشات
export type Supplier = {
  id: string;
  name: string;
  phone: string | null;
  vat_number: string | null;
  address: string | null;
  payment_terms_days: number;
  balance: number;   // موجب = مستحق للمورد (ذمة دائنة)
};

export type SupplierLedgerEntry = {
  id: string;
  entry_type: "invoice" | "payment";
  invoice_id: string | null;
  invoice_no: string | null;
  due_date: string | null;
  payment_terms: string | null;
  amount: number;
  note: string | null;
  created_at: string;
  running_balance: number;
};

export type DueInvoice = {
  id: string;
  invoice_no: string;
  invoice_date: string;
  due_date: string | null;
  total: number;
  paid_total: number;
  status: string;
};

export type SupplierStatement = {
  supplier: Supplier;
  entries: SupplierLedgerEntry[];
  balance: number;
  dueInvoices: DueInvoice[];
};

export const money = (n: number) =>
  Number(n || 0).toLocaleString("ar-SA-u-nu-latn", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
