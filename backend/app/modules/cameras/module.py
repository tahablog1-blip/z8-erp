# modules/cameras/module.py — كاميرات المحطات (البنية التحتية للمراقبة الذكية)
from ...core.module_loader import ModuleInfo
from .api import router

MODULE = ModuleInfo(
    name="cameras", title="الكاميرات",
    router=router, prefix="/api/cameras",
    icon="fa-video",
    nav_permissions=["settings.company"],
)
