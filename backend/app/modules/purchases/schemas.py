# modules/purchases/schemas.py — عقود الإدخال والإخراج (Pydantic)
from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, Field, model_validator

PaymentTerms = Literal["cash", "credit"]
PaymentMethod = Literal["cash", "card", "transfer"]


class PurchaseInvoiceItemIn(BaseModel):
    productId: str
    productLabel: str
    qty: int = Field(ge=1)
    unitCost: float = Field(ge=0)


class PurchaseInvoiceCreate(BaseModel):
    supplierId: str
    supplierInvoiceRef: str | None = None
    invoiceDate: str | None = None       # YYYY-MM-DD — فاضي = اليوم
    paymentTerms: PaymentTerms = "credit"
    paymentMethod: PaymentMethod | None = None   # إلزامي لو paymentTerms = cash
    dueDate: str | None = None                   # إلزامي لو paymentTerms = credit
    items: list[PurchaseInvoiceItemIn] = Field(min_length=1)
    poId: str | None = None           # فاتورة مطابقة لأمر شراء رسمي — فاضي = شراء مباشر (كالمعتاد)
    confirmVariance: bool = False     # تأكيد تجاوز فرق سعر > 10% عن أمر الشراء

    @model_validator(mode="after")
    def _terms_requirements(self):
        if self.paymentTerms == "credit" and not self.dueDate:
            raise ValueError("الفاتورة الآجلة تتطلب تاريخ استحقاق")
        if self.paymentTerms == "cash" and not self.paymentMethod:
            raise ValueError("الدفع النقدي يتطلب تحديد طريقة الدفع")
        return self


class PurchaseInvoiceOut(BaseModel):
    id: str
    supplier_id: str
    supplier_name: str | None = None
    invoice_no: str
    supplier_invoice_ref: str | None = None
    invoice_date: date
    payment_terms: str
    due_date: date | None = None
    subtotal: float
    vat_total: float
    total: float
    paid_total: float
    status: str
    created_at: datetime


class PurchaseInvoiceItemOut(BaseModel):
    id: str
    product_id: str | None = None
    product_label: str
    qty: int
    unit_cost: float
    line_total: float


class PurchaseInvoiceDetailOut(PurchaseInvoiceOut):
    items: list[PurchaseInvoiceItemOut]
    po_id: str | None = None


# ══════════════════ عروض الأسعار (طلبات التسعير من الموردين) ══════════════════

class QuotationItemIn(BaseModel):
    productId: str | None = None
    productLabel: str = Field(min_length=1)
    qty: int = Field(ge=1)
    unitCost: float = Field(ge=0)


class QuotationCreate(BaseModel):
    supplierId: str
    validUntil: str | None = None
    note: str | None = None
    items: list[QuotationItemIn] = Field(min_length=1)


class QuotationItemOut(BaseModel):
    id: str
    product_id: str | None = None
    product_label: str
    qty: int
    unit_cost: float
    line_total: float


class QuotationOut(BaseModel):
    id: str
    quotation_no: str
    supplier_id: str
    supplier_name: str | None = None
    valid_until: date | None = None
    note: str | None = None
    status: str
    total: float
    created_at: datetime


class QuotationDetailOut(QuotationOut):
    items: list[QuotationItemOut]


# ══════════════════ أوامر الشراء ══════════════════

class POItemIn(BaseModel):
    productId: str | None = None
    productLabel: str = Field(min_length=1)
    qty: int = Field(ge=1)
    unitCost: float = Field(ge=0)


class POCreate(BaseModel):
    supplierId: str
    quotationId: str | None = None   # لو موجود: تُنسخ أصنافه تلقائياً إن لم تُرسَل items
    expectedDate: str | None = None
    note: str | None = None
    items: list[POItemIn] = Field(default_factory=list)


class POApproveIn(BaseModel):
    approvalPin: str | None = None


class PORejectIn(BaseModel):
    reason: str = Field(min_length=1)
    approvalPin: str | None = None


class POReceiveItemIn(BaseModel):
    poItemId: str
    qtyReceived: int = Field(gt=0)


class POReceiveIn(BaseModel):
    items: list[POReceiveItemIn] = Field(min_length=1)
    note: str | None = None


class POItemOut(BaseModel):
    id: str
    product_id: str | None = None
    product_label: str
    qty: int
    unit_cost: float
    line_total: float
    qty_received: int


class POOut(BaseModel):
    id: str
    po_no: str
    supplier_id: str
    supplier_name: str | None = None
    quotation_id: str | None = None
    status: str
    expected_date: date | None = None
    note: str | None = None
    subtotal: float
    vat_total: float
    total: float
    approved_by_name: str | None = None
    approved_at: datetime | None = None
    rejected_reason: str | None = None
    invoice_id: str | None = None
    invoice_no: str | None = None
    created_at: datetime


class POReceiptItemOut(BaseModel):
    po_item_id: str
    product_label: str
    qty_received: int


class POReceiptOut(BaseModel):
    id: str
    receipt_no: str
    note: str | None = None
    received_by_name: str | None = None
    created_at: datetime
    items: list[POReceiptItemOut]


class PODetailOut(POOut):
    items: list[POItemOut]
    receipts: list[POReceiptOut]
