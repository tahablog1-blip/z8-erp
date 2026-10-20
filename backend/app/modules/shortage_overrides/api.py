# modules/shortage_overrides/api.py — نقطة دخول عامة (بدون تسجيل دخول موظفين):
# يستخدمها تطبيق ماسح النواقص على الموبايل مباشرة. القراءة والكتابة محميتان بمفتاح
# X-API-Key (settings.SHORTAGE_API_KEY) لو كان مُفعّلاً في إعدادات السيرفر.
from fastapi import APIRouter, Header, HTTPException

from ...core.config import settings
from .schemas import OverrideOut, OverrideUpsert
from . import service

router = APIRouter()


def _check_api_key(x_api_key: str | None):
    expected = (settings.SHORTAGE_API_KEY or "").strip()
    if expected and x_api_key != expected:
        raise HTTPException(401, "مفتاح API غير صحيح")


@router.get("", response_model=list[OverrideOut])
async def list_overrides(x_api_key: str | None = Header(default=None)):
    _check_api_key(x_api_key)
    return await service.list_overrides()


@router.post("", response_model=OverrideOut, status_code=201)
async def upsert_override(body: OverrideUpsert, x_api_key: str | None = Header(default=None)):
    _check_api_key(x_api_key)
    return await service.upsert_override(body.barcode, body.name)
