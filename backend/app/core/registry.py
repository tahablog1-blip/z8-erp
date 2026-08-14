"""نظام الموديولات — روح Odoo في المنصة.

كل موديول = مجلد تحت app/modules فيه __init__.py بيعرّف MODULE (المانيفست):
    MODULE = {
        \"name\": \"branches\",
        \"label\": \"الفروع\",
        \"router\": router,                # APIRouter بتاع الموديول
        \"prefix\": \"/branches\",          # بيتركب تحت /api
        \"nav\": [                          # عناصر القائمة الجانبية (الفرونت بيقراها)
            {\"path\": \"/branches\", \"label\": \"قائمة الفروع\",
             \"icon\": \"store\", \"perms\": [\"branches.manage\"]},
        ],
    }

النواة هنا بتكتشف الموديولات وتركّب راوتراتها تلقائياً، وبتنشر سجلّ الملاحة
للفرونت من /api/platform/modules — إضافة موديول جديد = مجلد جديد وبس.
"""
import importlib
import pkgutil

from fastapi import FastAPI

from app import modules as modules_pkg

REGISTERED: list[dict] = []


def load_modules(app: FastAPI) -> None:
    REGISTERED.clear()
    for info in pkgutil.iter_modules(modules_pkg.__path__):
        mod = importlib.import_module(f"app.modules.{info.name}")
        manifest = getattr(mod, "MODULE", None)
        if not manifest or "router" not in manifest:
            continue
        app.include_router(
            manifest["router"],
            prefix="/api" + manifest.get("prefix", f"/{info.name}"),
            tags=[manifest.get("label", info.name)],
        )
        REGISTERED.append(
            {
                "name": manifest.get("name", info.name),
                "label": manifest.get("label", info.name),
                "nav": manifest.get("nav", []),
            }
        )
        print(f"🧩 موديول مُركّب: {manifest.get('label', info.name)}")
