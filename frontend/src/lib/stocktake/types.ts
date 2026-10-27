// أنواع وثوابت شاشة الجرد — مرآة لاستجابات /inventory/stocktakes (لا حسابات مالية هنا).
export type Branch = { id: string; name: string };

export type Session = {
  id: string; locType: string; locId: string; status: string; note: string | null;
  createdByName: string | null; createdAt: string | null; approvedByName: string | null; approvedAt: string | null;
  totalItems: number; countedItems: number; diffItems: number; surplusValue: number; shortageValue: number;
  name?: string | null; countType?: string;
};

export type Summary = {
  total: number; open: number; review: number; approved: number; cancelled: number;
  surplusValue: number; shortageValue: number; netValue: number;
};

export type StocktakeItem = {
  id: string; productId: string; name: string; barcode: string | null; category: string | null; spec: string | null; unit: string | null;
  expectedQty: number; countedQty: number | null; difference: number | null; currentQty: number;
  unitCost: number; diffValue: number | null; note: string | null;
  condition: string | null; countEntries: number;
};

export type StocktakeDetail = Omit<Session, "diffItems" | "surplusValue" | "shortageValue"> & {
  items: StocktakeItem[]; shortageValue: number; surplusValue: number; zeroCostDiffItems: number;
  categoryFilter: string | null; submittedByName: string | null; submittedAt: string | null;
  cancelledByName: string | null; cancelledAt: string | null; cancelReason: string | null;
  reopenCount: number; lastReopenReason: string | null;
  adjustInNo: string | null; adjustOutNo: string | null; adjustNote: string | null;
};

export type CountRound = { round: number; countedQty: number; condition: string | null; note: string | null; countedByName: string | null; countedAt: string | null };

export const CONDITION_LABEL: Record<string, string> = { good: "صالح", damaged: "تالف", expired: "منتهي الصلاحية", missing: "مفقود", unknown: "غير معروف" };
export const COUNT_TYPE_LABEL: Record<string, string> = { full: "جرد كامل", category: "جرد حسب التصنيف" };

export type TimelineEvent = { action: string; actorName: string | null; details: string; at: string | null };

export type ImportPreview = {
  committed: boolean; totalPieces: number; distinctBarcodes: number;
  matched: { productId: string; name: string; barcode: string; scanned: number; expectedQty: number; previousCounted: number | null; difference: number }[];
  unmatched: { barcode: string; count: number }[]; uncountedRemaining: number;
};

export const STATUS_LABEL: Record<string, string> = {
  draft: "مسودة", in_progress: "جاري الجرد", review: "قيد المراجعة", approved: "معتمد (تمت التسوية)", cancelled: "ملغي",
};
export const STATUS_TONE: Record<string, "neutral" | "good" | "warn" | "info"> = {
  draft: "neutral", in_progress: "info", review: "warn", approved: "good", cancelled: "neutral",
};
export const ACTION_LABEL: Record<string, string> = {
  stocktake_created: "إنشاء الجلسة", stocktake_submitted: "إرسال للمراجعة", stocktake_reopened: "طلب إعادة العدّ",
  stocktake_cancelled: "إلغاء", stocktake_approved: "اعتماد وتسوية",
};

export type VarState = "uncounted" | "match" | "surplus" | "shortage";
export const varState = (i: StocktakeItem): VarState =>
  i.countedQty == null ? "uncounted" : (i.difference ?? 0) === 0 ? "match" : (i.difference ?? 0) > 0 ? "surplus" : "shortage";
export const VAR_LABEL: Record<VarState, string> = { uncounted: "لم يُعدّ", match: "مطابق", surplus: "زيادة", shortage: "عجز" };
export const VAR_TEXT: Record<VarState, string> = { uncounted: "text-text-dim", match: "text-emerald", surplus: "text-petrol", shortage: "text-ember" };
export const VAR_BG: Record<VarState, string> = { uncounted: "bg-ink-3 text-text-dim", match: "bg-emerald-bg text-emerald", surplus: "bg-petrol-soft text-petrol", shortage: "bg-ember-bg text-ember" };
export const signed = (n: number | null | undefined) => n == null ? "—" : n > 0 ? `+${n}` : String(n);
