# modules/inventory/schemas.py — عقود الإدخال والإخراج (Pydantic)
# camelCase في الإدخال زي عقد النظام القديم بالحرف (fromLocType, productId...)
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

LocType = Literal["warehouse", "branch"]


# ── سطر صنف داخل سند استلام ──
class ReceiveItem(BaseModel):
    productId: str
    productLabel: str
    barcode: str | None = None
    qty: int = Field(ge=1)
    unitCost: float = Field(default=0, ge=0)


class ReceiveBody(BaseModel):
    items: list[ReceiveItem] = Field(min_length=1)
    supplierName: str | None = None
    note: str | None = None


# ── سطر صنف داخل سند تحويل ──
class TransferItem(BaseModel):
    productId: str
    productLabel: str
    barcode: str | None = None
    qty: int = Field(ge=1)


class TransferBody(BaseModel):
    fromLocType: LocType
    fromLocId: str
    toLocType: LocType
    toLocId: str
    items: list[TransferItem] = Field(min_length=1)
    note: str | None = None


class VoucherEditBody(BaseModel):
    """تعديل سند: قائمة الأصناف بتستبدل بالكامل والمخزون بيتصحّح تلقائياً"""
    items: list[TransferItem] = Field(min_length=1)


# ══════════════════ المخرجات ══════════════════

class MoveResult(BaseModel):
    success: bool = True
    moveNo: str
    itemCount: int


class QtyOut(BaseModel):
    qty: int = 0


class LevelOut(BaseModel):
    loc_type: str
    loc_id: str
    product_id: str
    qty: int
    category: str | None = None
    name: str | None = None
    spec: str | None = None
    unit: str | None = None
    min_qty: int = 0
    barcode: str | None = None
    branch_name: str | None = None       # فاضي للمستودع
    loc_name: str                        # اسم الموقع جاهز للعرض
    is_low: bool = False                 # الرصيد وصل حد الانخفاض أو أقل


class MoveOut(BaseModel):
    id: str
    move_type: str
    from_loc_type: str | None = None
    from_loc_id: str | None = None
    to_loc_type: str
    to_loc_id: str
    product_id: str
    product_label: str | None = None
    unit: str | None = None
    qty: int
    move_no: str | None = None
    note: str | None = None
    supplier_name: str | None = None
    unit_cost: float | None = None
    created_at: datetime


class VoucherOut(BaseModel):
    moveNo: str
    type: str
    from_: str = Field(alias="from")     # from كلمة محجوزة في بايثون
    to: str
    createdAt: datetime
    itemCount: int
    totalQty: int

    model_config = {"populate_by_name": True}


class VoucherItemOut(BaseModel):
    productId: str
    productLabel: str | None = None
    barcode: str | None = None
    qty: int


class VoucherDetailOut(BaseModel):
    moveNo: str
    type: str
    fromLocType: str | None = None
    fromLocId: str | None = None
    toLocType: str
    toLocId: str
    from_: str = Field(alias="from")
    to: str
    createdAt: datetime
    note: str | None = None
    supplierName: str | None = None
    items: list[VoucherItemOut]

    model_config = {"populate_by_name": True}
