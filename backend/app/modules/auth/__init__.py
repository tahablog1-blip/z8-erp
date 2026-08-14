"""موديول المصادقة — تسجيل الدخول والهوية وكتالوج الصلاحيات."""
from .api import router

MODULE = {
    "name": "auth",
    "label": "المصادقة",
    "router": router,
    "prefix": "/auth",
    "nav": [],  # مالوش عناصر قائمة — خدمة أساسية للنظام كله
}
