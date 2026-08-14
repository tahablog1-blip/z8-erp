// lib/company.ts — بيانات المنشأة للطباعة
// المصدر الحي: /api/settings/company (بتتحدث من شاشة الإعدادات وتتخزن محلياً)
// والقيم هنا Fallback لو الجلسة لسه محمّلتش البيانات
export type CompanyInfo = {
  name: string;
  vat: string;
  cr: string;
  phone: string;
  address: string;
};

const FALLBACK: CompanyInfo = {
  name: "شركة مصدر الزيوت للتجارة",
  vat: "311832965900003",
  cr: "1010581613",
  phone: "",
  address: "المملكة العربية السعودية",
};

const CACHE_KEY = "z8_company";

export function getCompany(): CompanyInfo {
  if (typeof window === "undefined") return FALLBACK;
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (raw) return { ...FALLBACK, ...JSON.parse(raw) };
  } catch { /* تجاهل */ }
  return FALLBACK;
}

export function cacheCompany(c: Partial<CompanyInfo>) {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify({ ...getCompany(), ...c })); } catch { /* */ }
}

// تُستدعى مرة عند فتح التطبيق (من الـ Shell) لتحديث الكاش من السيرفر
export async function refreshCompany(apiFn: <T>(p: string) => Promise<T>) {
  try {
    const r = await apiFn<{ name: string; vat_number: string | null; cr_number: string | null; address: string | null; phone: string | null }>("/settings/company");
    cacheCompany({
      name: r.name || FALLBACK.name,
      vat: r.vat_number || "", cr: r.cr_number || "",
      address: r.address || "", phone: r.phone || "",
    });
  } catch { /* الطباعة هتستخدم الكاش/الافتراضي */ }
}

export const COMPANY = FALLBACK; // توافق خلفي مع الاستيرادات القديمة
