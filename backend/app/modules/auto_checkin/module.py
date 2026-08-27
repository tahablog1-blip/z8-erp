# modules/auto_checkin/module.py — تعريف الموديول للمحمّل الآلي
from ...core.module_loader import ModuleInfo
from .api import router

MODULE = ModuleInfo(
    name="auto_checkin", title="البوابة الذكية",
    router=router, prefix="/api/auto-checkin",
    icon="fa-camera",
    # بدون nav_permissions = لا يُضاف كعنصر قائمة جانبية تلقائي (نقاط API فقط)
)
