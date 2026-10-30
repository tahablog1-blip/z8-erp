"""موديول الجلسات — فتح/إغلاق جلسة الكاشير + تقرير مفصّل عند الإغلاق.

كل فاتورة POS لازم تكون مربوطة بجلسة مفتوحة (شرط في موديول الفواتير)،
عشان يبقى فيه تسوية نقدية واضحة في نهاية كل جلسة: عهدة البداية + التحصيل
النقدي − مرتجعات نقدية = النقد المتوقع في الدرج، مقارنة بالمعدود فعلياً.
"""
from .api import router

MODULE = {
    "name": "shifts",
    "label": "الجلسات",
    "router": router,
    "prefix": "/shifts",
    "nav": [
        {
            "path": "/sales",
            "label": "المبيعات",
            "icon": "receipt",
            "perms": ["shifts.manage_own", "invoices.create", "invoices.view_today", "invoices.view_all"],
        }
    ],
}
