# modules/shortage_sync/module.py
from ...core.module_loader import ModuleInfo
from .api import router

MODULE = ModuleInfo(
    name="shortage_sync", title="مزامنة ماسح النواقص",
    router=router, prefix="/api/shortage-sync",
    icon="fa-sync",
    nav_permissions=[],  # يُستخدم فقط من تطبيق الموبايل عبر توكن الموظف العادي - لا يظهر بالقائمة الجانبية
)
