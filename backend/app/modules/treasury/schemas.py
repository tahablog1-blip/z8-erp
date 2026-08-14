# modules/treasury/schemas.py — عقود الخزينة
from typing import Literal
from pydantic import BaseModel, Field

VoucherType = Literal["receipt", "payment"]                      # قبض / صرف
PartyType = Literal["customer", "supplier", "expense", "other"]  # الطرف
PayMethod = Literal["cash", "card", "transfer"]                  # طريقة الحركة النقدية


class VoucherCreate(BaseModel):
    vtype: VoucherType
    partyType: PartyType
    method: PayMethod = "cash"
    amount: float = Field(gt=0)
    branchId: str | None = None
    customerId: str | None = None
    supplierId: str | None = None
    partyName: str | None = None       # اسم الطرف الحر (لغير العملاء/الموردين)
    category: str | None = None        # تصنيف المصروف (إيجار/كهرباء/رواتب...)
    description: str | None = None
    voucherDate: str | None = None     # ISO — الافتراضي اليوم


class VoucherOut(BaseModel):
    id: str
    voucher_no: str
    vtype: VoucherType
    party_type: PartyType
    method: PayMethod
    amount: float
    branch_id: str | None = None
    branch_name: str | None = None
    customer_id: str | None = None
    supplier_id: str | None = None
    party_name: str | None = None
    category: str | None = None
    description: str | None = None
    voucher_date: object
    created_at: object
    created_by_name: str | None = None
    is_cancelled: bool
