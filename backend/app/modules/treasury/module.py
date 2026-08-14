# modules/treasury/module.py — الخزينة: سندات القبض والصرف والمصروفات
from ...core.module_loader import ModuleInfo
from .api import router

MODULE = ModuleInfo(
    name="treasury", title="الخزينة",
    router=router, prefix="/api/treasury",
    icon="fa-cash-register",
    nav_permissions=["treasury.view", "treasury.create"],
)
