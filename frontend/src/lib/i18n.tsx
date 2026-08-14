"use client";
// lib/i18n.tsx — بنية الترجمة العربية/الإنجليزية
// المرحلة 1: الهيكل الرئيسي (القوائم، الشريط العلوي، العناصر المشتركة)
// الشاشات الداخلية تُترجم تباعاً بإضافة مفاتيحها هنا واستدعاء t()
import { createContext, useContext, useEffect, useState } from "react";

export type Lang = "ar" | "en";

const DICT: Record<string, { ar: string; en: string }> = {
  // ── الأقسام ──
  "sec.home": { ar: "الرئيسية", en: "Home" },
  "sec.ops": { ar: "العمليات", en: "Operations" },
  "sec.stock": { ar: "المخزون والمشتريات", en: "Inventory & Purchasing" },
  "sec.finance": { ar: "المالية", en: "Finance" },
  "sec.admin": { ar: "الإدارة", en: "Administration" },
  // ── الشاشات ──
  "nav.dashboard": { ar: "لوحة القيادة", en: "Dashboard" },
  "nav.sales": { ar: "نقطة البيع", en: "Point of Sale" },
  "nav.invoices": { ar: "سجل الفواتير", en: "Invoice Log" },
  "nav.cars": { ar: "خط الخدمة", en: "Service Line" },
  "nav.customers": { ar: "العملاء", en: "Customers" },
  "nav.products": { ar: "الأصناف", en: "Products" },
  "nav.inventory": { ar: "المخزون", en: "Inventory" },
  "nav.suppliers": { ar: "الموردون", en: "Suppliers" },
  "nav.purchases": { ar: "المشتريات", en: "Purchasing" },
  "nav.treasury": { ar: "الخزينة", en: "Treasury" },
  "nav.accounting": { ar: "الحسابات", en: "Accounting" },
  "nav.reports": { ar: "التقارير", en: "Reports" },
  "nav.branches": { ar: "الفروع", en: "Branches" },
  "nav.hr": { ar: "الموارد البشرية", en: "HR" },
  "nav.settings": { ar: "الإعدادات", en: "Settings" },
  // ── الشريط العلوي والمشترك ──
  "top.logout": { ar: "خروج", en: "Logout" },
  "top.dark": { ar: "الوضع الليلي", en: "Dark mode" },
  "top.light": { ar: "الوضع النهاري", en: "Light mode" },
  "common.save": { ar: "حفظ", en: "Save" },
  "common.cancel": { ar: "إلغاء", en: "Cancel" },
  "common.close": { ar: "إغلاق", en: "Close" },
  "common.search": { ar: "بحث...", en: "Search..." },
  "common.print": { ar: "طباعة", en: "Print" },
  "common.loading": { ar: "جارِ التحميل...", en: "Loading..." },
};

// عناوين السجل (القائمة الجانبية) بالعربي → مفاتيح
export const NAV_TITLE_KEYS: Record<string, string> = {
  "لوحة القيادة": "nav.dashboard", "نقطة البيع": "nav.sales", "سجل الفواتير": "nav.invoices", "خط الخدمة": "nav.cars",
  "العملاء": "nav.customers", "الأصناف": "nav.products", "المخزون": "nav.inventory",
  "الموردون": "nav.suppliers", "المشتريات": "nav.purchases", "الخزينة": "nav.treasury",
  "الحسابات": "nav.accounting", "التقارير": "nav.reports", "الفروع": "nav.branches",
  "الموارد البشرية": "nav.hr", "الإعدادات": "nav.settings",
};
export const SECTION_TITLE_KEYS: Record<string, string> = {
  "الرئيسية": "sec.home", "العمليات": "sec.ops", "المخزون والمشتريات": "sec.stock",
  "المالية": "sec.finance", "الإدارة": "sec.admin",
};

const LangCtx = createContext<{ lang: Lang; setLang: (l: Lang) => void; t: (k: string, fallback?: string) => string }>({
  lang: "ar", setLang: () => {}, t: (k, f) => f || k,
});

export function LangProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<Lang>("ar");

  useEffect(() => {
    const saved = (localStorage.getItem("z8_lang") as Lang) || "ar";
    applyLang(saved);
  }, []);

  function applyLang(l: Lang) {
    setLangState(l);
    localStorage.setItem("z8_lang", l);
    document.documentElement.lang = l;
    // الاتجاه ثابت RTL حالياً — بيتقلب LTR فقط بعد اكتمال ترجمة كل الشاشات
    document.documentElement.dir = "rtl";
  }

  const t = (k: string, fallback?: string) => DICT[k]?.[lang] ?? fallback ?? k;
  return <LangCtx.Provider value={{ lang, setLang: applyLang, t }}>{children}</LangCtx.Provider>;
}

export const useLang = () => useContext(LangCtx);
