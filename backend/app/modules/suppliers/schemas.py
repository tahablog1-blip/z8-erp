# modules/suppliers/schemas.py — عقود الإدخال والإخراج (Pydantic)
from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, Field


class SupplierCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    phone: str | None = None
    vatNumber: str | None = None
    address: str | None = None
    paymentTermsDays: int = Field(default=0, ge=0)


class SupplierUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    phone: str | None = None
    vatNumber: str | None = None
    address: str | None = None
    paymentTermsDays: int | None = Field(default=None, ge=0)


class SupplierOut(BaseModel):
    id: str
    name: str
    phone: str | None = None
    vat_number: str | None = None
    address: str | None = None
    payment_terms_days: int
    balance: float = 0     # موجب = مستحق للمورد (ذمة دائنة)
    created_at: datetime | None = None


class PaymentBody(BaseModel):
    amount: float = Field(ge=0.01)
    method: Literal["cash", "card", "transfer"] = "cash"
    invoiceId: str | None = None
    note: str | None = None


class DueInvoiceOut(BaseModel):
    id: str
    invoice_no: str
    invoice_date: date
    due_date: date | None = None
    total: float
    paid_total: float
    status: str


class LedgerEntryOut(BaseModel):
    id: str
    entry_type: Literal["invoice", "payment"]
    invoice_id: str | None = None
    invoice_no: str | None = None
    due_date: date | None = None
    payment_terms: str | None = None
    amount: float
    note: str | None = None
    created_at: datetime
    running_balance: float


class StatementOut(BaseModel):
    supplier: SupplierOut
    entries: list[LedgerEntryOut]
    balance: float
    dueInvoices: list[DueInvoiceOut]
