# modules/shortage_overrides/schemas.py
from datetime import datetime
from pydantic import BaseModel, Field


class OverrideUpsert(BaseModel):
    barcode: str = Field(min_length=1, max_length=64)
    name: str = Field(min_length=1, max_length=500)


class OverrideOut(BaseModel):
    barcode: str
    name: str
    updated_at: datetime
