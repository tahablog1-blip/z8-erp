"use client";
// lib/i18n.tsx — بنية الترجمة العربية/الإنجليزية
import { createContext, useContext, useEffect, useState } from "react";

export type Lang = "ar" | "en";

const DICT: Record<string, { ar: string; en: string }> = {
  "sec.home": { ar: "الرئيسية", en: "Home" },
  "sec.ops": { ar: "العمليات", en: "Operations" },
  "sec.stock": { ar: "المخزون والمشتريات", en: "Inventory & Purchasing" },
  "sec.finance": { ar: "المالية", en: "Finance" },
  "sec.admin": { ar: "الإدارة", en: "Administration" },
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
  "top.logout": { ar: "خروج", en: "Logout" },
  "top.dark": { ar: "الوضع الليلي", en: "Dark mode" },
  "top.light": { ar: "الوضع النهاري", en: "Light mode" },
  "common.save": { ar: "حفظ", en: "Save" },
  "common.cancel": { ar: "إلغاء", en: "Cancel" },
  "common.close": { ar: "إغلاق", en: "Close" },
  "common.search": { ar: "بحث...", en: "Search..." },
  "common.print": { ar: "طباعة", en: "Print" },
  "common.loading": { ar: "جارِ التحميل...", en: "Loading..." },
  "common.edit": { ar: "تعديل", en: "Edit" },
  "common.delete": { ar: "حذف", en: "Delete" },
  "common.add": { ar: "إضافة", en: "Add" },
  "common.yes": { ar: "نعم", en: "Yes" },
  "common.no": { ar: "لا", en: "No" },
  "common.back": { ar: "رجوع", en: "Back" },
  "common.next": { ar: "التالي", en: "Next" },
  "common.confirm": { ar: "تأكيد", en: "Confirm" },
  "common.error": { ar: "حدث خطأ", en: "An error occurred" },
  "common.success": { ar: "تم بنجاح", en: "Success" },
  "common.required": { ar: "هذا الحقل مطلوب", en: "This field is required" },
  "common.noData": { ar: "لا توجد بيانات بعد", en: "No data yet" },
  "common.noResults": { ar: "لا توجد نتائج مطابقة للبحث", en: "No matching results" },
  "login.title": { ar: "تسجيل الدخول", en: "Sign in" },
  "login.subtitle": { ar: "منصة إدارة مصدر الزيوت", en: "Masdar Al-Zuyout Management Platform" },
  "login.username": { ar: "اسم المستخدم", en: "Username" },
  "login.password": { ar: "كلمة المرور", en: "Password" },
  "login.submit": { ar: "دخول", en: "Sign in" },
  "login.loading": { ar: "جارِ الدخول...", en: "Signing in..." },
  "login.error": { ar: "اسم المستخدم أو كلمة المرور غير صحيحة", en: "Invalid username or password" },
  "sec.settings": { ar: "الإعدادات", en: "Settings" },
  "nav.direct_sales": { ar: "البيع المباشر", en: "Direct Sales" },
  "nav.prepare": { ar: "إعداد أوامر العمل", en: "Work Orders Prep" },
  "nav.service_notes": { ar: "مركز ملاحظات الخدمة", en: "Service Notes Center" },
  "nav.company": { ar: "المنشأة", en: "Company" },
  "nav.users": { ar: "المستخدمون والصلاحيات", en: "Users & Permissions" },
  "nav.cameras": { ar: "كاميرات المحطات", en: "Station Cameras" },
  "nav.printing": { ar: "الطباعة", en: "Printing" },
  "nav.system": { ar: "النظام", en: "System" },
};

// عناوين السجل (القائمة الجانبية) بالعربي → مفاتيح

export const NAV_TITLE_KEYS: Record<string, string> = {
  "لوحة القيادة": "nav.dashboard",
  "نقطة البيع": "nav.sales",
  "نقطة بيع الخدمة": "nav.sales",
  "البيع المباشر": "nav.direct_sales",
  "سجل الفواتير": "nav.invoices",
  "إعداد أوامر العمل": "nav.prepare",
  "مركز ملاحظات الخدمة": "nav.service_notes",
  "خط الخدمة": "nav.cars",
  "العملاء": "nav.customers",
  "الأصناف": "nav.products",
  "المخزون": "nav.inventory",
  "الموردون": "nav.suppliers",
  "المشتريات": "nav.purchases",
  "الخزينة": "nav.treasury",
  "الحسابات": "nav.accounting",
  "التقارير": "nav.reports",
  "الفروع": "nav.branches",
  "الموارد البشرية": "nav.hr",
  "المنشأة": "nav.company",
  "المستخدمون والصلاحيات": "nav.users",
  "كاميرات المحطات": "nav.cameras",
  "الطباعة": "nav.printing",
  "النظام": "nav.system",
  "الإعدادات": "nav.settings",
};

export const SECTION_TITLE_KEYS: Record<string, string> = {
  "الرئيسية": "sec.home", "العمليات": "sec.ops", "المخزون والمشتريات": "sec.stock",
  "المالية": "sec.finance", "الإدارة": "sec.admin",
};

const LangCtx = createContext<{ lang: Lang; setLang: (l: Lang) => void; t: (k: string, fallback?: string) => string }>({
  lang: "ar", setLang: () => { }, t: (k, f) => f || k,
});

export function LangProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<Lang>("ar");

  useEffect(() => {
    const saved = (localStorage.getItem("z8_lang") as Lang) || "ar";
    applyLang(saved);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function applyLang(l: Lang) {
    setLangState(l);
    localStorage.setItem("z8_lang", l);
    document.documentElement.lang = l;
    document.documentElement.dir = l === "en" ? "ltr" : "rtl";
  }

  const t = (k: string, fallback?: string) => DICT[k]?.[lang] ?? fallback ?? k;
  return <LangCtx.Provider value={{ lang, setLang: applyLang, t }}>{children}</LangCtx.Provider>;
}

export const useLang = () => useContext(LangCtx);
