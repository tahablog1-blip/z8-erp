# modules/terminal/module.py — تابلت الكاشير: تفعيل الجهاز برمز، بطاقات الكاشيرين، دخول برمز الكاشير
from ...core.module_loader import ModuleInfo
from .api import router

MODULE = ModuleInfo(
    name="terminal", title="تابلت الكاشير",
    router=router, prefix="/api/terminal",
    icon="fa-tablet",
    nav_permissions=[],
)
