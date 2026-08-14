# modules/invoices/module.py — تعريف الموديول للمحمّل الآلي
from ...core.module_loader import ModuleInfo
from .api import router

MODULE = ModuleInfo(
    name="invoices", title="الفواتير",
    router=router, prefix="/api/invoices",
    icon="fa-file-invoice",
    nav_permissions=[],
)
