"""موديل الفروع — مطابق حرفياً لجدول branches الحالي (مفيش تعديل هيكلي)."""
import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, Integer, String, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base


class Branch(Base):
    __tablename__ = "branches"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=text("uuid_generate_v4()")
    )
    company_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    name: Mapped[str] = mapped_column(String(150), nullable=False)
    capacity_sir: Mapped[int] = mapped_column(Integer, server_default=text("0"))
    capacity_hafr: Mapped[int] = mapped_column(Integer, server_default=text("0"))
    capacity_rafaat: Mapped[int] = mapped_column(Integer, server_default=text("0"))
    is_frozen: Mapped[bool] = mapped_column(Boolean, server_default=text("false"))
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("true"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=text("now()"))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=text("now()"))
