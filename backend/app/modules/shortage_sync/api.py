# modules/shortage_sync/api.py — نقاط دخول تطبيق ماسح النواقص (Android) المحمية
# بتسجيل دخول الموظف العادي (نفس توكن /api/auth/login). كل مسار يتصرف بحسب
# دور المستخدم: الإدمن يشوف كل شيء على مستوى الشركة، والموظف يشوف طلبياته فقط.
from fastapi import APIRouter, Depends
from ...core.deps import get_current_user, require_role, CurrentUser
from .schemas import OrderUpsertIn, OrderOut, AnnouncementIn, AnnouncementOut, DeviceStatusOut
from . import service

router = APIRouter()


@router.post("/orders", response_model=OrderOut)
async def upsert_order(body: OrderUpsertIn, user: CurrentUser = Depends(get_current_user)):
    return await service.upsert_order(
        user.company_id, user.user_id, user.branch_id,
        body.id, [i.model_dump() for i in body.items],
    )


@router.get("/orders", response_model=list[OrderOut])
async def list_orders(user: CurrentUser = Depends(get_current_user)):
    # الإدمن يشوف كل طلبيات الشركة؛ الموظف يشوف طلبياته فقط - لا يوجد مسار
    # يمكّن موظفًا من رؤية طلبيات موظف آخر.
    scoped_user_id = None if user.role == "admin" else user.user_id
    return await service.list_orders(user.company_id, scoped_user_id)


@router.get("/devices", response_model=list[DeviceStatusOut])
async def list_devices(user: CurrentUser = Depends(require_role("admin"))):
    return await service.list_device_status(user.company_id)


@router.post("/announcements", response_model=AnnouncementOut)
async def create_announcement(body: AnnouncementIn, user: CurrentUser = Depends(require_role("admin"))):
    return await service.create_announcement(user.company_id, user.user_id, body.message)


@router.get("/announcements", response_model=list[AnnouncementOut])
async def list_announcements(user: CurrentUser = Depends(get_current_user)):
    return await service.list_active_announcements(user.company_id)


@router.delete("/announcements/{announcement_id}", status_code=204)
async def deactivate_announcement(announcement_id: str, user: CurrentUser = Depends(require_role("admin"))):
    await service.deactivate_announcement(user.company_id, announcement_id)
