# modules/products/module.py — تعريف الموديول للمحمّل الآلي
from ...core.module_loader import ModuleInfo
from .api import router

MODULE = ModuleInfo(
    name="products", title="الأصناف",
    router=router, prefix="/api/products",
    icon="fa-boxes-stacked",
    # يظهر في القائمة لأي حد معاه أي صلاحية من دول — الكاشير بيشوف الكتالوج
    # حتى لو مش مسموح له يضيف أو يعدّل (الأزرار نفسها بتختفي في الواجهة).
    nav_permissions=["products.create", "products.edit", "products.view_stock"],
)
