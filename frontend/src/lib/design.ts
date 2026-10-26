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
export type FontScale = "sm" | "md" | "lg" | "xl";

export type DesignInfo = {
  primaryColor: string | null;
  successColor: string | null;
  warningColor: string | null;
  errorColor: string | null;
  fontFamilyAr: ArFontKey;
  fontFamilyEn: EnFontKey;
  fontScale: FontScale;
  buttonShape: ButtonShape;
  buttonAnimation: boolean;
  sidebarDefault: "expanded" | "collapsed";
  hasBackup?: boolean;
};

const FALLBACK: DesignInfo = {
  primaryColor: null, successColor: null, warningColor: null, errorColor: null,
  fontFamilyAr: "cairo", fontFamilyEn: "inter", fontScale: "md",
  buttonShape: "rounded", buttonAnimation: true, sidebarDefault: "expanded", hasBackup: false,
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

/** مواصفات Google Fonts لكل خط — بنحمّل الخط المختار بس عند الحاجة بدل تحميل 20 عائلة خط مع كل صفحة */
const GOOGLE_FONT_SPECS: Record<string, string> = {
  "tajawal": "Tajawal:wght@400;500;700;900",
  "ibm-plex-arabic": "IBM+Plex+Sans+Arabic:wght@400;500;600;700",
  "almarai": "Almarai:wght@400;700;800",
  "noto-kufi-arabic": "Noto+Kufi+Arabic:wght@400;600;700",
  "changa": "Changa:wght@400;600;700;800",
  "el-messiri": "El+Messiri:wght@400;500;600;700",
  "readex-pro": "Readex+Pro:wght@400;500;600;700",
  "reem-kufi": "Reem+Kufi:wght@400;500;600;700",
  "markazi-text": "Markazi+Text:wght@400;500;600;700",
  "lalezar": "Lalezar",
  "harmattan": "Harmattan:wght@400;700",
  "inter": "Inter:wght@400;500;600;700;800",
  "roboto": "Roboto:wght@400;500;700;900",
  "poppins": "Poppins:wght@400;500;600;700",
  "montserrat": "Montserrat:wght@400;500;600;700;800",
  "lato": "Lato:wght@400;700;900",
  "open-sans": "Open+Sans:wght@400;500;600;700",
  "nunito": "Nunito:wght@400;600;700;800",
  "work-sans": "Work+Sans:wght@400;500;600;700",
  "source-sans": "Source+Sans+3:wght@400;500;600;700",
  "manrope": "Manrope:wght@400;500;600;700;800",
  "dm-sans": "DM+Sans:wght@400;500;700",
  "outfit": "Outfit:wght@400;500;600;700",
};

export function ensureFontLoaded(key: string) {
  const spec = GOOGLE_FONT_SPECS[key];
  if (!spec) return; // cairo (محمّل مع التطبيق) وarial (خط نظام)
  const id = `z8-font-${key}`;
  if (document.getElementById(id)) return;
  const link = document.createElement("link");
  link.id = id;
  link.rel = "stylesheet";
  link.href = `https://fonts.googleapis.com/css2?family=${spec}&display=swap`;
  document.head.appendChild(link);
}

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

/** حجم الخط الموحّد لكل صفحات النظام — يُطبَّق بتقنية zoom على مستوى <body>، فيكبّر/يصغّر كل شيء
 *  (نص، أزرار، أيقونات، تباعد) معاً وبنفس النسبة، بلا أي استثناء، لأنه يعمل على مستوى العرض
 *  نفسه لا على خصائص CSS فردية — فهو مضمون التوحيد على كل عناصر الواجهة دفعة واحدة. */
export const FONT_SCALE_LABELS: Record<FontScale, string> = {
  sm: "صغير (90%)",
  md: "متوسط — افتراضي (100%)",
  lg: "كبير (110%)",
  xl: "كبير جداً (125%)",
};

export const FONT_SCALE_PERCENT: Record<FontScale, number> = {
  sm: 90, md: 100, lg: 110, xl: 125,
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
  ensureFontLoaded(lang === "en" ? d.fontFamilyEn : d.fontFamilyAr);
  document.body.style.fontFamily = lang === "en"
    ? (FONT_STACKS_EN[d.fontFamilyEn] || "")
    : (FONT_STACKS_AR[d.fontFamilyAr] || "");

  // حجم الخط — zoom على <body> يكبّر/يصغّر كل شيء داخله معاً (نص + أزرار + أيقونات) بنسبة واحدة،
  // فهو يطبّق فوراً وبالتساوي على كل صفحات النظام بعد تسجيل الدخول دون أي استثناء لأي عنصر.
  document.body.style.zoom = `${FONT_SCALE_PERCENT[d.fontScale] ?? 100}%`;

  // حركة الأزرار — موحّدة لكل أزرار النظام الفعلية عبر data-btn-anim (القوائم/التابات غير متأثرة إطلاقاً)
  document.documentElement.setAttribute("data-btn-anim", d.buttonAnimation ? "on" : "off");
}
