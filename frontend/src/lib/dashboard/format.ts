// lib/dashboard/format.ts — تنسيق موحّد للعملة والنسب والتواريخ في لوحة القيادة.
// بيبني فوق lib/format (اللي بيحترم إعداد الأرقام والتقويم) ومفيش منطق تنسيق متكرر في المكونات.
import { formatNumber, formatDate } from "@/lib/format";

export const CURRENCY = "ر.س";

/** 1,245,800.00 */
export function fmtMoney(n: number | null | undefined, digits = 2): string {
  return formatNumber(Number(n ?? 0), { minimumFractionDigits: digits, maximumFractionDigits: digits });
}
/** 1,245,800 ر.س — بدون كسور للأرقام الكبيرة في بطاقات المؤشرات */
export function fmtCurrency(n: number | null | undefined, digits = 0): string {
  return `${fmtMoney(n, digits)} ${CURRENCY}`;
}
/** 1.2 مليون / 14.5 ألف — للمحاور والعناصر الصغيرة */
export function fmtCompact(n: number): string {
  const a = Math.abs(n);
  const lang = typeof document !== "undefined" && document.documentElement.lang === "en" ? "en" : "ar";
  const unit = (v: number, ar: string, en: string) => `${formatNumber(v, { minimumFractionDigits: 0, maximumFractionDigits: 1 })}${lang === "en" ? en : ` ${ar}`}`;
  if (a >= 1e6) return unit(n / 1e6, "مليون", "M");
  if (a >= 1e3) return unit(n / 1e3, "ألف", "K");
  return formatNumber(n, { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}
export function fmtPct(n: number | null | undefined, digits = 1): string {
  if (n == null || !isFinite(n)) return "—";
  return `${formatNumber(n, { minimumFractionDigits: digits, maximumFractionDigits: digits })}%`;
}
/** نسبة التغيير مقارنة بالفترة السابقة؛ null لو الأساس صفر (مش قابلة للحساب) */
export function growth(curr: number, prev: number): number | null {
  if (!prev) return curr ? null : 0;
  return ((curr - prev) / Math.abs(prev)) * 100;
}
// عزل اتجاه التاريخ (LRI…PDI) عشان "27/09" ما ينقلبش داخل نص عربي RTL
const isolate = (s: string) => `\u2066${s}\u2069`;
export const fmtDay = (iso: string) => isolate(`${iso.slice(8, 10)}/${iso.slice(5, 7)}`);
export const fmtDate = (iso: string) => isolate(`${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`);
