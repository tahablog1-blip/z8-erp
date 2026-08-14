# modules/purchases/schemas.py — عقود الإدخال والإخراج (Pydantic)
from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, Field, model_validator

PaymentTerms = Literal["cash", "credit"]
PaymentMethod = Literal["cash", "card", "transfer"]


class PurchaseInvoiceItemIn(BaseModel):
    productId: str
    productLabel: str
    qty: int = Field(ge=1)
    unitCost: float = Field(ge=0)


class PurchaseInvoiceCreate(BaseModel):
    supplierId: str
    supplierInvoiceRef: str | None = None
    invoiceDate: str | None = None       # YYYY-MM-DD — فاضي = اليوم
    paymentTerms: PaymentTerms = "credit"
    paymentMethod: PaymentMethod | None = None   # إلزامي لو paymentTerms = cash
    dueDate: str | None = None                   # إلزامي لو paymentTerms = credit
    items: list[PurchaseInvoiceItemIn] = Field(min_length=1)

    @model_validator(mode="after")
    def _terms_requirements(self):
        if self.paymentTerms == "credit" and not self.dueDate:
            raise ValueError("الفاتورة الآجلة تتطلب تاريخ استحقاق")
        if self.paymentTerms == "cash" and not self.paymentMethod:
            raise ValueError("الدفع النقدي يتطلب تحديد طريقة الدفع")
        return self


class PurchaseInvoiceOut(BaseModel):
    id: str
    supplier_id: str
    supplier_name: str | None = None
    invoice_no: str
    supplier_invoice_ref: str | None = None
    invoice_date: date
    payment_terms: str
    due_date: date | None = None
    subtotal: float
    vat_total: float
    total: float
    paid_total: float
    status: str
    created_at: datetime


class PurchaseInvoiceItemOut(BaseModel):
    id: str
    product_id: str | None = None
    product_label: str
    qty: int
    unit_cost: float
    line_total: float


class PurchaseInvoiceDetailOut(PurchaseInvoiceOut):
    items: list[PurchaseInvoiceItemOut]
