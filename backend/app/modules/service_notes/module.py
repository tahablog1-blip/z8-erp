# modules/service_notes/module.py — تعريف الموديول للمحمّل الآلي
from ...core.module_loader import ModuleInfo
from .api import router

MODULE = ModuleInfo(
    name="service_notes", title="مركز ملاحظات الخدمة",
    router=router, prefix="/api/service-notes",
    icon="fa-clipboard-list",
    nav_permissions=["service_notes.view", "service_notes.create", "service_notes.manage"],
)
