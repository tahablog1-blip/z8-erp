# modules/inventory/module.py — تعريف الموديول للمحمّل الآلي
from ...core.module_loader import ModuleInfo
from .api import router

MODULE = ModuleInfo(
    name="inventory", title="المخزون",
    router=router, prefix="/api/inventory",
    icon="fa-warehouse",
    nav_permissions=["products.view_stock"],
)
