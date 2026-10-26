// lib/plate.ts — هوية اللوحة السعودية (نفس منطق backend/core/plate_utils.py): تُستخدم لعرض اللوحة وكشف التكرار فوراً.
const AR_TO_EN: Record<string, string> = {
  ا: "A", أ: "A", إ: "A", آ: "A", ب: "B", ح: "J", د: "D", ر: "R", س: "S", ص: "X", ط: "T", ع: "E", ق: "G", ك: "K", ل: "L", م: "Z", ن: "N",
  ه: "H", ة: "H", و: "U", ؤ: "U", ي: "V", ى: "V", ئ: "V",
};
const EN_TO_AR: Record<string, string> = { A: "أ", B: "ب", J: "ح", D: "د", R: "ر", S: "س", X: "ص", T: "ط", E: "ع", G: "ق", K: "ك", L: "ل", Z: "م", N: "ن", H: "هـ", U: "و", V: "ي" };
const VALID = new Set(Object.keys(EN_TO_AR));
const toLatinDigits = (s: string) => s.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660)).replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0));

export type PlateParts = { digits: string; letters: string; valid: boolean; key: string; display: string };

/** يفصل اللوحة السعودية إلى أرقام وحروف (بأي ترتيب/حالة/لغة) */
export function parsePlate(raw: string | null | undefined): PlateParts {
  const text = toLatinDigits(raw ?? "");
  let digits = "", letters = "";
  for (const ch of text) {
    if (/\d/.test(ch)) digits += ch;
    else if (AR_TO_EN[ch]) letters += AR_TO_EN[ch];
    else if (VALID.has(ch.toUpperCase())) letters += ch.toUpperCase();
  }
  const over = digits.length > 4 || letters.length > 3;
  digits = digits.slice(0, 4); letters = letters.slice(0, 3);
  const valid = !over && letters.length === 3 && digits.length >= 1;
  return { digits, letters, valid, key: digits || letters ? `${digits}-${letters}` : "", display: `${digits} ${letters}`.trim() };
}
export const lettersToArabic = (l: string) => [...l].map((c) => EN_TO_AR[c] ?? c).join(" ");
/** مفتاح مقارنة للوحة (يعتمد النوع) */
export function plateKey(raw: string | null | undefined, type: "saudi" | "other" = "saudi"): string {
  return type === "saudi" ? parsePlate(raw).key : "X-" + toLatinDigits(raw ?? "").toUpperCase().replace(/[^A-Z0-9؀-ۿ]/g, "");
}
