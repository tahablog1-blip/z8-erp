# modules/settings/module.py — إعدادات المنشأة
from ...core.module_loader import ModuleInfo
from .api import router

MODULE = ModuleInfo(
    name="settings", title="الإعدادات",
    router=router, prefix="/api/settings",
    icon="fa-gear",
    nav_permissions=["settings.company", "settings.users"],
)
