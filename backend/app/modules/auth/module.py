# modules/auth/module.py — تعريف الموديول للمحمّل الآلي
from ...core.module_loader import ModuleInfo
from .api import router

MODULE = ModuleInfo(
    name="auth", title="الدخول والهوية",
    router=router, prefix="/api/auth",
    icon="fa-key", nav_permissions=[],   # مش بيظهر في القائمة الجانبية
)
