# modules/shifts/schemas.py — عقود الإدخال والإخراج (Pydantic)
from datetime import datetime

from pydantic import BaseModel, Field


class OpenShiftBody(BaseModel):
    branchId: str
    openingCash: float = Field(default=0, ge=0)


class CloseShiftBody(BaseModel):
    countedCash: float = Field(ge=0)
    notes: str | None = None


class ShiftOut(BaseModel):
    id: str
    branch_id: str
    user_id: str
    branch_name: str | None = None
    user_name: str | None = None
    opened_at: datetime
    closed_at: datetime | None = None
    opening_cash: float
    closing_cash_counted: float | None = None
    closing_notes: str | None = None
    status: str
    invoice_count: int | None = None
    total_sales: float | None = None


class SalesSummary(BaseModel):
    invoiceCount: int
    totalEx: float
    totalVat: float
    totalInc: float


class ReturnsSummary(BaseModel):
    count: int
    totalInc: float
    cashRefunds: float


class CashSummary(BaseModel):
    opening: float
    expected: float
    counted: float | None = None
    difference: float | None = None


class TopItem(BaseModel):
    label: str
    qty: int
    total: float


class ShiftReportOut(BaseModel):
    shift: ShiftOut
    sales: SalesSummary
    byMethod: dict[str, float]
    returns: ReturnsSummary
    cash: CashSummary
    topItems: list[TopItem]
