# modules/branches/module.py — النموذج الذهبي: انسخ المجلد ده لأي موديول جديد
from ...core.module_loader import ModuleInfo
from .api import router

MODULE = ModuleInfo(
    name="branches", title="الفروع",
    router=router, prefix="/api/branches",
    icon="fa-store",
    nav_permissions=["branches.manage"],   # مين يشوفه في القائمة الجانبية
)
