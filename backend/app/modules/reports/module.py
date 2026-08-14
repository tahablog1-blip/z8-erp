# modules/reports/module.py — تعريف الموديول للمحمّل الآلي
from ...core.module_loader import ModuleInfo
from .api import router

MODULE = ModuleInfo(
    name="reports", title="التقارير",
    router=router, prefix="/api/reports",
    icon="fa-chart-column",
    nav_permissions=["reports.sales", "accounting.view_vat"],
)
