// أنواع مركز الموردين — مرآة لاستجابات /suppliers/overview و/suppliers/{id}/360 (قراءة فقط).
export type SupRow = {
  id: string; name: string; phone: string | null; vatNumber: string | null; category: string | null; termsDays: number; active: boolean; rating: number | null;
  balance: number; purchases: number; paid: number; overdue: number; overdueCount: number; openInvoices: number; invoiceCount: number; invoiceCountAll: number;
  lastPurchase: string | null; lastPayment: string | null; nextDue: string | null;
};
export type Aging = { key: string; label: string; amount: number; count: number };
export type SupOverview = {
  period: { from: string; to: string };
  kpis: { total: number; active: number; purchases: number; paid: number; payable: number; advances: number; overdue: number; overdueCount: number; dueSoon: number; dueSoonCount: number; openInvoices: number; invoiceOutstanding: number; unallocated: number };
  aging: Aging[]; items: SupRow[]; total: number; page: number; pageSize: number;
};
export type Payable = { id: string; invoiceNo: string; supplierRef: string | null; supplierId: string; supplier: string; date: string; dueDate: string | null; total: number; paid: number; outstanding: number; status: string; bucket: string; daysLate: number };

export type SupInvoice = { id: string; invoiceNo: string; supplierRef: string | null; date: string; dueDate: string | null; terms: string; subtotal: number; vat: number; total: number; paid: number; outstanding: number; status: string; overdue: boolean };
export type LedgerEntry = { id: string; date: string; type: string; ref: string | null; invoiceId: string | null; note: string | null; debit: number; credit: number; balance: number; dueDate: string | null; journalId: string | null };
export type Sup360 = {
  supplier: { id: string; name: string; phone: string | null; vatNumber: string | null; address: string | null; termsDays: number; category: string | null; rating: number | null; ratingNote: string | null; active: boolean; createdAt: string | null };
  kpis: { purchases: number; paid: number; balance: number; overdue: number; overdueCount: number; dueSoon: number; dueSoonCount: number; invoiceCount: number; avgInvoice: number; lastInvoice: string | null; lastPayment: string | null; daysInactive: number | null; openInvoices: number };
  invoices: SupInvoice[];
  payments: { id: string; at: string; method: string; methodLabel: string; amount: number; invoiceNo: string | null; note: string | null; user: string | null }[];
  ledger: { opening: number; debit: number; credit: number; closing: number; entries: LedgerEntry[]; from: string | null; to: string | null };
  products: { key: string; productId: string | null; label: string; sku: string | null; barcode: string | null; qty: number; spend: number; invoices: number; lastDate: string | null; lastPrice: number }[];
  trend: { month: string; purchases: number; payments: number }[];
  activity: { at: string; kind: string; text: string; amount: number; user: string | null }[];
};

export const INV_STATUS: Record<string, string> = { paid: "مسددة", partially_paid: "مسددة جزئياً", unpaid: "غير مسددة" };
export const BUCKET_TONE: Record<string, string> = { current: "bg-emerald", d1_30: "bg-brass", d31_60: "bg-brass", d61_90: "bg-ember", d90p: "bg-ember" };
