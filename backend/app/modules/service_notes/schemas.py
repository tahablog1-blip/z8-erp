# modules/service_notes/schemas.py — عقود الإدخال والإخراج
from datetime import datetime
from typing import Literal
from pydantic import BaseModel, Field

NoteType = Literal[
    "out_of_stock", "low_stock", "needs_replacement", "part_replacement",
    "technical", "car_note", "extra_service", "customer_declined",
    "operational", "other",
]
NoteStatus = Literal[
    "new", "in_progress", "awaiting_customer",
    "awaiting_management", "handled", "closed", "rejected",
]
NotePriority = Literal["low", "normal", "high", "urgent"]

# التسميات العربية — الواجهة بتستخدمها للعرض والفلاتر
TYPE_LABELS = {
    "out_of_stock":     "منتج غير متوفر",
    "low_stock":        "كمية المنتج غير كافية",
    "needs_replacement": "منتج يحتاج إلى تغيير",
    "part_replacement": "قطعة تحتاج إلى تغيير",
    "technical":        "مشكلة فنية",
    "car_note":         "ملاحظة على السيارة",
    "extra_service":    "خدمة إضافية مقترحة",
    "customer_declined": "العميل رفض خدمة",
    "operational":      "مشكلة تشغيلية",
    "other":            "أخرى",
}
STATUS_LABELS = {
    "new":                 "جديدة",
    "in_progress":         "قيد المتابعة",
    "awaiting_customer":   "بانتظار رد العميل",
    "awaiting_management": "بانتظار الإدارة",
    "handled":             "تم التعامل معها",
    "closed":              "مغلقة",
    "rejected":            "مرفوضة",
}


class NoteCreate(BaseModel):
    workOrderId: str                       # = car id — كل بيانات العميل/السيارة تتسحب منه تلقائياً
    type: NoteType
    description: str = ""
    title: str | None = None
    productId: str | None = None
    requiredQuantity: int | None = Field(default=None, ge=0)
    priority: NotePriority = "normal"


class NoteStatusUpdate(BaseModel):
    status: NoteStatus
    reason: str | None = None


class NoteUpdate(BaseModel):
    description: str | None = None
    title: str | None = None
    priority: NotePriority | None = None
    productId: str | None = None
    requiredQuantity: int | None = Field(default=None, ge=0)


class NotifyCustomerBody(BaseModel):
    message: str = Field(min_length=1)     # النص القابل للتعديل قبل الإرسال (بند 9)


class MessageCreate(BaseModel):
    message: str = Field(min_length=1)
    noteId: str | None = None
    messageType: Literal["text", "quick_reply"] = "text"


class TemplateCreate(BaseModel):
    title: str = Field(min_length=1)
    message: str = Field(min_length=1)
    category: str | None = None
    branchId: str | None = None


class TemplateUpdate(BaseModel):
    title: str | None = None
    message: str | None = None
    category: str | None = None
    isActive: bool | None = None
