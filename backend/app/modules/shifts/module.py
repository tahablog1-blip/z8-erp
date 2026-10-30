# modules/shifts/module.py — تعريف الموديول للمحمّل الآلي
from ...core.module_loader import ModuleInfo
from .api import router

MODULE = ModuleInfo(
    name="shifts", title="الجلسات",
    router=router, prefix="/api/shifts",
    icon="fa-clock",
    # القائمة الجانبية لشاشة المبيعات موحّدة مع موديول الفواتير — مفيش عنصر
    # مستقل هنا (المبيعات صفحة واحدة تجمع الجلسة + الطابور + الفوترة).
    nav_permissions=[],
)
