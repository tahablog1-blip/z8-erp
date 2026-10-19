# modules/payments/module.py — المدفوعات الإلكترونية (بنية هيكلية جاهزة لتفعيل مزوّد حقيقي)
from ...core.module_loader import ModuleInfo
from .api import router

MODULE = ModuleInfo(
    name="payments", title="المدفوعات الإلكترونية",
    router=router, prefix="/api/payments",
    icon="fa-credit-card",
    nav_permissions=["payments.view"],
)
