// modules/registry.ts — سجل موديولات الواجهة: القائمة الجانبية بتتبني من هنا
// منظّمة معمارياً في أقسام واضحة لكل الموظفين والإداريين
export type NavModule = {
  path: string;            // مسار الصفحة
  title: string;           // الاسم الظاهر
  icon: string;            // رمز القائمة
  section: string;         // القسم المعماري في القائمة الجانبية
  permissions: string[];   // فاضية = للجميع؛ الأدمن يشوف الكل دايماً
  adminOnly?: boolean;     // true = لمدير النظام (admin) وحده — لا تظهر لأي موظف
};

export const NAV_SECTIONS = ["الرئيسية", "العمليات", "المخزون والمشتريات", "المالية", "الإدارة", "الإعدادات"] as const;

// أيقونة كل قسم رئيسي
export const SECTION_ICONS: Record<string, string> = {
  "العمليات": "sec_ops",
  "المخزون والمشتريات": "sec_stock",
  "المالية": "sec_finance",
  "الإدارة": "sec_admin",
  "الإعدادات": "sec_admin",
};

export const NAV_MODULES: NavModule[] = [
  // ── الرئيسية (خارج القوائم المنسدلة — دايماً ظاهرة) ──
  { path: "/dashboard",     title: "لوحة القيادة",   icon: "dashboard", section: "الرئيسية", permissions: [], adminOnly: true },
  { path: "/sales",         title: "نقطة بيع الخدمة", icon: "sales", section: "الرئيسية", permissions: ["invoices.create", "invoices.create_service"] },
  { path: "/sales/direct",  title: "البيع المباشر",   icon: "sales", section: "الرئيسية", permissions: ["invoices.create", "invoices.create_direct"] },

  // ── العمليات اليومية ──
  { path: "/prepare",       title: "إعداد أوامر العمل", icon: "invoices", section: "العمليات", permissions: ["invoices.prepare"] },
  { path: "/service-notes", title: "مركز ملاحظات الخدمة", icon: "invoices", section: "العمليات", permissions: ["service_notes.view", "service_notes.create", "service_notes.manage"] },
  { path: "/sales/history", title: "سجل الفواتير",   icon: "invoices", section: "العمليات", permissions: ["invoices.view_today", "invoices.view_all"] },
  { path: "/cars",          title: "خط الخدمة",      icon: "car", section: "العمليات", permissions: ["cars.create", "cars.confirm_entry", "cars.confirm_exit"] },
  { path: "/customers",     title: "العملاء",        icon: "customers", section: "العمليات", permissions: ["customers.create", "customers.edit", "customers.view_statement"] },

  // ── المخزون والمشتريات ──
  { path: "/products",   title: "الأصناف",        icon: "products", section: "المخزون والمشتريات", permissions: ["products.create", "products.edit", "products.view_stock"] },
  { path: "/inventory",  title: "المخزون",        icon: "inventory", section: "المخزون والمشتريات", permissions: ["products.view_stock"] },
  { path: "/suppliers",  title: "الموردون",       icon: "suppliers", section: "المخزون والمشتريات", permissions: ["purchasing.suppliers"] },
  { path: "/purchases",  title: "المشتريات",      icon: "purchases", section: "المخزون والمشتريات", permissions: ["purchasing.invoices"] },

  // ── المالية ──
  { path: "/treasury",   title: "الخزينة",        icon: "treasury", section: "المالية", permissions: ["treasury.view", "treasury.create"] },
  { path: "/accounting", title: "الحسابات",       icon: "accounting", section: "المالية", permissions: ["accounting.view_reports"] },
  { path: "/reports",    title: "التقارير",       icon: "reports", section: "المالية", permissions: ["reports.sales", "accounting.view_vat"] },

  // ── الإدارة ──
  { path: "/branches",   title: "الفروع",         icon: "branches", section: "الإدارة", permissions: ["branches.manage"] },
  { path: "/hr",         title: "الموارد البشرية", icon: "hr", section: "الإدارة", permissions: ["hr.view", "hr.manage", "hr.attendance", "hr.leave_approve", "hr.violations", "hr.payroll"] },

  // ── الإعدادات — كل قسم صفحة كاملة مستقلة ──
  { path: "/settings/company",  title: "المنشأة",                icon: "settings", section: "الإعدادات", permissions: ["settings.company"] },
  { path: "/settings/users",    title: "المستخدمون والصلاحيات",  icon: "settings", section: "الإعدادات", permissions: ["settings.users"] },
  { path: "/settings/cameras",  title: "كاميرات المحطات",        icon: "settings", section: "الإعدادات", permissions: ["settings.company"] },
  { path: "/settings/printing", title: "الطباعة",                icon: "settings", section: "الإعدادات", permissions: [], adminOnly: true },
  { path: "/settings/system",   title: "النظام",                 icon: "settings", section: "الإعدادات", permissions: [], adminOnly: true },
];
