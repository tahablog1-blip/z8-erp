import type { Config } from "tailwindcss";

/** رموز هوية Z8 — الألوان متغيرات CSS عشان دعم الوضع الليلي (globals.css) */
const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink:      { DEFAULT: "var(--ink)", 2: "var(--ink2)", 3: "var(--ink3)", 4: "var(--ink4)" },
        petrol:   { DEFAULT: "var(--petrol)", deep: "var(--petrol-deep)", soft: "var(--petrol-soft)" },
        brass:    { DEFAULT: "var(--brass)", soft: "var(--brass-soft)" },
        emerald:  { DEFAULT: "var(--emerald)", bg: "var(--emerald-bg)" },
        ember:    { DEFAULT: "var(--ember)", bg: "var(--ember-bg)" },
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
        sm: "6px",
        DEFAULT: "8px",
        md: "8px",
        lg: "12px",
        xl: "16px",
        card: "16px",
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
