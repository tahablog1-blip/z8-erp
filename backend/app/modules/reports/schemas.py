# modules/reports/schemas.py — عقود الإخراج (Pydantic) — التقارير كلها قراءة فقط
from pydantic import BaseModel, Field


class SourceVat(BaseModel):
    invoiceCount: int = 0
    salesEx: float = 0
    outputVat: float = 0


class VatReturnOut(BaseModel):
    from_: str = Field(alias="from")
    to: str
    vatPercent: float
    salesEx: float
    grossVat: float
    returnsEx: float
    returnsVat: float
    returnsCount: int
    outputVat: float
    bySource: dict[str, SourceVat]
    purchasesEx: float
    inputVat: float
    netVat: float          # موجب = مستحق للهيئة، سالب = مسترد

    model_config = {"populate_by_name": True}


class SourceSummary(BaseModel):
    invoiceCount: int = 0
    totalEx: float = 0
    totalVat: float = 0
    totalInc: float = 0
    creditTotal: float = 0
    avgTicket: float = 0
    cogs: float = 0
    grossProfit: float = 0
    marginPct: float = 0
    byMethod: dict[str, float]
    topItems: list[dict]


class DailyPoint(BaseModel):
    day: str
    source: str
    invoiceCount: int
    totalInc: float


class SalesSummaryOut(BaseModel):
    from_: str = Field(alias="from")
    to: str
    branchId: str | None = None
    groupBy: str
    service: SourceSummary   # فواتير مرتبطة بسيارة (source='car')
    retail: SourceSummary    # بيع بالقطعة (source='pos')
    totals: dict
    daily: list[DailyPoint]

    model_config = {"populate_by_name": True}
