// lib/customers/types.ts — عقد /customers/overview و /customers/{id}/profile (الباك اند هو مصدر الحقيقة)
export type Segment = "vip" | "new" | "at_risk" | "inactive" | "regular" | "no_activity";

export type CustomerRow = {
  id: string; no: string; name: string; type: "individual" | "company"; phone: string | null; email: string | null; vat: string | null;
  isActive: boolean; createdAt: string | null; lastAt: string | null; invoiceCount: number; vehicles: number; loyaltyPoints: number;
  segment: Segment; isCredit: boolean;
  sales: number | null; paid: number | null; balance: number | null; overdue: number | null; creditLimit: number | null;
};

export type CustomersKpis = {
  total: number; newInPeriod: number; activeInPeriod: number;
  sales: number | null; receivables: number | null; overdue: number | null; avgValue: number | null; debtors: number | null;
};

export type Overview = {
  items: CustomerRow[]; total: number; page: number; pageSize: number; kpis: CustomersKpis; canFinance: boolean;
  period: { from: string; to: string }; vipThreshold: number;
};

export type Filters = {
  status: "active" | "inactive" | "all"; type: "" | "individual" | "company"; segment: "" | Segment; pay: "" | "credit" | "cash";
  hasBalance: boolean; overdue: boolean; noActivity: boolean;
  regFrom: string; regTo: string; lastFrom: string; lastTo: string;
  salesMin: string; salesMax: string; balMin: string; balMax: string;
};
export const EMPTY_FILTERS: Filters = {
  status: "active", type: "", segment: "", pay: "", hasBalance: false, overdue: false, noActivity: false,
  regFrom: "", regTo: "", lastFrom: "", lastTo: "", salesMin: "", salesMax: "", balMin: "", balMax: "",
};

export type DupMatch = { id: string; no: string; name: string; phone: string | null; email: string | null; isActive: boolean; reasons: string[] };

export type Profile = {
  id: string; no: string; isActive: boolean; createdAt: string | null; loyaltyPoints: number; canFinance: boolean; canInvoices: boolean;
  kpis: null | { totalSales: number | null; invoiceCount: number | null; paid: number; due: number; overdue: number; refunds: number | null; refundCount: number | null; avgInvoice: number | null; lastAt: string | null };
  financial: null | { creditSales: number; payments: number; returns: number; balance: number };
  insights: null | { visits: number; avgInvoice: number; totalSpent: number; avgDaysBetween: number | null; daysSinceLast: number | null; firstAt: string | null; lastAt: string | null; favoriteBranch: string | null };
  invoices: null | { id: string; invoiceNo: string; at: string; total: number; paid: number; due: number; isReturned: boolean; branch: string | null; user: string | null; source: string; methods: string[] }[];
  payments: null | { kind: "sale" | "settlement"; at: string; amount: number; method: string | null; reference: string | null; user: string | null; branch: string | null }[];
  purchases: null | { label: string; qty: number; price: number; discount: number; total: number; invoiceNo: string; at: string }[];
  topProducts: null | { label: string; qty: number; total: number; invoices: number }[];
  timeline: { type: "invoice" | "refund" | "payment" | "note" | "vehicle"; at: string; title: string; amount?: number; user?: string | null }[];
  notes: { id: string; note: string; createdAt: string; user: string | null }[];
};
