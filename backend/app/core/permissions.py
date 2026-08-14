# core/permissions.py — كتالوج الصلاحيات الموحّد
# نفس مفاتيح النظام القديم بالحرف (عشان عمود users.permissions الحالي يشتغل كما هو)،
# والواجهة بتبني شبكة صلاحيات الموظفين من هنا مباشرة عبر GET /api/auth/permissions-catalog
PERMISSIONS = [
    {"group": "خط الخدمة (الدور)", "items": [
        {"key": "cars.create",        "label": "تسجيل سيارة جديدة"},
        {"key": "cars.confirm_entry", "label": "تأكيد الدخول"},
        {"key": "cars.confirm_exit",  "label": "تأكيد الخروج"},
        {"key": "cars.notify",        "label": "إرسال إشعار واتساب يدوي"},
        {"key": "cars.edit",          "label": "تعديل بيانات سيارة"},
        {"key": "cars.delete",        "label": "حذف سيارة"},
    ]},
    {"group": "الفواتير ونقطة البيع", "items": [
        {"key": "invoices.prepare",         "label": "تجهيز فاتورة وإرسالها للكاشير"},
        {"key": "invoices.create",          "label": "إصدار فواتير — صلاحية شاملة (النوعان)"},
        {"key": "invoices.discount_cashier",    "label": "خصم حتى 5% — كاشير"},
        {"key": "invoices.discount_supervisor", "label": "خصم حتى 20% — مشرف"},
        {"key": "invoices.discount_manager",    "label": "خصم بلا حد — مدير"},
        {"key": "invoices.price_override",      "label": "تعديل سعر الصنف يدوياً وقت البيع"},
        {"key": "audit.view",                   "label": "عرض سجل التدقيق"},
        {"key": "invoices.create_service",  "label": "كاشير الخدمة — فوترة سيارات الطابور فقط"},
        {"key": "invoices.create_direct",   "label": "كاشير البيع المباشر فقط"},
        {"key": "invoices.view_pending",    "label": "شاشة الفواتير المعلقة"},
        {"key": "invoices.view_today",      "label": "فواتير اليوم"},
        {"key": "invoices.view_all",        "label": "كل الفواتير"},
        {"key": "invoices.edit_items",      "label": "تعديل أصناف فاتورة"},
        {"key": "invoices.return",          "label": "عمل مرتجع"},
        {"key": "invoices.resend_whatsapp", "label": "إعادة إرسال واتساب"},
        {"key": "invoices.delete",          "label": "حذف فاتورة"},
    ]},
    {"group": "العملاء", "items": [
        {"key": "customers.create",         "label": "إضافة عميل"},
        {"key": "customers.edit",           "label": "تعديل عميل"},
        {"key": "customers.view_statement", "label": "كشف حساب العميل"},
        {"key": "customers.record_payment", "label": "تسجيل سداد"},
        {"key": "customers.delete",         "label": "حذف عميل"},
    ]},
    {"group": "الأصناف والمخزون", "items": [
        {"key": "products.create",     "label": "إضافة صنف"},
        {"key": "products.edit",       "label": "تعديل صنف"},
        {"key": "products.delete",     "label": "حذف صنف"},
        {"key": "products.view_stock", "label": "أرصدة المخزون"},
        {"key": "products.import",     "label": "استيراد من إكسيل"},
        {"key": "inventory.request",    "label": "طلب أصناف لفرعي"},
        {"key": "inventory.approve_requests", "label": "الموافقة على طلبات الفروع"},
    ]},
    {"group": "المشتريات والموردون", "items": [
        {"key": "purchasing.suppliers",  "label": "إدارة الموردين"},
        {"key": "purchasing.quotations", "label": "طلبات عروض الأسعار"},
        {"key": "purchasing.orders",     "label": "أوامر الشراء والطلبيات"},
        {"key": "purchasing.invoices",   "label": "فواتير المشتريات"},
    ]},
    {"group": "الحسابات", "items": [
        {"key": "accounting.view_reports", "label": "التقارير المحاسبية"},
        {"key": "accounting.view_vat",     "label": "الإقرار الضريبي"},
        {"key": "treasury.view",           "label": "عرض سندات الخزينة"},
        {"key": "treasury.create",         "label": "إنشاء سندات قبض وصرف"},
    ]},
    {"group": "التقارير", "items": [
        {"key": "reports.sales",    "label": "تقرير المبيعات"},
        {"key": "reports.cashiers", "label": "تقرير الكاشيرات"},
    ]},
    {"group": "الورديات", "items": [
        {"key": "shifts.manage_own",  "label": "إدارة ورديتي"},
        {"key": "shifts.view_branch", "label": "ورديات الفرع"},
    ]},
    {"group": "الموارد البشرية", "items": [
        {"key": "hr.view",          "label": "عرض الموظفين"},
        {"key": "hr.manage",        "label": "إدارة الموظفين"},
        {"key": "hr.attendance",    "label": "الحضور والانصراف"},
        {"key": "hr.leave_approve", "label": "اعتماد الإجازات"},
        {"key": "hr.violations",    "label": "المخالفات والإنذارات"},
        {"key": "hr.payroll",       "label": "الرواتب"},
    ]},
    {"group": "الإدارة والإعدادات", "items": [
        {"key": "branches.manage",  "label": "إدارة الفروع"},
        {"key": "settings.company", "label": "بيانات الشركة والمظهر"},
        {"key": "settings.users",   "label": "إدارة حسابات الموظفين"},
        {"key": "settings.whatsapp","label": "إعدادات واتساب"},
        {"key": "support.manage",   "label": "إدارة تذاكر الدعم"},
    ]},
]

ALL_KEYS = [item["key"] for g in PERMISSIONS for item in g["items"]]
