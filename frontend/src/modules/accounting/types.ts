// modules/accounting/types.ts — عقود الحسابات والتقارير المشتركة بين الشاشات

export type Account = {
  id: string;
  code: string;
  name: string;
  type: "asset" | "liability" | "equity" | "revenue" | "expense";
  parent_id: string | null;
  is_system: boolean;
  is_active: boolean;
};

export const ACCOUNT_TYPE_LABELS: Record<Account["type"], string> = {
  asset: "أصول", liability: "خصوم", equity: "حقوق ملكية", revenue: "إيرادات", expense: "مصروفات",
};

export type JournalLine = {
  id: string;
  account_id: string;
  account_code: string;
  account_name: string;
  debit: number;
  credit: number;
  description: string | null;
};

export type JournalEntry = {
  id: string;
  branch_id: string | null;
  branch_name: string | null;
  entry_date: string;
  source_type: string;
  source_id: string | null;
  description: string | null;
  created_at: string;
  lines: JournalLine[];
};

export type TrialBalanceRow = {
  code: string; name: string; type: Account["type"];
  total_debit: number; total_credit: number; balance: number;
};

export type TrialBalance = {
  asOf: string;
  rows: TrialBalanceRow[];
  totalDebit: number;
  totalCredit: number;
  balanced: boolean;
};

export type IncomeRow = { code: string; name: string; type: string; amount: number };

export type IncomeStatement = {
  from: string; to: string; branchId: string | null;
  revenue: IncomeRow[]; expense: IncomeRow[];
  totalRevenue: number; totalExpense: number; netIncome: number;
};

export type BalanceRow = { code: string; name: string; type: string; balance: number };

export type BalanceSheet = {
  asOf: string;
  assets: BalanceRow[]; liabilities: BalanceRow[]; equity: BalanceRow[];
  totalAssets: number; totalLiabilities: number; totalEquity: number;
  currentEarnings: number; balanced: boolean;
};

export type VatReturn = {
  from: string; to: string; vatPercent: number;
  salesEx: number; grossVat: number; returnsEx: number; returnsVat: number; returnsCount: number;
  outputVat: number;
  bySource: Record<string, { invoiceCount: number; salesEx: number; outputVat: number }>;
  purchasesEx: number; inputVat: number; netVat: number;
};

export type SourceSummary = {
  invoiceCount: number; totalEx: number; totalVat: number; totalInc: number; creditTotal: number;
  avgTicket: number; cogs: number; grossProfit: number; marginPct: number;
  byMethod: Record<string, number>;
  topItems: { label: string; qty: number; totalInc: number }[];
};

export type SalesSummary = {
  from: string; to: string; branchId: string | null; groupBy: string;
  service: SourceSummary; retail: SourceSummary;
  totals: { invoiceCount: number; totalEx: number; totalInc: number; grossProfit: number };
  daily: { day: string; source: string; invoiceCount: number; totalInc: number }[];
};

export const money = (n: number) =>
  Number(n || 0).toLocaleString("ar-SA-u-nu-latn", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
