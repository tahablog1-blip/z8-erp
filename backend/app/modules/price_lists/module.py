# modules/price_lists/module.py — تعريف الموديول للمحمّل الآلي
from ...core.module_loader import ModuleInfo
from .api import router

MODULE = ModuleInfo(
    name="price_lists", title="قوائم الأسعار",
    router=router, prefix="/api/price-lists",
    icon="fa-tags",
    nav_permissions=["products.price_lists"],
)
