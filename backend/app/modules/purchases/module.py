# modules/purchases/module.py — تعريف الموديول للمحمّل الآلي
from ...core.module_loader import ModuleInfo
from .api import router

MODULE = ModuleInfo(
    name="purchases", title="المشتريات",
    router=router, prefix="/api/purchases",
    icon="fa-cart-shopping",
    nav_permissions=["purchasing.invoices"],
)
