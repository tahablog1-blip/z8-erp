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
        card: "0 1px 2px rgba(15,23,42,.04), 0 2px 8px rgba(15,23,42,.04)",
        panel: "0 20px 45px rgba(15,23,42,.14)",
      },
      borderRadius: { card: "16px" },
    },
  },
  plugins: [],
};
export default config;
