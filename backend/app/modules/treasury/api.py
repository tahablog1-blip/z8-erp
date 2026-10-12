# modules/treasury/api.py — سند قبض / سند صرف / مصروفات
from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from typing import Literal

from ...core.deps import CurrentUser, require_permission
from . import service

router = APIRouter()


class VoucherIn(BaseModel):
    type: Literal["receipt", "payment"]
    amount: float = Field(gt=0)
    method: Literal["cash", "card", "transfer"] = "cash"
    branchId: str | None = None
    # القبض: customer | other — الصرف: expense | supplier | other
    partyType: str = "other"
    customerId: str | None = None
    partyName: str | None = None
    category: str | None = None       # بند المصروف أو مصدر الإيراد
    description: str | None = None
    voucherDate: str | None = None    # ISO — الافتراضي اليوم
    employeeId: str | None = None
    reason: str | None = None         # للموظف: advance | salary
    installment: float | None = None  # القسط الشهري للسلفة
    referenceNo: str | None = None    # رقم فاتورة/إيصال مرجعي


@router.get("")
async def list_vouchers(dateFrom: str | None = None, dateTo: str | None = None,
                        type: str | None = None, includeCancelled: bool = False,
                        user: CurrentUser = Depends(require_permission("treasury.view", "treasury.create"))):
    return await service.list_vouchers(user.company_id, dateFrom, dateTo, type, includeCancelled)


@router.get("/summary")
async def summary(user: CurrentUser = Depends(require_permission("treasury.view", "treasury.create"))):
    return await service.today_summary(user.company_id)


@router.post("", status_code=201)
async def create_voucher(body: VoucherIn,
                         user: CurrentUser = Depends(require_permission("treasury.create"))):
    return await service.create_voucher(user.company_id, user.user_id, body.model_dump())


class CancelIn(BaseModel):
    reason: str = Field(min_length=2)


@router.post("/{voucher_id}/cancel")
async def cancel_voucher(voucher_id: str, body: CancelIn,
                         user: CurrentUser = Depends(require_permission("treasury.create"))):
    return await service.cancel_voucher(user.company_id, user.user_id, voucher_id, body.reason)


@router.get("/employees")
async def employees(user: CurrentUser = Depends(require_permission("treasury.view", "treasury.create"))):
    return await service.list_employees(user.company_id)


@router.get("/advances")
async def advances(employeeId: str | None = None,
                   user: CurrentUser = Depends(require_permission("treasury.view", "treasury.create"))):
    return await service.list_advances(user.company_id, employeeId)
