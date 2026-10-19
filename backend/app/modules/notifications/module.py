# modules/notifications/module.py — مركز الإشعارات (بلا صفحة قائمة جانبية — أيقونة جرس في الهيدر فقط)
from ...core.module_loader import ModuleInfo
from .api import router

MODULE = ModuleInfo(
    name="notifications", title="الإشعارات",
    router=router, prefix="/api/notifications",
    icon="fa-bell",
    nav_permissions=[],
)
