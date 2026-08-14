# core/module_loader.py — قلب معمارية الموديولات (روح Odoo)
# بيمسح app/modules/* ويركّب أي مجلد فيه module.py بيصدّر MODULE —
# إضافة قسم جديد للنظام = إضافة مجلد، بدون لمس أي ملف مركزي.
import importlib
import pkgutil
from dataclasses import dataclass, field
from fastapi import APIRouter, FastAPI

@dataclass
class ModuleInfo:
    name: str                 # المعرف البرمجي (branches)
    title: str                # الاسم الظاهر بالعربي (الفروع)
    router: APIRouter
    prefix: str               # مسار الـ API (/api/branches)
    icon: str = "fa-cube"     # أيقونة القائمة الجانبية
    enabled: bool = True
    nav_permissions: list[str] = field(default_factory=list)  # مين يشوفه في القائمة

def load_modules(app: FastAPI, package) -> list[ModuleInfo]:
    loaded: list[ModuleInfo] = []
    for _, mod_name, is_pkg in pkgutil.iter_modules(package.__path__):
        if not is_pkg:
            continue
        try:
            mod = importlib.import_module(f"{package.__name__}.{mod_name}.module")
        except ModuleNotFoundError:
            continue  # مجلد بدون module.py — مش موديول
        info: ModuleInfo | None = getattr(mod, "MODULE", None)
        if info is None or not info.enabled:
            continue
        app.include_router(info.router, prefix=info.prefix, tags=[info.title])
        loaded.append(info)
        print(f"🧩 موديول مُركّب: {info.title} ({info.prefix})")
    return loaded
