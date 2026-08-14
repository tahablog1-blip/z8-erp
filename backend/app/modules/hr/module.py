# modules/hr/module.py — تعريف الموديول للمحمّل الآلي
from ...core.module_loader import ModuleInfo
from .api import router

MODULE = ModuleInfo(
    name="hr", title="الموارد البشرية",
    router=router, prefix="/api/hr",
    icon="fa-id-badge",
    nav_permissions=["hr.view", "hr.manage", "hr.attendance", "hr.leave_approve", "hr.violations", "hr.payroll"],
)
