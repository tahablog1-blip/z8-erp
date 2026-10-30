# modules/terminal/api.py — مسارات تابلت الكاشير (الدخول عامة مع تحديد معدل؛ الإدارة بصلاحية settings.users)
from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, Field

from ...core.deps import CurrentUser, require_permission
from . import service

router = APIRouter()


def _ip(request: Request) -> str | None:
    return request.headers.get("x-real-ip") or (request.client.host if request.client else None)


class EnterBody(BaseModel):
    code: str = Field(min_length=9, max_length=9)
    deviceKey: str = Field(min_length=8, max_length=80)      # معرّف عشوائي يولّده التطبيق عند التثبيت
    deviceName: str | None = Field(default=None, max_length=60)


class DeviceBody(BaseModel):
    deviceToken: str


class CashierLoginBody(BaseModel):
    deviceToken: str
    userId: str
    pin: str = Field(min_length=4, max_length=8)


@router.post("/enter")
async def enter(body: EnterBody, request: Request):
    return await service.enter(body.code, body.deviceKey, body.deviceName, _ip(request))


@router.post("/cashiers")
async def cashiers(body: DeviceBody):
    return await service.cashiers_for_device(body.deviceToken)


@router.post("/cashier-login")
async def cashier_login(body: CashierLoginBody, request: Request):
    return await service.cashier_login(body.deviceToken, body.userId, body.pin, _ip(request))


# ── إدارة المدير ──
_ADMIN = "settings.users"


class SetCodeBody(BaseModel):
    branchId: str
    kind: str
    actsAsUserId: str | None = None


class DeleteCodeBody(BaseModel):
    branchId: str
    kind: str


class SetPinBody(BaseModel):
    userId: str
    pin: str = Field(min_length=4, max_length=8)


@router.get("/admin/overview")
async def admin_overview(user: CurrentUser = Depends(require_permission(_ADMIN))):
    return await service.admin_overview(user.company_id)


@router.post("/admin/codes")
async def admin_set_code(body: SetCodeBody, user: CurrentUser = Depends(require_permission(_ADMIN))):
    return await service.admin_set_code(user.company_id, body.branchId, body.kind, body.actsAsUserId)


@router.post("/admin/codes/delete", status_code=204)
async def admin_delete_code(body: DeleteCodeBody, user: CurrentUser = Depends(require_permission(_ADMIN))):
    await service.admin_delete_code(user.company_id, body.branchId, body.kind)


@router.post("/admin/pin", status_code=204)
async def admin_set_pin(body: SetPinBody, user: CurrentUser = Depends(require_permission(_ADMIN))):
    await service.admin_set_pin(user.company_id, body.userId, body.pin)


@router.get("/admin/devices")
async def admin_devices(user: CurrentUser = Depends(require_permission(_ADMIN))):
    return await service.admin_devices(user.company_id)


@router.post("/admin/devices/{device_id}/revoke", status_code=204)
async def admin_revoke(device_id: str, user: CurrentUser = Depends(require_permission(_ADMIN))):
    await service.admin_revoke_device(user.company_id, device_id, True)


@router.post("/admin/devices/{device_id}/restore", status_code=204)
async def admin_restore(device_id: str, user: CurrentUser = Depends(require_permission(_ADMIN))):
    await service.admin_revoke_device(user.company_id, device_id, False)
