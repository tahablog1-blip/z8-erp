import type { Config } from "tailwindcss";

/** رموز هوية Z8 — الألوان متغيرات CSS عشان دعم الوضع الليلي (globals.css) */
const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink:      { DEFAULT: "var(--ink)", 2: "var(--ink2)", 3: "var(--ink3)", 4: "var(--ink4)" },
        petrol:   { DEFAULT: "var(--petrol)", deep: "var(--petrol-deep)", soft: "var(--petrol-soft)" },
        brass:    { DEFAULT: "var(--brass)", soft: "var(--brass-soft)", bg: "var(--brass-soft)" },
        emerald:  { DEFAULT: "var(--emerald)", bg: "var(--emerald-bg)" },
        ember:    { DEFAULT: "var(--ember)", bg: "var(--ember-bg)" },
        // ── أسماء دلالية موحّدة (Semantic) — نفس قيم الرموز أعلاه، تُفضَّل في الكود الجديد ──
        primary:  { DEFAULT: "var(--petrol)", deep: "var(--petrol-deep)", soft: "var(--petrol-soft)" },
        success:  { DEFAULT: "var(--emerald)", soft: "var(--emerald-bg)" },
        warning:  { DEFAULT: "var(--brass)", soft: "var(--brass-soft)" },
        danger:   { DEFAULT: "var(--ember)", soft: "var(--ember-bg)" },
        info:     { DEFAULT: "var(--petrol)", soft: "var(--petrol-soft)" },
        surface:  { DEFAULT: "var(--ink2)", hover: "var(--ink3)", raised: "var(--surface-raised)" },
        nav:      { active: "var(--nav-active)" },
        line:     "var(--line)",
        text:     { DEFAULT: "var(--text)", dim: "var(--text-dim)" },
      },
      boxShadow: {
        xs: "0 1px 2px rgba(15,23,42,.04)",
        sm: "0 1px 2px rgba(15,23,42,.04), 0 1px 3px rgba(15,23,42,.06)",
        card: "0 1px 2px rgba(15,23,42,.04), 0 2px 8px rgba(15,23,42,.04)",
        md: "0 2px 6px rgba(15,23,42,.10), 0 1px 2px rgba(15,23,42,.08)",
        lg: "0 6px 16px rgba(15,23,42,.14), 0 2px 4px rgba(15,23,42,.08)",
        panel: "0 20px 45px rgba(15,23,42,.14)",
      },
      borderRadius: {
        sm: "var(--radius-sm)",
        DEFAULT: "var(--radius)",
        md: "var(--radius)",
        lg: "var(--radius-lg)",
        xl: "var(--radius-xl)",
        card: "var(--radius-card)",
      },
      spacing: {
        "4.5": "1.125rem",
      },
      fontSize: {
        "page-title": ["20px", { lineHeight: "28px", fontWeight: "800" }],
        "section-title": ["15px", { lineHeight: "22px", fontWeight: "800" }],
        "card-title": ["13.5px", { lineHeight: "20px", fontWeight: "800" }],
        body: ["13px", { lineHeight: "20px", fontWeight: "500" }],
        small: ["11.5px", { lineHeight: "16px", fontWeight: "600" }],
        // سلم خطوط لوحة القيادة (القيم من متغيرات CSS في globals.css)
        "t-xs": ["var(--font-xs)", { lineHeight: "1.45" }],
        "t-sm": ["var(--font-sm)", { lineHeight: "1.5" }],
        "t-md": ["var(--font-md)", { lineHeight: "1.5" }],
        "t-lg": ["var(--font-lg)", { lineHeight: "1.45" }],
        "t-xl": ["var(--font-xl)", { lineHeight: "1.35" }],
        "t-2xl": ["var(--font-2xl)", { lineHeight: "1.25" }],
        "t-3xl": ["var(--font-3xl)", { lineHeight: "1.15" }],
      },
      transitionDuration: {
        "150": "150ms",
        "200": "200ms",
        "250": "250ms",
      },
    },
  },
  plugins: [],
};
export default config;
