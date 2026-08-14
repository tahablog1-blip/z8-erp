# modules/products/schemas.py — عقود الإدخال والإخراج (Pydantic)
# أسماء حقول الإدخال camelCase زي عقد النظام القديم بالحرف (costPrice, minQty...)
from datetime import datetime

from pydantic import BaseModel, Field


class ProductCreate(BaseModel):
    # الفئة فاضية = تُستنتج تلقائياً من الاسم (نفس منطق الاستيراد بالظبط)
    category: str = Field(default="", max_length=100)
    name: str = Field(min_length=1, max_length=150)
    spec: str = Field(default="", max_length=100)
    unit: str = Field(default="قطعة", max_length=30)
    barcode: str | None = Field(default=None, max_length=64)
    price: float = Field(ge=0)
    costPrice: float = Field(default=0, ge=0)
    minQty: int = Field(default=0, ge=0)
    # فترة تغيير الزيت بالكيلومتر لهذا الصنف تحديداً — الفاتورة بتحسب بيها
    # موعد الصيانة القادمة بدل رقم ثابت. فاضية لأي صنف غير الزيوت.
    serviceIntervalKm: int | None = Field(default=None, ge=0)
    # صنف خدمة: يُباع بدون مخزون (لا شراء / لا تحويل / لا خصم كمية)
    isService: bool = False
    isOil: bool = False           # يظهر في بوابة اختيار الزيت الذاتية
    isOilFilter: bool = False     # يُعرض كخيار "مع فلتر زيت"
    oilBrand: str | None = None   # شركة الزيت (لبوابة العميل)


class ProductUpdate(BaseModel):
    category: str | None = Field(default=None, max_length=100)
    name: str | None = Field(default=None, min_length=1, max_length=150)
    spec: str | None = Field(default=None, max_length=100)
    unit: str | None = Field(default=None, max_length=30)
    barcode: str | None = Field(default=None, max_length=64)
    price: float | None = Field(default=None, ge=0)
    costPrice: float | None = Field(default=None, ge=0)
    minQty: int | None = Field(default=None, ge=0)
    serviceIntervalKm: int | None = Field(default=None, ge=0)
    isService: bool | None = None
    isOil: bool | None = None
    isOilFilter: bool | None = None
    oilBrand: str | None = None


class ProductOut(BaseModel):
    id: str
    category: str
    name: str
    spec: str | None = None
    unit: str | None = None
    barcode: str | None = None
    price: float = 0
    price_vat: float = 0          # محسوب بتريجر في القاعدة — للقراءة فقط
    cost_price: float = 0
    min_qty: int = 0
    service_interval_km: int | None = None
    is_service: bool = False
    is_oil: bool = False
    is_oil_filter: bool = False
    oil_brand: str | None = None
    is_active: bool = True
    created_at: datetime | None = None


class SpecOut(BaseModel):
    """صف القائمة المتسلسلة الثالثة (اللزوجة) — بيرجّع السعر معاه عشان
    شاشة البيع تملا السعر تلقائياً بمجرد اختيار اللزوجة"""
    id: str
    spec: str | None = None
    price: float = 0
    price_vat: float = 0
    barcode: str | None = None
