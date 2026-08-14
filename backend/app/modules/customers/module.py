# modules/customers/module.py — تعريف الموديول للمحمّل الآلي
from ...core.module_loader import ModuleInfo
from .api import router

MODULE = ModuleInfo(
    name="customers", title="العملاء",
    router=router, prefix="/api/customers",
    icon="fa-users",
    nav_permissions=["customers.create", "customers.edit", "customers.view_statement"],
)
