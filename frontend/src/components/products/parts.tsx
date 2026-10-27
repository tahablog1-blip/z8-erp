"use client";
import { MIcon } from "@/components/m-icon";
import { Badge, type Tone } from "@/components/ui";
import { fmtMoney } from "@/lib/customers/format";
import type { StockStatus } from "@/lib/products/types";

/** حالة المخزون — تستخدم الشارة الموحدة (Badge) بنفس الألوان الدلالية في كل النظام */
const TONE: Record<StockStatus, Tone> = { ok: "success", low: "warning", out: "danger", service: "neutral" };
const LABEL: Record<StockStatus, string> = { ok: "متوفر", low: "منخفض", out: "نافد", service: "خدمة" };

export function StockBadge({ status }: { status: StockStatus }) {
  return <Badge tone={TONE[status]} dot>{LABEL[status]}</Badge>;
}

export function StockCell({ stock, status, unit }: { stock: number | null; status: StockStatus; unit?: string | null }) {
  if (status === "service" || stock == null) return <span className="text-t-xs text-text-dim">بلا مخزون</span>;
  return (
    <div className="flex flex-col items-end gap-0.5">
      <span className={`tnum text-t-md font-extrabold ${status === "out" ? "text-ember" : status === "low" ? "text-brass" : ""}`}>{fmtMoney(stock, 0)}{unit ? <small className="ms-1 text-t-xs font-normal text-text-dim">{unit}</small> : null}</span>
      <StockBadge status={status} />
    </div>
  );
}

/** صورة الصنف (من endpoint الصور القائم) أو placeholder مهني — لا صور عشوائية */
export function Thumb({ id, has, size = 40, name }: { id: string; has: boolean; size?: number; name?: string }) {
  return has ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={`/api/products/public/product-image/${id}`} alt="" loading="lazy" width={size} height={size} style={{ width: size, height: size }} className="shrink-0 rounded-lg border border-line bg-ink-2 object-contain" />
  ) : (
    <span aria-hidden title={name} style={{ width: size, height: size }} className="grid shrink-0 place-items-center rounded-lg border border-dashed border-line bg-ink-3 text-text-dim"><MIcon name="inventory_2" className="!text-[20px]" /></span>
  );
}

export function TypeChips({ p }: { p: { isService: boolean; isOil: boolean; isOilFilter: boolean } }) {
  const c = "rounded-md bg-ink-3 px-1.5 py-0.5 text-t-xs font-bold text-text-dim";
  return <>{p.isService && <span className={c}>خدمة</span>}{p.isOil && <span className={c}>زيت</span>}{p.isOilFilter && <span className={c}>فلتر زيت</span>}</>;
}
