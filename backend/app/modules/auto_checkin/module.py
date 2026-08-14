"""
Z8 - البوابة الذكية | نقطة التسجيل
==================================
في app/main.py أضف:

    from app.modules.auto_checkin.module import register as register_auto_checkin
    register_auto_checkin(app)
"""

from fastapi import FastAPI

from .api import router

MODULE_NAME = "auto_checkin"
MODULE_TITLE = "البوابة الذكية"
MODULE_VERSION = "1.0.0"


def register(app: FastAPI) -> None:
    app.include_router(router)


__all__ = ["router", "register", "MODULE_NAME", "MODULE_TITLE", "MODULE_VERSION"]
