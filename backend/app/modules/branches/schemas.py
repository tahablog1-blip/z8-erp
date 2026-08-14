# modules/branches/schemas.py — عقود الإدخال والإخراج (Pydantic)
# أسماء حقول الإدخال camelCase زي عقد النظام القديم بالحرف (capacitySir...)
from pydantic import BaseModel, Field
from datetime import datetime

class BranchCreate(BaseModel):
    name: str = Field(min_length=2, max_length=150)
    capacitySir: int = Field(default=0, ge=0)
    capacityHafr: int = Field(default=0, ge=0)
    capacityRafaat: int = Field(default=0, ge=0)
    # خطوط السير المتعددة بالاسم — سعة السير بتتحسب تلقائياً من عددهم
    lines: list[str] = []

class BranchUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=2, max_length=150)
    capacitySir: int | None = Field(default=None, ge=0)
    capacityHafr: int | None = Field(default=None, ge=0)
    capacityRafaat: int | None = Field(default=None, ge=0)
    is_frozen: bool | None = None
    lines: list[str] | None = None

class BranchOut(BaseModel):
    id: str
    name: str
    capacity_sir: int
    capacity_hafr: int
    capacity_rafaat: int
    lines: list[str] = []
    is_frozen: bool
    created_at: datetime
