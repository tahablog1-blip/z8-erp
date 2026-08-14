# modules/invoices/schemas.py — عقود الإدخال والإخراج (Pydantic)
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, model_validator

InvoiceType = Literal["simplified", "standard"]
InvoiceSource = Literal["pos", "car"]
PaymentMethod = Literal["cash", "card", "transfer", "credit"]


class InvoiceItemIn(BaseModel):
    productId: str
    label: str
    qty: int = Field(ge=1)
    unitPrice: float = Field(ge=0)        # قبل الضريبة
    unitPriceVat: float = Field(ge=0)     # شامل الضريبة
    discountAmount: float = Field(default=0, ge=0)   # خصم البند — شامل الضريبة


class PaymentIn(BaseModel):
    method: PaymentMethod
    amount: float = Field(ge=0.01)


class InvoiceCreate(BaseModel):
    branchId: str
    source: InvoiceSource = "pos"
    carId: str | None = None
    invoiceType: InvoiceType = "simplified"
    customerId: str | None = None
    customerName: str | None = None
    customerVat: str | None = None
    items: list[InvoiceItemIn] = Field(min_length=1)
    payments: list[PaymentIn] = Field(min_length=1)
    discountAmount: float = Field(default=0, ge=0)    # خصم إضافي على مستوى الفاتورة — شامل الضريبة
    discountReason: str | None = None
    idempotencyKey: str | None = None                 # منع تكرار الإصدار عند إعادة الإرسال

    @model_validator(mode="after")
    def _standard_needs_customer(self):
        if self.invoiceType == "standard" and not (self.customerName and self.customerVat):
            raise ValueError("الفاتورة الضريبية القياسية (B2B) تتطلب اسم العميل ورقمه الضريبي")
        return self


class InvoiceOut(BaseModel):
    id: str
    branch_id: str
    branch_name: str | None = None
    invoice_no: str
    invoice_uuid: str
    invoice_type: str
    source: str
    car_id: str | None = None
    customer_id: str | None = None
    customer_name: str | None = None
    customer_vat: str | None = None
    issued_at: datetime
    qr_tlv: str | None = None
    zatca_status: str
    total_ex: float
    total_vat: float
    total_inc: float
    discount_total: float = 0
    paid_total: float
    credit_total: float
    is_returned: bool
    shift_id: str | None = None
    created_at: datetime


class InvoiceItemOut(BaseModel):
    id: str
    product_id: str | None = None
    label: str
    barcode: str = ""
    qty: int
    unit_price: float
    unit_price_vat: float
    discount_amount: float = 0
    line_ex: float
    line_vat: float
    line_inc: float


class InvoicePaymentOut(BaseModel):
    id: str
    method: str
    amount: float
    created_at: datetime


class InvoiceCarInfo(BaseModel):
    plate: str | None = None
    model: str | None = None
    brand: str | None = None
    model_year: str | None = None
    color: str | None = None
    chassis_number: str | None = None
    odometer_current: int | None = None
    odometer_previous: int | None = None
    notes: str | None = None
    registrar_name: str | None = None
    checklist: list | None = None              # نقاط التشييك — كانت بتتشال من الاستجابة قبل إضافتها هنا
    # ── فريق العمل المحفوظ لحظة اعتماد أمر العمل ──
    filler_name: str | None = None
    fitter1_name: str | None = None
    fitter2_name: str | None = None
    checker_name: str | None = None


class InvoiceDetailOut(InvoiceOut):
    cashier_name: str | None = None
    customer_phone: str | None = None
    items: list[InvoiceItemOut]
    payments: list[InvoicePaymentOut]
    car: InvoiceCarInfo | None = None
