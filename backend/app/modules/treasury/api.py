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


@router.get("")
async def list_vouchers(dateFrom: str | None = None, dateTo: str | None = None,
                        type: str | None = None,
                        user: CurrentUser = Depends(require_permission("treasury.view", "treasury.create"))):
    return await service.list_vouchers(user.company_id, dateFrom, dateTo, type)


@router.get("/summary")
async def summary(user: CurrentUser = Depends(require_permission("treasury.view", "treasury.create"))):
    return await service.today_summary(user.company_id)


@router.post("", status_code=201)
async def create_voucher(body: VoucherIn,
                         user: CurrentUser = Depends(require_permission("treasury.create"))):
    return await service.create_voucher(user.company_id, user.user_id, body.model_dump())
