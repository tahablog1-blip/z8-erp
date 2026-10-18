// lib/colorUtils.ts — تحويلات ألوان بسيطة (Hex ↔ HSL) + اشتقاق درجات العلامة التجارية
// الهدف: الأدمن يختار لون واحد (Hex)، والنظام يشتق منه تلقائياً نسخة فاتحة/غامقة/شفافة
// تناسب الوضع النهاري والليلي بدون ما يحتاج يضبط كل درجة لوحده.

function clamp(n: number, min: number, max: number) { return Math.min(max, Math.max(min, n)); }

export function hexToRgb(hex: string) {
  const clean = hex.replace("#", "");
  const n = parseInt(clean.length === 3 ? clean.split("").map((c) => c + c).join("") : clean, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

export function rgbToHex(r: number, g: number, b: number) {
  const h = (x: number) => clamp(Math.round(x), 0, 255).toString(16).padStart(2, "0");
  return `#${h(r)}${h(g)}${h(b)}`;
}

export function rgbToHsl(r: number, g: number, b: number) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0;
  const l = (max + min) / 2;
  const d = max - min;
  if (d !== 0) {
    s = d / (1 - Math.abs(2 * l - 1));
    switch (max) {
      case r: h = ((g - b) / d) % 6; break;
      case g: h = (b - r) / d + 2; break;
      default: h = (r - g) / d + 4;
    }
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s: s * 100, l: l * 100 };
}

export function hslToRgb(h: number, s: number, l: number) {
  s /= 100; l /= 100;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0, g = 0, b = 0;
  if (h < 60) { r = c; g = x; b = 0; }
  else if (h < 120) { r = x; g = c; b = 0; }
  else if (h < 180) { r = 0; g = c; b = x; }
  else if (h < 240) { r = 0; g = x; b = c; }
  else if (h < 300) { r = x; g = 0; b = c; }
  else { r = c; g = 0; b = x; }
  return { r: (r + m) * 255, g: (g + m) * 255, b: (b + m) * 255 };
}

export function hexToHsl(hex: string) { const { r, g, b } = hexToRgb(hex); return rgbToHsl(r, g, b); }
export function hslToHex(h: number, s: number, l: number) { const { r, g, b } = hslToRgb(h, s, l); return rgbToHex(r, g, b); }
export function hexToRgba(hex: string, alpha: number) {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${Math.round(r)},${Math.round(g)},${Math.round(b)},${alpha})`;
}

/** يشتق (أساسي/غامق/فاتح-شفاف) من لون علامة تجارية واحد — للزر الأساسي وخلفية القضيب الجانبي */
export function deriveAccent(baseHex: string, mode: "light" | "dark") {
  const { h, s, l } = hexToHsl(baseHex);
  const sat = clamp(s, 35, 90);
  if (mode === "light") {
    return {
      base: hslToHex(h, sat, clamp(l, 28, 46)),
      deep: hslToHex(h, clamp(sat + 5, 0, 95), 22),
      soft: hslToHex(h, clamp(sat * 0.55, 0, 100), 94),
    };
  }
  const base = hslToHex(h, clamp(sat, 45, 85), clamp(l, 62, 76));
  return {
    base,
    deep: hslToHex(h, clamp(sat + 5, 0, 95), 24),
    soft: hexToRgba(base, 0.16),
  };
}

/** يشتق (أساسي/خلفية شفافة) من لون حالة واحد (نجاح/تحذير/خطأ) */
export function deriveTone(baseHex: string, mode: "light" | "dark") {
  const { h, s, l } = hexToHsl(baseHex);
  const sat = clamp(s, 45, 85);
  const lit = mode === "light" ? clamp(l, 38, 54) : clamp(l, 50, 66);
  const base = hslToHex(h, sat, lit);
  return { base, bg: hexToRgba(base, mode === "light" ? 0.10 : 0.14) };
}

/** السطوع النسبي لنظام WCAG — أساس حساب نسبة التباين بين لون ونص أبيض/أسود فوقه */
function relativeLuminance(hex: string): number {
  const { r, g, b } = hexToRgb(hex);
  const ch = (c: number) => { const cs = c / 255; return cs <= 0.03928 ? cs / 12.92 : Math.pow((cs + 0.055) / 1.055, 2.4); };
  return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b);
}

/** نسبة التباين (WCAG) بين لونين — 1 = بلا تباين إطلاقاً، 21 = أقصى تباين ممكن (أسود/أبيض) */
export function contrastRatio(hexA: string, hexB: string): number {
  const L1 = relativeLuminance(hexA), L2 = relativeLuminance(hexB);
  const lighter = Math.max(L1, L2), darker = Math.min(L1, L2);
  return (lighter + 0.05) / (darker + 0.05);
}
