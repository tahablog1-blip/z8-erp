# modules/cars/module.py — تعريف الموديول للمحمّل الآلي
from ...core.module_loader import ModuleInfo
from .api import router

MODULE = ModuleInfo(
    name="cars", title="السيارات",
    router=router, prefix="/api/cars",
    icon="fa-car",
    nav_permissions=["cars.create", "cars.confirm_entry", "cars.confirm_exit"],
)
