# modules/shifts/api.py — طبقة الـ HTTP: مسارات + صلاحيات فقط
from fastapi import APIRouter, Depends

from ...core.deps import CurrentUser, get_current_user, require_permission
from . import service
from .schemas import CloseShiftBody, OpenShiftBody, ShiftOut, ShiftReportOut

router = APIRouter()


@router.get("/current")
async def get_current(user: CurrentUser = Depends(require_permission("shifts.manage_own"))):
    """الوردية المفتوحة حالياً للمستخدم الحالي — null لو مفيش"""
    return await service.get_current(user.company_id, user.user_id)


@router.post("/open", response_model=ShiftOut, status_code=201)
async def open_shift(body: OpenShiftBody,
                     user: CurrentUser = Depends(require_permission("shifts.manage_own"))):
    return await service.open_shift(user.company_id, user.user_id, body.branchId, body.openingCash)


@router.post("/{shift_id}/close", response_model=ShiftReportOut)
async def close_shift(shift_id: str, body: CloseShiftBody,
                      user: CurrentUser = Depends(require_permission("shifts.manage_own"))):
    return await service.close_shift(user.company_id, shift_id, body.countedCash, body.notes, caller_id=user.user_id, can_close_any=user.has("shifts.view_branch"))


@router.get("", response_model=list[ShiftOut])
async def list_shifts(user: CurrentUser = Depends(require_permission("shifts.manage_own", "shifts.view_branch"))):
    """سجل الورديات — لصاحب الصلاحية الإدارية بس"""
    return await service.list_shifts(user.company_id, user.user_id, user.has("shifts.view_branch"), user.branch_scope)


@router.get("/{shift_id}/report", response_model=ShiftReportOut)
async def get_report(shift_id: str,
                     user: CurrentUser = Depends(
                         require_permission("shifts.view_branch", "shifts.manage_own"))):
    return await service.get_report(user.company_id, shift_id, caller_id=user.user_id, can_view_any=user.has("shifts.view_branch"))
