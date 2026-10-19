# modules/branches/schemas.py — عقود الإدخال والإخراج (Pydantic)
# أسماء حقول الإدخال camelCase زي عقد النظام القديم بالحرف (capacitySir...)
from typing import Literal
from pydantic import BaseModel, Field
from datetime import datetime

BranchCategory = Literal["service", "retail"]

class BranchCreate(BaseModel):
    name: str = Field(min_length=2, max_length=150)
    category: BranchCategory = "service"
    capacitySir: int = Field(default=0, ge=0)
    capacityHafr: int = Field(default=0, ge=0)
    capacityRafaat: int = Field(default=0, ge=0)
    # خطوط السير المتعددة بالاسم — سعة السير بتتحسب تلقائياً من عددهم
    lines: list[str] = []
    managerUserId: str | None = None
    address: str | None = Field(default=None, max_length=300)
    # ترقيم فواتير مستقل: لو مفعّل، فواتير هذا الفرع تاخد تسلسلها الخاص
    # (وبادئة خاصة لو محددة) بدل التسلسل العام المشترك بين كل الفروع
    invoicePrefix: str | None = Field(default=None, max_length=10)
    independentInvoiceNumbering: bool = False

class BranchUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=2, max_length=150)
    category: BranchCategory | None = None
    capacitySir: int | None = Field(default=None, ge=0)
    capacityHafr: int | None = Field(default=None, ge=0)
    capacityRafaat: int | None = Field(default=None, ge=0)
    is_frozen: bool | None = None
    lines: list[str] | None = None
    managerUserId: str | None = None
    address: str | None = Field(default=None, max_length=300)
    invoicePrefix: str | None = Field(default=None, max_length=10)
    independentInvoiceNumbering: bool | None = None

class BranchOut(BaseModel):
    id: str
    name: str
    category: BranchCategory
    capacity_sir: int
    capacity_hafr: int
    capacity_rafaat: int
    lines: list[str] = []
    is_frozen: bool
    created_at: datetime
    manager_user_id: str | None = None
    manager_name: str | None = None     # اسم المدير جاهز للعرض (JOIN مع users)
    address: str | None = None
    invoice_prefix: str | None = None
    independent_invoice_numbering: bool = False
