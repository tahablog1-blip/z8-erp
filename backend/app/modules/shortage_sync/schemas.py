# modules/shortage_sync/schemas.py — عقود الإدخال والإخراج (Pydantic)
# أسماء الحقول camelCase في كل ما يعبر الشبكة، مطابقةً لباقي عقود المنصة.
from datetime import datetime
from pydantic import BaseModel, Field


class OrderItemIn(BaseModel):
    barcode: str
    name: str
    price: float
    qty: int
    found: bool = True


class OrderUpsertIn(BaseModel):
    id: str = Field(min_length=1, max_length=64)
    items: list[OrderItemIn] = []


class OrderOut(BaseModel):
    id: str
    userId: str
    userName: str
    branchId: str | None = None
    branchName: str | None = None
    items: list[OrderItemIn]
    itemCount: int
    totalAmount: float
    createdAt: datetime
    updatedAt: datetime


class AnnouncementIn(BaseModel):
    message: str = Field(min_length=1, max_length=2000)


class AnnouncementOut(BaseModel):
    id: str
    message: str
    createdByName: str
    createdAt: datetime
    active: bool


class DeviceStatusOut(BaseModel):
    userId: str
    fullName: str
    email: str
    branchId: str | None = None
    branchName: str | None = None
    online: bool
    lastSeenAt: datetime | None = None
