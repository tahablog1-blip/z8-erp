# modules/suppliers/module.py — تعريف الموديول للمحمّل الآلي
from ...core.module_loader import ModuleInfo
from .api import router

MODULE = ModuleInfo(
    name="suppliers", title="الموردون",
    router=router, prefix="/api/suppliers",
    icon="fa-truck",
    nav_permissions=["purchasing.suppliers"],
)
