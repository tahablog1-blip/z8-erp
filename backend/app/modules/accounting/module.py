# modules/accounting/module.py — تعريف الموديول للمحمّل الآلي
from ...core.module_loader import ModuleInfo
from .api import router

MODULE = ModuleInfo(
    name="accounting", title="الحسابات",
    router=router, prefix="/api/accounting",
    icon="fa-calculator",
    nav_permissions=["accounting.view_reports"],
)
