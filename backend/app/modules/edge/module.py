# modules/edge/module.py — وكلاء المحطات (الكاميرات خلف شبكة محلية)
from ...core.module_loader import ModuleInfo
from .api import router

MODULE = ModuleInfo(name="edge", title="وكلاء المحطات", router=router, prefix="/api/edge", icon="fa-video", nav_permissions=[])
