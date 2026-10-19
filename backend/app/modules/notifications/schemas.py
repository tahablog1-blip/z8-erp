# modules/notifications/schemas.py — عقود مركز الإشعارات
from datetime import datetime
from typing import Literal

from pydantic import BaseModel

Severity = Literal["info", "warn", "danger"]


class NotificationOut(BaseModel):
    id: str
    type: str
    title: str
    body: str | None = None
    link: str | None = None
    severity: Severity = "info"
    is_read: bool
    created_at: datetime


class UnreadCountOut(BaseModel):
    unread: int
