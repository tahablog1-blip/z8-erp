// lib/design.ts — إعدادات التصميم الموحّدة للشركة (ألوان/خط عربي+إنجليزي/شكل أزرار/حركة/قائمة جانبية)
// نفس أسلوب lib/background.ts بالظبط: كاش محلي + حدث تحديث فوري + تحديث من السيرفر عند فتح التطبيق
import { deriveAccent, deriveTone } from "@/lib/colorUtils";

export type ArFontKey =
  | "cairo" | "tajawal" | "ibm-plex-arabic" | "almarai" | "noto-kufi-arabic" | "changa"
  | "el-messiri" | "readex-pro" | "reem-kufi" | "markazi-text" | "lalezar" | "harmattan" | "arial";
export type EnFontKey =
  | "inter" | "roboto" | "poppins" | "montserrat" | "lato" | "open-sans"
  | "nunito" | "work-sans" | "source-sans" | "manrope" | "dm-sans" | "outfit" | "arial";
export type ButtonShape = "sharp" | "rounded" | "pill";

export type DesignInfo = {
  primaryColor: string | null;
  successColor: string | null;
  warningColor: string | null;
  errorColor: string | null;
  fontFamilyAr: ArFontKey;
  fontFamilyEn: EnFontKey;
  buttonShape: ButtonShape;
  buttonAnimation: boolean;
  sidebarDefault: "expanded" | "collapsed";
};

const FALLBACK: DesignInfo = {
  primaryColor: null, successColor: null, warningColor: null, errorColor: null,
  fontFamilyAr: "cairo", fontFamilyEn: "inter",
  buttonShape: "rounded", buttonAnimation: true, sidebarDefault: "expanded",
};

const CACHE_KEY = "z8_design";
const EVENT = "z8-design-updated";

export function getDesign(): DesignInfo {
  if (typeof window === "undefined") return FALLBACK;
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (raw) return { ...FALLBACK, ...JSON.parse(raw) };
  } catch { /* تجاهل */ }
  return FALLBACK;
}

export function cacheDesign(d: Partial<DesignInfo>) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ ...getDesign(), ...d }));
    window.dispatchEvent(new Event(EVENT));
  } catch { /* */ }
}

export function onDesignUpdate(cb: () => void): () => void {
  window.addEventListener(EVENT, cb);
  window.addEventListener("storage", cb);
  return () => { window.removeEventListener(EVENT, cb); window.removeEventListener("storage", cb); };
}

export async function refreshDesign(apiFn: <T>(p: string) => Promise<T>) {
  try {
    const r = await apiFn<DesignInfo>("/settings/design");
    cacheDesign(r);
  } catch { /* التصميم هيستخدم الكاش/الافتراضي */ }
}

export const FONT_STACKS_AR: Record<ArFontKey, string> = {
  "cairo": "'Cairo', sans-serif",
  "tajawal": "'Tajawal', sans-serif",
  "ibm-plex-arabic": "'IBM Plex Sans Arabic', sans-serif",
  "almarai": "'Almarai', sans-serif",
  "noto-kufi-arabic": "'Noto Kufi Arabic', sans-serif",
  "changa": "'Changa', sans-serif",
  "el-messiri": "'El Messiri', sans-serif",
  "readex-pro": "'Readex Pro', sans-serif",
  "reem-kufi": "'Reem Kufi', sans-serif",
  "markazi-text": "'Markazi Text', serif",
  "lalezar": "'Lalezar', cursive",
  "harmattan": "'Harmattan', sans-serif",
  "arial": "Arial, Tahoma, sans-serif", // خط نظام — بلا تحميل شبكة، العادي والبولد مدعومين تلقائياً من النظام
};

export const FONT_STACKS_EN: Record<EnFontKey, string> = {
  "inter": "'Inter', sans-serif",
  "roboto": "'Roboto', sans-serif",
  "poppins": "'Poppins', sans-serif",
  "montserrat": "'Montserrat', sans-serif",
  "lato": "'Lato', sans-serif",
  "open-sans": "'Open Sans', sans-serif",
  "nunito": "'Nunito', sans-serif",
  "work-sans": "'Work Sans', sans-serif",
  "source-sans": "'Source Sans 3', sans-serif",
  "manrope": "'Manrope', sans-serif",
  "dm-sans": "'DM Sans', sans-serif",
  "outfit": "'Outfit', sans-serif",
  "arial": "Arial, Helvetica, sans-serif", // خط نظام — بلا تحميل شبكة، العادي والبولد مدعومين تلقائياً من النظام
};

export const FONT_LABELS_AR: Record<ArFontKey, string> = {
  "cairo": "Cairo — افتراضي", "tajawal": "Tajawal", "ibm-plex-arabic": "IBM Plex Sans Arabic",
  "almarai": "Almarai", "noto-kufi-arabic": "Noto Kufi Arabic", "changa": "Changa",
  "el-messiri": "El Messiri", "readex-pro": "Readex Pro", "reem-kufi": "Reem Kufi",
  "markazi-text": "Markazi Text", "lalezar": "Lalezar", "harmattan": "Harmattan", "arial": "Arial",
};

export const FONT_LABELS_EN: Record<EnFontKey, string> = {
  "inter": "Inter — افتراضي", "roboto": "Roboto", "poppins": "Poppins", "montserrat": "Montserrat",
  "lato": "Lato", "open-sans": "Open Sans", "nunito": "Nunito", "work-sans": "Work Sans",
  "source-sans": "Source Sans 3", "manrope": "Manrope", "dm-sans": "DM Sans", "outfit": "Outfit",
  "arial": "Arial",
};

export const BUTTON_SHAPE_LABELS: Record<ButtonShape, string> = {
  sharp: "حواف حادة",
  rounded: "حواف دائرية — افتراضي",
  pill: "كبسولة (دائرية بالكامل)",
};

const RADIUS_PRESETS: Record<ButtonShape, { sm: string; base: string; lg: string; xl: string; card: string }> = {
  sharp:   { sm: "3px", base: "4px", lg: "6px", xl: "8px", card: "10px" },
  rounded: { sm: "6px", base: "8px", lg: "12px", xl: "16px", card: "16px" },
  pill:    { sm: "10px", base: "14px", lg: "18px", xl: "22px", card: "22px" },
};

/** يطبّق إعدادات التصميم كمتغيرات CSS على مستوى الصفحة كلها — نفس لحظة الحفظ، بلا إعادة تحميل.
 *  lang يحدد أي خط يُستخدم فعلياً (عربي لما الواجهة عربي، إنجليزي لما English) — لا علاقة له بالقوائم/حجمها. */
export function applyDesignVars(d: DesignInfo, isDark: boolean, lang: "ar" | "en") {
  if (typeof document === "undefined") return;
  const root = document.documentElement.style;

  if (d.primaryColor) {
    const a = deriveAccent(d.primaryColor, isDark ? "dark" : "light");
    root.setProperty("--petrol", a.base);
    root.setProperty("--petrol-deep", a.deep);
    root.setProperty("--petrol-soft", a.soft);
  } else {
    root.removeProperty("--petrol"); root.removeProperty("--petrol-deep"); root.removeProperty("--petrol-soft");
  }

  const toneMap: [string | null, string, string][] = [
    [d.successColor, "--emerald", "--emerald-bg"],
    [d.warningColor, "--brass", "--brass-soft"],
    [d.errorColor, "--ember", "--ember-bg"],
  ];
  for (const [hex, baseVar, bgVar] of toneMap) {
    if (hex) {
      const t = deriveTone(hex, isDark ? "dark" : "light");
      root.setProperty(baseVar, t.base);
      root.setProperty(bgVar, t.bg);
    } else {
      root.removeProperty(baseVar); root.removeProperty(bgVar);
    }
  }

  const radii = RADIUS_PRESETS[d.buttonShape] || RADIUS_PRESETS.rounded;
  root.setProperty("--radius-sm", radii.sm);
  root.setProperty("--radius", radii.base);
  root.setProperty("--radius-lg", radii.lg);
  root.setProperty("--radius-xl", radii.xl);
  root.setProperty("--radius-card", radii.card);

  // الخط يتبع لغة الواجهة الحالية تلقائياً — عربي للعربي، إنجليزي للإنجليزي
  document.body.style.fontFamily = lang === "en"
    ? (FONT_STACKS_EN[d.fontFamilyEn] || "")
    : (FONT_STACKS_AR[d.fontFamilyAr] || "");

  // حركة الأزرار — Button/IconButton فقط عبر class="z8-anim-btn" (القوائم غير متأثرة إطلاقاً)
  document.documentElement.setAttribute("data-btn-anim", d.buttonAnimation ? "on" : "off");
}
