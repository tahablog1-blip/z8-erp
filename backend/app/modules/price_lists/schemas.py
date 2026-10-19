# modules/price_lists/schemas.py — عقود الإدخال والإخراج (Pydantic)
from datetime import datetime

from pydantic import BaseModel, Field


class PriceListCreate(BaseModel):
    name: str = Field(min_length=1, max_length=100)


class PriceListUpdate(BaseModel):
    name: str = Field(min_length=1, max_length=100)


class PriceListOut(BaseModel):
    id: str
    name: str
    item_count: int = 0
    created_at: datetime | None = None


class PriceListItemIn(BaseModel):
    priceVat: float = Field(ge=0)   # شامل الضريبة — نفس عقد سعر الصنف الأساسي


class PriceListItemOut(BaseModel):
    product_id: str
    name: str
    category: str
    spec: str | None = None
    barcode: str | None = None
    base_price_vat: float = 0
    price_vat: float = 0
    is_override: bool = False
