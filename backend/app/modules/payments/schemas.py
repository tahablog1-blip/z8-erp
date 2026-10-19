# modules/payments/schemas.py — عقود الإدخال والإخراج (Pydantic)
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, model_validator

PaymentStatus = Literal["pending", "paid", "failed", "expired", "refunded"]


class PaymentIntentCreate(BaseModel):
    invoiceId: str | None = None      # فاتورة مبيعات — يُجلب العميل والمبلغ المتبقي منها تلقائياً
    customerId: str | None = None     # دفعة عامة لعميل بلا فاتورة محددة (تسوية رصيد)
    amount: float | None = Field(default=None, gt=0)   # اختياري لو invoiceId — افتراضياً كامل المتبقي
    provider: str | None = None       # اسم بوابة الدفع المستهدفة — معلوماتي فقط، لا تكامل فعلي حالياً
    note: str | None = None

    @model_validator(mode="after")
    def _requires_target(self):
        if not self.invoiceId and not self.customerId:
            raise ValueError("يلزم تحديد فاتورة أو عميل لإنشاء عملية دفع")
        if not self.invoiceId and not self.amount:
            raise ValueError("يلزم تحديد المبلغ عند الدفع بدون فاتورة محددة")
        return self


class PaymentTransactionOut(BaseModel):
    id: str
    reference: str
    invoice_id: str | None = None
    invoice_no: str | None = None
    customer_id: str | None = None
    customer_name: str | None = None
    amount: float
    currency: str
    provider: str | None = None
    status: PaymentStatus
    checkout_url: str | None = None
    provider_ref: str | None = None
    note: str | None = None
    created_at: datetime
    paid_at: datetime | None = None


class PaymentProviderStatus(BaseModel):
    connected: bool
    message: str
