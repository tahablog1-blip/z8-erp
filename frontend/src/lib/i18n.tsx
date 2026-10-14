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
  "sec.settings": { ar: "الإعدادات", en: "Settings" },
  "nav.dashboard": { ar: "لوحة القيادة", en: "Dashboard" },
  "nav.sales": { ar: "نقطة البيع", en: "Point of Sale" },
  "nav.direct_sales": { ar: "البيع المباشر", en: "Direct Sales" },
  "nav.prepare": { ar: "إعداد أوامر العمل", en: "Prepare Work Orders" },
  "nav.service_notes": { ar: "مركز ملاحظات الخدمة", en: "Service Notes" },
  "nav.invoices": { ar: "سجل الفواتير", en: "Invoice Log" },
  "nav.cars": { ar: "خط الخدمة", en: "Service Line" },
  "nav.customers": { ar: "العملاء", en: "Customers" },
  "nav.products": { ar: "الأصناف", en: "Products" },
  "nav.inventory": { ar: "المخزون", en: "Inventory" },
  "nav.services": { ar: "الخدمات", en: "Services" },
  "nav.maintenance": { ar: "الصيانة", en: "Maintenance" },
  "nav.orders": { ar: "الطلبات", en: "Orders" },
  "nav.stocktake": { ar: "الجرد الفعلي", en: "Stocktake" },
  "nav.suppliers": { ar: "الموردون", en: "Suppliers" },
  "nav.purchases": { ar: "المشتريات", en: "Purchasing" },
  "nav.treasury": { ar: "الخزينة", en: "Treasury" },
  "nav.accounting": { ar: "الحسابات", en: "Accounting" },
  "nav.reports": { ar: "التقارير", en: "Reports" },
  "nav.branches": { ar: "الفروع", en: "Branches" },
  "nav.hr": { ar: "الموارد البشرية", en: "HR" },
  "nav.company": { ar: "المنشأة", en: "Company" },
  "nav.users": { ar: "المستخدمون والصلاحيات", en: "Users & Permissions" },
  "nav.cameras": { ar: "كاميرات المحطات", en: "Station Cameras" },
  "nav.printing": { ar: "الطباعة", en: "Printing" },
  "nav.system": { ar: "النظام", en: "System" },

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



  // Branches page
  "branches.title": { ar: "الفروع", en: "Branches" },
  "branches.name": { ar: "اسم الفرع", en: "Branch name" },
  "branches.lines": { ar: "خطوط السير", en: "Service lines" },
  "branches.hafrCapacity": { ar: "سعة الحفرة", en: "Pit capacity" },
  "branches.liftCapacity": { ar: "سعة الرافعات", en: "Lift capacity" },
  "branches.status": { ar: "الحالة", en: "Status" },
  "branches.frozen": { ar: "مجمّد", en: "Frozen" },
  "branches.active": { ar: "نشط", en: "Active" },
  "branches.bookingQR": { ar: "QR الحجز", en: "Booking QR" },
  "branches.edit": { ar: "تعديل", en: "Edit" },
  "branches.freeze": { ar: "تجميد", en: "Freeze" },
  "branches.unfreeze": { ar: "فك التجميد", en: "Unfreeze" },
  "branches.delete": { ar: "حذف", en: "Delete" },
  "branches.new": { ar: "+ فرع جديد", en: "+ New branch" },
  "branches.search": { ar: "بحث باسم الفرع...", en: "Search by branch name..." },
  "branches.empty": {
    ar: "لا توجد فروع بعد — أضف أول فرع",
    en: "No branches yet — add the first branch",
  },
  "branches.createTitle": { ar: "فرع جديد", en: "New branch" },
  "branches.editTitle": { ar: "تعديل الفرع", en: "Edit branch" },
  "branches.linesHint": {
    ar: "فرع واحد ممكن يكون فيه أكثر من سير — كل خط باسمه",
    en: "A branch can have multiple service lines, each with its own name",
  },
  "branches.addLineHint": {
    ar: "أضف خط سير جديد للفرع",
    en: "Add a new service line to the branch",
  },
  "branches.lineName": { ar: "اسم الخط", en: "Line name" },
  "branches.lineCapacity": { ar: "سعة الخط", en: "Line capacity" },
  "branches.capacityRafaat": { ar: "سعة الرافعات", en: "Lift capacity" },
  "branches.capacityHafr": { ar: "سعة الحفرة", en: "Pit capacity" },
  "branches.lineStatus": { ar: "حالة الخط", en: "Line status" },
  "branches.linePlaceholder": { ar: "سير", en: "Line" },
  "branches.deleteLine": { ar: "حذف الخط", en: "Remove line" },
  "branches.addLine": { ar: "+ إضافة خط سير", en: "+ Add service line" },
  "branches.cancel": { ar: "إلغاء", en: "Cancel" },
  "branches.save": { ar: "حفظ", en: "Save" },
  "branches.saving": { ar: "جارِ الحفظ...", en: "Saving..." },
  "branches.deleteConfirm": {
    ar: "إلغاء تفعيل الفرع",
    en: "Deactivate branch",
  },
  "branches.deleteMessage": {
    ar: "إلغاء تفعيل فرع",
    en: "Deactivate branch",
  },
  "branches.historyNote": {
    ar: "البيانات التاريخية المرتبطة به تبقى محفوظة.",
    en: "Historical data associated with it will be retained.",
  },
  "branches.qrTitle": { ar: "QR حجز الدور", en: "Queue booking QR" },
  "branches.bookBeforeArrival": {
    ar: "احجز دورك قبل الوصول 🚗",
    en: "Book your turn before arrival 🚗",
  },
  "branches.qrStep1": {
    ar: "امسح الكود بكاميرا جوالك",
    en: "Scan the code with your phone camera",
  },
  "branches.qrStep2": {
    ar: "سجّل بياناتك ولوحة سيارتك",
    en: "Enter your details and license plate",
  },
  "branches.qrStep3": {
    ar: "تابع دورك مباشرة من جوالك",
    en: "Track your turn directly on your phone",
  },
  "branches.qrStep4": {
    ar: "عند وصولك يتأكد دخولك تلقائياً ✨",
    en: "Your arrival will be confirmed automatically ✨",
  },
  "branches.print": { ar: "🖨 طباعة", en: "🖨 Print" },


  // Dashboard — Quick actions
  "dash.directSale": { ar: "بيع مباشر", en: "Direct sale" },
  "dash.serviceInvoice": { ar: "فاتورة خدمة", en: "Service invoice" },
  "dash.registerCar": { ar: "تسجيل سيارة", en: "Register car" },
  "dash.newProduct": { ar: "صنف جديد", en: "New product" },
  "dash.newCustomer": { ar: "عميل جديد", en: "New customer" },
  "dash.reports": { ar: "التقارير", en: "Reports" },
  "dash.newOrder": { ar: "طلب جديد", en: "New order" },
  "dash.newPurchase": { ar: "شراء جديد", en: "New purchase" },
  "dash.newSupplier": { ar: "مورد جديد", en: "New supplier" },
  "dash.newStocktake": { ar: "جرد جديد", en: "New stocktake" },
  "dash.newUser": { ar: "مستخدم جديد", en: "New user" },
  "dash.newBranch": { ar: "فرع جديد", en: "New branch" },
  "dash.newService": { ar: "خدمة جديدة", en: "New service" },
  "dash.newCamera": { ar: "كاميرا جديدة", en: "New camera" },
  "dash.newExpense": { ar: "مصاريف جديدة", en: "New expense" },
  "dash.newIncome": { ar: "دخل جديد", en: "New income" },
  "dash.newPayment": { ar: "دفعة جديدة", en: "New payment" },
  "dash.newTransfer": { ar: "تحويل جديد", en: "New transfer" },

  // Dashboard — AI center
  "dash.welcome": {
    ar: "أهلاً",
    en: "Welcome",
  },
  "dash.manager": {
    ar: "المدير",
    en: "Manager",
  },
  "dash.liveDashboard": {
    ar: "لوحة القيادة الحية",
    en: "Live Dashboard",
  },
  "dash.openShift": {
    ar: "وردية مفتوحة",
    en: "Open Shift",
  },
  "dash.openShiftAction": {
    ar: "افتح وردية",
    en: "Open Shift",
  },
  "dash.askYourData": { ar: "اسأل بياناتك", en: "Ask your data" },
  "dash.aiPlaceholder": {
    ar: "مثال: أكتر 5 أصناف مبيعاً الشهر ده؟",
    en: "Example: What are the top 5 best-selling products this month?",
  },
  "dash.ask": { ar: "اسأل", en: "Ask" },
  "dash.morningBrief": { ar: "الملخص الصباحي", en: "Morning brief" },
  "dash.refresh": { ar: "تحديث", en: "Refresh" },
  "dash.preparing": { ar: "جارِ التحضير...", en: "Preparing..." },
  "dash.anomalyDetection": {
    ar: "كشف الشذوذ المالي",
    en: "Financial anomaly detection",
  },
  "dash.checkNow": { ar: "افحص الآن", en: "Check now" },
  "dash.checking": { ar: "جارِ الفحص...", en: "Checking..." },

  // Dashboard — KPIs and charts
  "dash.profitToday": {
    ar: "ربح اليوم (قبل المصاريف)",
    en: "Today's profit (before expenses)",

  },
  "dash.profitMonth": {
    ar: "ربح الشهر (قبل المصاريف)",
    en: "This month's profit (before expenses)",
  },
  "dash.lowStock": { ar: "صنف تحت الحد الأدنى", en: "Low stock items" },
  "dash.creditOutstanding": { ar: "آجل غير محصل", en: "Outstanding credit" },
  "dash.carsQueued": { ar: "سيارة في الطابور", en: "Cars in queue" },
  "dash.avgInvoice": { ar: "متوسط الفاتورة", en: "Average invoice" },
  "dash.monthRevenue": { ar: "إيراد الشهر", en: "Monthly revenue" },
  "dash.dailyRevenue14": {
    ar: "الإيراد اليومي — 14 يوم",
    en: "Daily revenue — 14 days",
  },
  "dash.revenue": { ar: "الإيراد", en: "Revenue" },
  "dash.average7Days": { ar: "متوسط 7 أيام", en: "7-day average" },
  "dash.operatingCapacity": {
    ar: "طاقة التشغيل اليوم",
    en: "Today's operating capacity",
  },
  "dash.paymentMethodsMonth": {
    ar: "طرق الدفع — الشهر",
    en: "Payment methods — month",
  },
  "dash.noPayments": {
    ar: "لا توجد مدفوعات بعد",
    en: "No payments yet",
  },
  "dash.bestSellingMonth": {
    ar: "الأكثر مبيعاً — الشهر",
    en: "Best-selling products — month",
  },
  "dash.newCustomers": { ar: "العملاء الجدد", en: "New customers" },
  "dash.topSuppliersMonth": {
    ar: "أفضل الموردين — الشهر",
    en: "Top suppliers — month",
  },
  "dash.topCustomers": {
    ar: "العملاء الأكثر زيارة",
    en: "Most frequent customers",
  },
  "dash.noCustomersYet": {
    ar: "لا يوجد بعد",
    en: "None yet",
  },
  "dash.todaySales": { ar: "مبيعات اليوم", en: "Today's Sales" },
  "dash.todayInvoices": {
    ar: "فواتير اليوم",
    en: "Today's Invoices",
  },
 
  "dash.week": { ar: "أسبوع", en: "Week" },
  "dash.month": { ar: "الشهر", en: "Month" },
  "dash.monthVat": { ar: "ضريبة الشهر", en: "Monthly VAT" },

  "dash.visits": { ar: "زيارة", en: "visits" },
  "dash.recentInvoices": {
    ar: "آخر الفواتير — مباشر",
    en: "Recent invoices — live",
  },
  "dash.fullHistory": { ar: "السجل الكامل", en: "Full history" },
  "dash.cashSale": { ar: "بيع نقدي", en: "Cash sale" },
  "dash.returned": { ar: "مرتجعة", en: "Returned" },
  "dash.sar": { ar: " ر.س", en: " SAR" },

  // Dashboard — Shared labels
  "dash.invoice": { ar: "فاتورة", en: "invoice" },
  "dash.invoices": { ar: "فواتير", en: "invoices" },
  "dash.waiting": { ar: "انتظار", en: "waiting" },
  "dash.inService": { ar: "خدمة", en: "in service" },
  "dash.completed": { ar: "اكتملت", en: "completed" },
  "dash.peak": { ar: "قمة", en: "Peak" },
  "dash.new": { ar: "جديد", en: "New" },
  "dash.noData": {
    ar: "لا توجد بيانات بعد",
    en: "No data yet",
  },


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
  "الخدمات": "nav.services",
  "الصيانة": "nav.maintenance",
  "الطلبات": "nav.orders",
  "الجرد الفعلي": "nav.stocktake",
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
  "الرئيسية": "sec.home", "العمليات": "sec.ops", "المخزون والمشتريات": "sec.stock", "المالية": "sec.finance",
  "الإدارة": "sec.admin", "الإعدادات": "sec.settings",

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
