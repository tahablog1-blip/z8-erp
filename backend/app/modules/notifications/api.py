# modules/notifications/api.py — طبقة الـ HTTP: قراءة إشعارات المستخدم الحالي فقط
# (مفتوح لأي مستخدم مسجّل — الإشعار شخصي بطبيعته، مفيش صلاحية منفصلة له)
from fastapi import APIRouter, Depends, Query

from ...core.deps import CurrentUser, get_current_user
from . import service
from .schemas import NotificationOut, UnreadCountOut

router = APIRouter()


@router.get("", response_model=list[NotificationOut])
async def list_notifications(onlyUnread: bool = Query(default=False), limit: int = Query(default=50),
                             user: CurrentUser = Depends(get_current_user)):
    return await service.list_notifications(user.company_id, user.user_id, onlyUnread, limit)


@router.get("/unread-count", response_model=UnreadCountOut)
async def unread_count(user: CurrentUser = Depends(get_current_user)):
    return {"unread": await service.unread_count(user.company_id, user.user_id)}


@router.post("/{notification_id}/read")
async def mark_read(notification_id: str, user: CurrentUser = Depends(get_current_user)):
    await service.mark_read(user.company_id, user.user_id, notification_id)
    return {"success": True}


@router.post("/read-all")
async def mark_all_read(user: CurrentUser = Depends(get_current_user)):
    await service.mark_all_read(user.company_id, user.user_id)
    return {"success": True}
