// lib/products/types.ts — عقد /products/overview و /products/{id}/profile (الباك اند مصدر الحقيقة)
export type StockStatus = "ok" | "low" | "out" | "service";

export type ProductRow = {
  id: string; name: string; spec: string | null; category: string; unit: string | null; barcode: string | null; sku: string | null; brand: string | null;
  isService: boolean; isOil: boolean; isOilFilter: boolean; isActive: boolean; hasImage: boolean; minQty: number;
  price: number; priceVat: number; cost: number | null; unitProfit: number | null; margin: number | null;
  stock: number | null; stockWarehouse: number | null; stockBranches: number | null; stockValue: number | null; stockStatus: StockStatus;
  sold30: number; sold90: number; periodQty: number; periodRevenue: number | null;
  lastSaleAt: string | null; daysNoSale: number | null; lastReceiveAt: string | null; isFast: boolean; createdAt: string | null;
};

export type ProductsKpis = {
  total: number; stocked: number; services: number; inactive: number; outOfStock: number; lowStock: number;
  stockValue: number | null; sales: number | null; salesQty: number | null; grossProfit: number | null; margin: number | null;
};

export type Facets = {
  categories: { name: string; count: number }[]; brands: { name: string; count: number }[]; suppliers: string[];
  locations: { type: "warehouse" | "branch"; id: string; name: string }[];
};

export type ProductsOverview = {
  items: ProductRow[]; total: number; page: number; pageSize: number; kpis: ProductsKpis; facets: Facets;
  canCost: boolean; canSales: boolean; period: { from: string; to: string };
};

export type PFilters = {
  status: "active" | "inactive" | "all"; type: "" | "product" | "service" | "oil" | "oilFilter"; category: string; brand: string; supplier: string;
  stock: "" | "in" | "low" | "out"; movement: "" | "fast" | "slow" | "dead"; loc: string;
  priceMin: string; priceMax: string; stockMin: string; stockMax: string;
};
export const EMPTY_PFILTERS: PFilters = { status: "active", type: "", category: "", brand: "", supplier: "", stock: "", movement: "", loc: "", priceMin: "", priceMax: "", stockMin: "", stockMax: "" };

export type ProfileData = {
  product: {
    id: string; name: string; spec: string | null; category: string; unit: string | null; barcode: string | null; sku: string | null; brand: string | null; oilType?: string | null; filterKind?: string | null;
    isService: boolean; isOil: boolean; isOilFilter: boolean; isActive: boolean; hasImage: boolean; minQty: number; price: number; priceVat: number;
    cost: number | null; serviceIntervalKm: number | null; unitProfit: number | null; margin: number | null; createdAt: string | null;
  };
  canCost: boolean; canSales: boolean;
  stock: { locType: string; locId: string; locName: string; qty: number; minQty: number; shelf: string | null; status: StockStatus }[];
  totalStock: number | null; stockValue: number | null;
  kpis: Partial<{ unitMargin: number | null; salesQty: number; salesRevenue: number; salesRevenueInc: number; salesInvoices: number; lastSaleAt: string | null;
    purchaseQty: number; purchaseCost: number; lastPurchaseAt: string | null; lastPurchaseCost: number | null }>;
  movements: { kind: string; label: string; at: string; doc: string | null; qty: number; from: string; to: string; user: string | null; note: string | null; supplier: string | null; unitCost: number | null; invoiceId?: string }[];
  sales: null | { invoiceId: string; invoiceNo: string; at: string; branch: string | null; customer: string | null; qty: number; price: number; discount: number; total: number; isReturned: boolean }[];
  purchases: null | { at: string; supplier: string | null; doc: string | null; qty: number; unitCost: number | null; total: number | null; location: string; purchaseInvoiceId: string | null }[];
  trend: null | Record<"daily" | "weekly" | "monthly", { date: string; qty: number; revenue: number }[]>;
  suppliers: null | { name: string; qty: number; spend: number; lastAt: string | null; lastCost: number | null }[];
  timeline: { type: string; at: string; title: string; amount?: number }[];
};
