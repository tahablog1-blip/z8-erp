// lib/format.ts — تنسيق موحّد للتواريخ والأرقام يحترم إعدادي النظام:
// التاريخ الهجري (خيار عرض) وتنسيق الأرقام (لاتينية/عربية هندية).
// القيمة تُضبط مرة واحدة عند تحميل الجلسة (راجع AuthProvider) عبر setFormatSettings،
// وكل الاستدعاءات في التطبيق اللي تستخدم money()/formatDate() من هنا بتاخدها فوراً
// بلا أي اشتراك/Context — نفس فلسفة getToken() في lib/api.ts (كاش بسيط على مستوى الموديول).

export type DateCalendar = "gregorian" | "hijri";
export type NumberFormat = "latin" | "arabic";

export type FormatSettings = { dateCalendar: DateCalendar; numberFormat: NumberFormat };

let _fmt: FormatSettings = { dateCalendar: "gregorian", numberFormat: "latin" };

export function setFormatSettings(s: Partial<FormatSettings>) {
  _fmt = { ..._fmt, ...s };
}

export function getFormatSettings(): FormatSettings {
  return _fmt;
}

function isEnglish(): boolean {
  return typeof document !== "undefined" && document.documentElement.lang === "en";
}

/** يبني كود لغة BCP-47 بالتقويم/ترقيم المطلوبين — الترقيم فقط (أرقام) أو ترقيم+تقويم (تواريخ) */
function buildLocale(includeCalendar: boolean): string {
  if (isEnglish()) return "en-US";
  const u: string[] = [];
  if (includeCalendar && _fmt.dateCalendar === "hijri") u.push("ca-islamic-umalqura");
  if (_fmt.numberFormat === "latin") u.push("nu-latn");
  // الترقيم العربي الهندي هو الافتراضي الطبيعي لـ ar-SA بلا أي امتداد u-nu
  return u.length ? `ar-SA-u-${u.join("-")}` : "ar-SA";
}

export function formatNumber(n: number, opts?: Intl.NumberFormatOptions): string {
  return Number(n || 0).toLocaleString(buildLocale(false), {
    minimumFractionDigits: 2, maximumFractionDigits: 2, ...opts,
  });
}

/** ar.SA.money القديم — نفس الاسم والسلوك الافتراضي بالضبط، لكنه الآن يحترم إعداد تنسيق الأرقام */
export const money = formatNumber;

export function formatDate(iso: string, opts?: Intl.DateTimeFormatOptions): string {
  return new Date(iso).toLocaleDateString(buildLocale(true), {
    year: "numeric", month: "2-digit", day: "2-digit", ...opts,
  });
}

export function formatDateLong(iso: string, opts?: Intl.DateTimeFormatOptions): string {
  return new Date(iso).toLocaleDateString(buildLocale(true), {
    weekday: "long", day: "numeric", month: "long", ...opts,
  });
}

export function formatTime(iso: string, opts?: Intl.DateTimeFormatOptions): string {
  return new Date(iso).toLocaleTimeString(buildLocale(false), {
    hour: "2-digit", minute: "2-digit", ...opts,
  });
}

export function formatDateTime(iso: string, opts?: Intl.DateTimeFormatOptions): string {
  return new Date(iso).toLocaleString(buildLocale(true), {
    dateStyle: "medium", timeStyle: "short", ...opts,
  });
}
