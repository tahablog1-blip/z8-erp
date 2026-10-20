# modules/shortage_overrides/module.py
from ...core.module_loader import ModuleInfo
from .api import router

MODULE = ModuleInfo(
    name="shortage_overrides", title="تراكب أصناف ماسح النواقص",
    router=router, prefix="/api/shortage-overrides",
    icon="fa-barcode",
    nav_permissions=[],  # نقطة عامة بدون تسجيل دخول — لا تظهر في القائمة الجانبية لأي دور
)
