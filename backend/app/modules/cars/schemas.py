# modules/cars/schemas.py — عقود الإدخال والإخراج (Pydantic)
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, field_validator

PlateType = Literal["saudi", "other"]


# ── نقاط التشييك أثناء الخدمة ──
class ChecklistItem(BaseModel):
    key: str
    label: str
    status: Literal["pending", "in_progress", "ok", "needs", "done"] = "pending"
    note: str | None = None


class ChecklistIn(BaseModel):
    items: list[ChecklistItem]


import re as _re


class CarCreate(BaseModel):
    branchId: str
    # ── قواعد التسجيل الإلزامية (بتحمي الويب والأندرويد وأي مصدر تاني) ──
    plateLetters: str                                   # 3 حروف إنجليزي كابيتال بالظبط
    plateNumbers: str                                   # أرقام فقط (1-4)
    plateType: PlateType = "saudi"
    name: str = Field(min_length=1)                     # الموديل
    modelYear: str = Field(min_length=1)                # سنة الصنع
    brand: str = Field(min_length=1)                    # الماركة
    carCategory: str | None = None
    cylinders: str | None = None
    color: str = Field(min_length=1)                    # اللون
    chassisNumber: str                                  # رقم الهيكل — 17 حرف/رقم
    customerName: str = Field(min_length=1)             # اسم العميل
    customerPhone: str                                  # 05 + 10 أرقام بالظبط
    customerId: str | None = None
    station: str | None = None
    odometerCurrent: int = Field(ge=0)                  # الممشى الحالي — إجباري
    odometerPrevious: int | None = Field(default=None, ge=0)
    notes: str | None = None

    @field_validator("customerPhone")
    @classmethod
    def _phone_rule(cls, v: str) -> str:
        digits = "".join(ch for ch in v if ch.isdigit())
        if not _re.fullmatch(r"05\d{8}", digits):
            raise ValueError("رقم الجوال لازم يبدأ بـ05 ويتكون من 10 أرقام بالظبط")
        return digits

    @field_validator("plateLetters")
    @classmethod
    def _plate_letters_rule(cls, v: str) -> str:
        v = (v or "").strip().upper()
        if not _re.fullmatch(r"[A-Z]{3}", v):
            raise ValueError("حروف اللوحة: 3 حروف إنجليزي كابيتال بالظبط")
        return v

    @field_validator("plateNumbers")
    @classmethod
    def _plate_numbers_rule(cls, v: str) -> str:
        v = "".join(ch for ch in str(v or "") if ch.isdigit())
        if not (1 <= len(v) <= 4):
            raise ValueError("أرقام اللوحة: من 1 إلى 4 أرقام")
        return v

    @field_validator("chassisNumber")
    @classmethod
    def _vin_rule(cls, v: str) -> str:
        v = (v or "").strip().upper().replace(" ", "")
        if not _re.fullmatch(r"[A-Z0-9]{17}", v):
            raise ValueError("رقم الهيكل لازم يتكون من 17 حرف/رقم بالظبط")
        return v

    @field_validator("name", "modelYear", "brand", "color", "customerName")
    @classmethod
    def _strip_required(cls, v: str) -> str:
        v = (v or "").strip()
        if not v:
            raise ValueError("الحقل إجباري")
        return v


class CarEdit(BaseModel):
    plateLetters: str | None = None
    plateNumbers: str | None = None
    name: str | None = None
    brand: str | None = None
    modelYear: str | None = None
    color: str | None = None
    chassisNumber: str | None = None
    customerName: str | None = None
    customerPhone: str | None = None
    odometerCurrent: int | None = Field(default=None, ge=0)
    notes: str | None = None


class CarOut(BaseModel):
    id: str
    branch_id: str
    plate: str | None = None
    plate_type: str | None = None
    name: str | None = None
    model_year: str | None = None
    brand: str | None = None
    car_category: str | None = None
    cylinders: str | None = None
    color: str | None = None
    chassis_number: str | None = None
    customer_name: str | None = None
    customer_phone: str | None = None
    customer_id: str | None = None
    station: str | None = None
    odometer_current: int | None = None
    odometer_previous: int | None = None
    notes: str | None = None
    registrar_name: str | None = None
    entered_at: datetime | None = None
    exited_at: datetime | None = None
    created_at: datetime
    checklist: list[ChecklistItem] | None = None


class LookupOut(BaseModel):
    customer: dict | None = None
    vehicle: dict | None = None
    lastOdometer: int | None = None


class TimelineStep(BaseModel):
    step: str
    label: str
    at: datetime | None = None
    by: str | None = None
    ref: str | None = None


class BillingQueueRow(BaseModel):
    id: str
    branch_id: str
    branch_name: str | None = None
    plate: str | None = None
    name: str | None = None
    brand: str | None = None
    customer_name: str | None = None
    customer_phone: str | None = None
    station: str | None = None
    odometer_current: int | None = None
    created_at: datetime
    entered_at: datetime | None = None
    exited_at: datetime | None = None
    invoice_id: str | None = None
    invoice_no: str | None = None
    invoice_total: float | None = None
    queue_no: int
    timeline: list[TimelineStep]
    prepared_items: list[dict] | None = None   # عناصر مجهّزة تلقائياً (مسودة زيت أو تكرار آخر فاتورة)
    work_status: str = "ready"                 # queued | preparing | ready | invoiced
    prepared_by_name: str | None = None        # موظف الإعداد اللي أكّد أمر العمل
    customer_id: str | None = None             # لازم للواجهة عشان تعديل بيانات العميل
    model_year: str | None = None
    notes: str | None = None

