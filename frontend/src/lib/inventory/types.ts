// أنواع مركز قيادة المخزون — مرآة لاستجابات /inventory/overview* و/inventory/movements (قراءة فقط).
export type Loc = { value: string; type: string; id: string; name: string };
export type ItemStatus = "ok" | "low" | "out" | "dead";

export type InvItem = {
  id: string; name: string; spec: string | null; category: string | null; brand: string | null; unit: string | null;
  barcode: string | null; sku: string | null; hasImage: boolean;
  stock: number; stockWarehouse: number; stockBranches: number; minQty: number;
  cost: number | null; value: number | null; price: number;
  lastMove: string | null; lastSale: string | null; soldPeriod: number; revenuePeriod: number | null; status: ItemStatus;
};

export type Overview = {
  scope: { kind: string; locId: string | null; name: string };
  period: { from: string; to: string; deadDays: number };
  canCost: boolean;
  kpis: { catalog: number; skus: number; units: number; value: number | null; low: number; out: number; dead: number; fast: number; movedToday: number; in: number; out_qty: number; net: number };
  health: { ok: number; low: number; out: number; dead: number };
  stocktakeLocks: { id: string; status: string; loc: string }[];
  items: InvItem[]; total: number; page: number; pageSize: number;
};

export type Movement = {
  id: string; at: string; type: string; typeLabel: string; productId: string; label: string | null; qty: number; moveNo: string | null;
  note: string | null; supplier: string | null; unitCost: number | null; from: string; to: string; user: string | null;
};
export type MovementsRes = { items: Movement[]; total: number; page: number; pageSize: number };

export type ProductInv = {
  canCost: boolean;
  product: { id: string; name: string; spec: string | null; category: string | null; unit: string | null; barcode: string | null; sku: string | null; brand: string | null; hasImage: boolean; price: number; cost: number | null; minQty: number };
  total: number; value: number | null;
  stock: { value: string; locType: string; locId: string; name: string; qty: number; shelf: string | null; low: boolean }[];
  moves: { at: string; type: string; typeLabel: string; qty: number; moveNo: string | null; note: string | null; user: string | null; supplier: string | null; from: string; to: string }[];
  lastSale: { invoiceId: string; invoiceNo: string; at: string } | null;
  lastReceive: { at: string; supplier: string | null; unitCost: number | null } | null;
};

export type Analytics = {
  period: { from: string; to: string; deadDays: number }; canCost: boolean;
  byLocation: { value: string; name: string; type: string; skus: number; units: number; value_amt: number | null; low: number; out: number }[];
  byCategory: { category: string; skus: number; units: number; value: number | null }[];
  byBrand: { brand: string; skus: number; units: number; value: number | null }[];
  topMovers: { id: string; name: string; spec: string | null; qty: number; revenue: number | null; perDay: number }[];
  trend: { date: string; in: number; out: number }[];
};

export const STATUS_LABEL: Record<ItemStatus, string> = { ok: "متوفر", low: "منخفض", out: "نافد", dead: "راكد" };
export const STATUS_TONE: Record<ItemStatus, string> = {
  ok: "bg-emerald-bg text-emerald", low: "bg-brass-bg text-brass", out: "bg-ember-bg text-ember", dead: "bg-ink-3 text-text-dim",
};
export const MOVE_TONE: Record<string, string> = { receive: "bg-emerald-bg text-emerald", transfer: "bg-petrol-soft text-petrol", adjust: "bg-brass-bg text-brass" };
