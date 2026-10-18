// lib/printing.ts — إعدادات الطباعة (+ تنسيق الوقت من إعدادات النظام) للاستخدام في قوالب الطباعة
// المصدر الحي: /api/settings/printing و /api/settings/system (كلاهما DB-backed الآن، بديل localStorage)
// والقيم هنا Fallback لو الجلسة لسه محمّلتش البيانات
export type PrintingInfo = {
  autoPrint: boolean;
  footer: string;
  footerReturn: string;
  thermalFontSize: "normal" | "large";
  thermalShowLogo: boolean;
  thermalShowQr: boolean;
  copies: number;
  previewBeforePrint: boolean;
  timeFormat: "24" | "12"; // من /settings/system — مُجمَّع هنا لسهولة الاستخدام في قوالب الطباعة فقط
};

const FALLBACK: PrintingInfo = {
  autoPrint: true,
  footer: "شكراً لتعاملكم معنا",
  footerReturn: "نعتذر عن أي إزعاج، نتمنى لكم تجربة أفضل في المرة القادمة",
  thermalFontSize: "normal",
  thermalShowLogo: true,
  thermalShowQr: true,
  copies: 1,
  previewBeforePrint: false,
  timeFormat: "24",
};

const CACHE_KEY = "z8_printing";

export function getPrinting(): PrintingInfo {
  if (typeof window === "undefined") return FALLBACK;
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (raw) return { ...FALLBACK, ...JSON.parse(raw) };
  } catch { /* تجاهل */ }
  return FALLBACK;
}

export function cachePrinting(p: Partial<PrintingInfo>) {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify({ ...getPrinting(), ...p })); } catch { /* */ }
}

// تُستدعى مرة عند فتح التطبيق (من الـ Shell) لتحديث الكاش من السيرفر
export async function refreshPrinting(apiFn: <T>(p: string) => Promise<T>) {
  try {
    const [printing, sys] = await Promise.all([
      apiFn<Omit<PrintingInfo, "timeFormat">>("/settings/printing"),
      apiFn<{ timeFormat: "24" | "12" }>("/settings/system"),
    ]);
    cachePrinting({ ...printing, timeFormat: sys.timeFormat || "24" });
  } catch { /* الطباعة هتستخدم الكاش/الافتراضي */ }
}
