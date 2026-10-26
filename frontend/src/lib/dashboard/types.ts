// lib/dashboard/types.ts — عقد بيانات /reports/executive (الباك اند هو مصدر الحقيقة؛ كل قسم قد يكون null لو مفيش صلاحية)
export type DailySales = { date: string; count: number; total: number; profit: number };
export type SalesBlock = {
  invoiceCount: number; totalInc: number; totalEx: number; vat: number; discounts: number; credit: number;
  grossProfit: number; avgInvoice: number; refundCount: number; refunds: number;
  methods: { method: string; total: number }[]; daily: DailySales[];
};
export type PnlBlock = {
  revenue: number; cogs: number; grossProfit: number; opex: number; netProfit: number;
  expenses: { code: string; name: string; amount: number }[];
  daily: { date: string; revenue: number; cogs: number; opex: number }[];
};
export type CashBlock = {
  balance: number; accounts: { code: string; name: string; balance: number }[];
  cashIn: number; cashOut: number; net: number; daily: { date: string; in: number; out: number }[];
};
export type ReceivablesBlock = {
  total: number; current: number; d31_60: number; d61_90: number; d90plus: number; overdue: number; customers: number;
  top: { customerId: string; name: string; total: number }[];
};
export type PayablesBlock = {
  total: number; current: number; d1_30: number; d31_60: number; d61_90: number; d90plus: number; overdue: number; invoices: number;
  top: { supplierId: string; name: string; total: number }[];
};
export type InventoryBlock = {
  totalValue: number; items: number; lowStock: number; outOfStock: number;
  lowItems: { name: string; locName: string; qty: number; minQty: number; outOfStock: boolean }[];
  byCategory: { category: string; qty: number; value: number }[];
  aging: Record<string, number>; deadStockValue: number; turnover: number | null;
};
export type BranchRow = {
  id: string; name: string; sales: number; transactions: number; grossProfit: number;
  expenses: number | null; netProfit: number | null; margin: number; growth: number | null;
};
export type TopProduct = { label: string; qty: number; revenue: number; cogs: number; profit: number; margin: number };
export type TopCustomer = { customerId: string; name: string; invoices: number; total: number; outstanding: number; lastAt: string | null };
export type RecentInvoice = {
  id: string; invoiceNo: string; customer: string | null; source: "pos" | "car" | string; total: number;
  status: "paid" | "partial" | "credit" | "refunded"; branch: string | null; user: string | null; methods: string[]; at: string;
};
export type AlertItem = { key: string; tone: "danger" | "warning" | "info"; count?: number; amount?: number; href: string };

export type Executive = {
  period: { from: string; to: string; days: number };
  prev: { from: string; to: string };
  branchId: string | null;
  access: { sales: boolean; finance: boolean; inventory: boolean; branches: boolean; ops: boolean };
  sales: SalesBlock | null; salesPrev: SalesBlock | null;
  pnl: PnlBlock | null; pnlPrev: PnlBlock | null;
  cash: CashBlock | null; receivables: ReceivablesBlock | null; payables: PayablesBlock | null;
  inventory: InventoryBlock | null; branches: BranchRow[] | null;
  topProducts: TopProduct[] | null; topCustomers: TopCustomer[] | null;
  recent: RecentInvoice[] | null;
  ops: { queued: number; inService: number; doneToday: number } | null;
  alerts: AlertItem[];
  errors: string[];
};
