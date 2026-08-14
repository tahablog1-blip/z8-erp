"""موديول العملاء — سجل العملاء (أفراد/شركات) + أسطول سياراتهم + كشف الحساب.

عميل واحد ممكن يملك أكتر من سيارة (customer_vehicles) — رقم اللوحة بيتربط
بالعميل عشان البحث والتعبئة التلقائية في نقطة البيع وشاشة تسجيل السيارات.
كشف الحساب (customer_ledger) هو سجل الذمم المدينة: بيع آجل يزوّد الرصيد،
سداد أو مرتجع يقلّله.
"""
from .api import router

MODULE = {
    "name": "customers",
    "label": "العملاء",
    "router": router,
    "prefix": "/customers",
    "nav": [
        {
            "path": "/customers",
            "label": "العملاء",
            "icon": "users",
            "perms": ["customers.create", "customers.edit", "customers.view_statement"],
        }
    ],
}
