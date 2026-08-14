# modules/customers/schemas.py — عقود الإدخال والإخراج (Pydantic)
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, EmailStr, Field

CustomerType = Literal["individual", "company"]
PlateType = Literal["saudi", "other"]


class CustomerCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    customerType: CustomerType = "individual"
    phone: str | None = None
    email: str | None = None    # اتفحص خفيف — Zod الأصلي بيقبل "" كمان
    vatNumber: str | None = None
    crNumber: str | None = None
    address: str | None = None
    # العنوان الوطني المفصّل — يُملأ للشركات (مطلوب في الفاتورة الضريبية)
    buildingNo: str | None = None
    street: str | None = None
    district: str | None = None
    city: str | None = None
    postalCode: str | None = None
    additionalNo: str | None = None


class CustomerUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    customerType: CustomerType | None = None
    phone: str | None = None
    email: str | None = None
    vatNumber: str | None = None
    crNumber: str | None = None
    address: str | None = None
    buildingNo: str | None = None
    street: str | None = None
    district: str | None = None
    city: str | None = None
    postalCode: str | None = None
    additionalNo: str | None = None


class CustomerOut(BaseModel):
    id: str
    name: str
    customer_type: str
    phone: str | None = None
    email: str | None = None
    vat_number: str | None = None
    cr_number: str | None = None
    address: str | None = None
    building_no: str | None = None
    street: str | None = None
    district: str | None = None
    city: str | None = None
    postal_code: str | None = None
    additional_no: str | None = None
    balance: float = 0
    vehicle_count: int = 0
    created_at: datetime | None = None


class VehicleCreate(BaseModel):
    plate: str = Field(min_length=1, max_length=30)
    plateType: PlateType = "saudi"
    brand: str | None = None
    makeModel: str | None = None
    modelYear: str | None = None
    carCategory: str | None = None
    cylinders: str | None = None
    color: str | None = None
    chassisNumber: str | None = None
    notes: str | None = None


class VehicleOut(BaseModel):
    id: str
    customer_id: str
    plate: str
    plate_type: str
    brand: str | None = None
    make_model: str | None = None
    model_year: str | None = None
    car_category: str | None = None
    cylinders: str | None = None
    color: str | None = None
    chassis_number: str | None = None
    notes: str | None = None
    created_at: datetime


class PaymentBody(BaseModel):
    amount: float = Field(ge=0.01)
    method: Literal["cash", "card", "transfer"] = "cash"
    note: str | None = None


class LedgerEntryOut(BaseModel):
    id: str
    entry_type: str
    invoice_id: str | None = None
    invoice_no: str | None = None
    amount: float
    note: str | None = None
    created_at: datetime
    running_balance: float


class StatementOut(BaseModel):
    customer: CustomerOut
    entries: list[LedgerEntryOut]
    balance: float
