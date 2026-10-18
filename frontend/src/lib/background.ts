// lib/background.ts — خلفية موحدة للنظام كامل (معرض متعدد + شفافية/تمويه/تعتيم/عرض)
// المصدر الحي: /api/settings/background-settings — والقيم هنا Fallback بلا أي خلفية (الوضع الافتراضي الآمن)
export type BackgroundInfo = {
  activeId: string | null;
  activeImageUrl: string | null;
  opacity: number;         // 0-100 — شفافية لوحة المحتوى الرئيسية (100 = بلا أي تغيير بصري)
  overlayDarkness: number; // 0-100 — تعتيم فوق الصورة نفسها
  blur: number;            // 0-20 (px) — تمويه الصورة نفسها
  fit: "cover" | "contain" | "repeat";
};

const FALLBACK: BackgroundInfo = {
  activeId: null, activeImageUrl: null,
  opacity: 100, overlayDarkness: 0, blur: 0, fit: "cover",
};

const CACHE_KEY = "z8_background";
const EVENT = "z8-bg-updated"; // بديل خفيف لـ Context/Store — نفس التبويب ما بيسمعش storage event

export function getBackground(): BackgroundInfo {
  if (typeof window === "undefined") return FALLBACK;
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (raw) return { ...FALLBACK, ...JSON.parse(raw) };
  } catch { /* تجاهل */ }
  return FALLBACK;
}

export function cacheBackground(b: Partial<BackgroundInfo>) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ ...getBackground(), ...b }));
    window.dispatchEvent(new Event(EVENT));
  } catch { /* */ }
}

export function onBackgroundUpdate(cb: () => void): () => void {
  window.addEventListener(EVENT, cb);
  window.addEventListener("storage", cb); // تحديث بين تبويبات/أجهزة مختلفة لنفس المتصفح
  return () => { window.removeEventListener(EVENT, cb); window.removeEventListener("storage", cb); };
}

// تُستدعى مرة عند فتح التطبيق (من الـ Shell) لتحديث الكاش من السيرفر
export async function refreshBackground(apiFn: <T>(p: string) => Promise<T>) {
  try {
    const r = await apiFn<BackgroundInfo>("/settings/background-settings");
    cacheBackground(r);
  } catch { /* الخلفية هتستخدم الكاش/الافتراضي (بلا خلفية) */ }
}
