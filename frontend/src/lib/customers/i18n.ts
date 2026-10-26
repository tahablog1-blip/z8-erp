"use client";
// lib/customers/i18n.ts — نصوص صفحة العملاء (عربي/إنجليزي)
import { useLang } from "@/lib/i18n";

const C = {
  "title": ["العملاء", "Customers"],
  "subtitle": ["إدارة بيانات العملاء والحسابات والمبيعات والمديونيات.", "Manage customers, accounts, sales and receivables."],
  "add": ["إضافة عميل", "Add customer"], "export": ["تصدير", "Export"], "exportCsv": ["Excel / CSV", "Excel / CSV"], "exportPdf": ["طباعة / PDF", "Print / PDF"],
  "search": ["ابحث بالاسم أو الجوال أو البريد أو رقم الفاتورة أو اللوحة…", "Search name, phone, email, invoice no., plate…"],
  "filters": ["فلاتر متقدمة", "Advanced filters"], "clearAll": ["مسح الكل", "Clear all"], "apply": ["تطبيق", "Apply"],
  "kpi.total": ["إجمالي العملاء", "Total customers"], "kpi.active": ["العملاء النشطون", "Active customers"], "kpi.new": ["العملاء الجدد", "New customers"],
  "kpi.sales": ["إجمالي المبيعات", "Total sales"], "kpi.receivables": ["إجمالي المستحقات", "Receivables"], "kpi.overdue": ["المتأخرات", "Overdue"], "kpi.avg": ["متوسط قيمة العميل", "Avg. customer value"],
  "kpi.active.tip": ["عملاء لديهم فواتير خلال الفترة", "Customers with invoices in the period"], "kpi.new.tip": ["عملاء أُضيفوا خلال الفترة", "Customers added in the period"],
  "kpi.overdue.tip": ["مستحقات مر عليها أكثر من 30 يوماً", "Balances older than 30 days"], "kpi.avg.tip": ["مبيعات الفترة ÷ العملاء النشطين", "Period sales ÷ active customers"],
  "col.customer": ["العميل", "Customer"], "col.phone": ["الجوال", "Phone"], "col.type": ["النوع", "Type"], "col.last": ["آخر تعامل", "Last activity"],
  "col.sales": ["المبيعات", "Sales"], "col.paid": ["المدفوع", "Paid"], "col.balance": ["المستحق", "Due"], "col.status": ["الحالة", "Status"],
  "col.invoices": ["الفواتير", "Invoices"], "col.vehicles": ["السيارات", "Vehicles"], "col.created": ["تاريخ التسجيل", "Registered"], "col.actions": ["الإجراءات", "Actions"],
  "columns": ["الأعمدة", "Columns"], "density": ["الكثافة", "Density"], "compact": ["مضغوط", "Compact"], "comfortable": ["مريح", "Comfortable"],
  "individual": ["فرد", "Individual"], "company": ["شركة", "Company"],
  "st.active": ["نشط", "Active"], "st.inactive": ["غير نشط", "Inactive"], "st.new": ["جديد", "New"], "st.overdue": ["متأخر", "Overdue"], "st.disabled": ["معطّل", "Disabled"],
  "seg.vip": ["VIP", "VIP"], "seg.new": ["جديد", "New"], "seg.at_risk": ["معرّض للفقد", "At risk"], "seg.inactive": ["خامل", "Inactive"], "seg.regular": ["منتظم", "Regular"], "seg.no_activity": ["بدون تعاملات", "No activity"],
  "seg.credit": ["آجل", "Credit"],
  "f.status": ["حالة العميل", "Customer status"], "f.type": ["نوع العميل", "Customer type"], "f.segment": ["الشريحة", "Segment"], "f.pay": ["نمط الدفع", "Payment pattern"],
  "f.all": ["الكل", "All"], "f.cash": ["نقدي فقط", "Cash only"], "f.credit": ["لديه مبيعات آجلة", "Has credit sales"],
  "f.hasBalance": ["لديه رصيد مستحق", "Has outstanding balance"], "f.overdue": ["متأخر السداد", "Overdue"], "f.noActivity": ["بدون تعاملات", "No transactions"],
  "f.reg": ["تاريخ التسجيل", "Registration date"], "f.last": ["آخر عملية شراء", "Last purchase"], "f.sales": ["نطاق المبيعات", "Sales range"], "f.bal": ["نطاق الرصيد المستحق", "Balance range"],
  "from": ["من", "From"], "to": ["إلى", "To"], "min": ["الأدنى", "Min"], "max": ["الأعلى", "Max"],
  "selected": ["محدد", "selected"], "bulk.deactivate": ["تعطيل", "Deactivate"], "bulk.activate": ["تفعيل", "Activate"], "bulk.print": ["طباعة", "Print"], "bulk.export": ["تصدير المحدد", "Export selected"],
  "rows": ["صف/صفحة", "rows/page"], "prev": ["السابق", "Previous"], "next": ["التالي", "Next"], "of": ["من", "of"],
  "empty.title": ["لا يوجد عملاء حتى الآن", "No customers yet"], "empty.desc": ["أضف أول عميل لبدء إدارة المبيعات والحسابات.", "Add your first customer to start managing sales and accounts."],
  "noResults": ["لم يتم العثور على نتائج", "No results found"], "noResults.desc": ["جرب تغيير كلمات البحث أو الفلاتر.", "Try changing your search terms or filters."],
  "loadFail": ["تعذر تحميل بيانات العملاء", "Could not load customers"], "retry": ["إعادة المحاولة", "Retry"],
  "view": ["فتح الملف", "Open profile"], "edit": ["تعديل", "Edit"], "newInvoice": ["فاتورة جديدة", "New invoice"], "pay": ["تسجيل دفعة", "Receive payment"], "more": ["المزيد", "More"],
  "call": ["اتصال", "Call"], "whatsapp": ["واتساب", "WhatsApp"], "none": ["—", "—"],
} as const;
export type CKey = keyof typeof C;
export function useCx() {
  const { lang } = useLang();
  const i = lang === "en" ? 1 : 0;
  return { c: (k: CKey): string => C[k][i], isEn: i === 1 };
}
