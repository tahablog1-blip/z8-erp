"""Z8 - البوابة الذكية | نماذج البيانات"""

from datetime import datetime
from decimal import Decimal
from typing import Optional, List, Any, Dict

from pydantic import BaseModel, Field


class PlateReadResult(BaseModel):
    """نتيجة قراءة اللوحة من الصورة"""
    plate_raw: str = ""
    plate_display_ar: str = ""
    plate_display_en: str = ""
    canonical: str = ""
    loose: str = ""
    digits: str = ""
    letters_ar: str = ""
    confidence: float = 0.0
    is_valid_format: bool = False
    model_used: str = ""
    issues: Optional[str] = None


class CarInfo(BaseModel):
    car_id: Any
    plate_number: Optional[str] = None
    brand: Optional[str] = None
    model: Optional[str] = None
    year: Optional[int] = None
    color: Optional[str] = None
    vin: Optional[str] = None
    last_odometer: Optional[int] = None


class CustomerInfo(BaseModel):
    customer_id: Any = None
    name: Optional[str] = None
    phone: Optional[str] = None
    vat_number: Optional[str] = None
    balance: Optional[Decimal] = None


class CartLine(BaseModel):
    """بند مقترح في الفاتورة الجديدة"""
    product_id: Any
    product_name: str
    sku: Optional[str] = None
    quantity: Decimal = Decimal("1")
    unit_price: Decimal = Decimal("0")
    old_price: Optional[Decimal] = None
    discount: Decimal = Decimal("0")
    line_total: Decimal = Decimal("0")
    is_service: bool = False
    price_changed: bool = False
    unavailable: bool = False
    note: Optional[str] = None


class SuggestedCart(BaseModel):
    """سلة الفاتورة المقترحة من آخر زيارة"""
    source: str = "none"              # last_car_invoice | last_customer_invoice | none
    source_invoice_id: Any = None
    source_invoice_number: Optional[str] = None
    source_invoice_date: Optional[datetime] = None
    lines: List[CartLine] = []
    subtotal: Decimal = Decimal("0")
    vat: Decimal = Decimal("0")
    total: Decimal = Decimal("0")
    warnings: List[str] = []


class VisitStats(BaseModel):
    visits_count: int = 0
    last_visit_date: Optional[datetime] = None
    last_visit_odometer: Optional[int] = None
    days_since_last_visit: Optional[int] = None
    avg_km_per_day: Optional[float] = None
    estimated_odometer_now: Optional[int] = None
    km_since_last_service: Optional[int] = None
    service_due: bool = False
    service_due_note: Optional[str] = None


class GateEvent(BaseModel):
    """الحدث الكامل اللي بيتبعت للشاشة"""
    scan_id: Any = None
    status: str                       # checked_in | matched | needs_confirm | unknown | duplicate | no_plate | error
    message: str = ""
    branch_id: Any = None
    camera_id: Optional[str] = None
    plate: PlateReadResult
    match_mode: Optional[str] = None  # exact | loose | fuzzy | none
    car: Optional[CarInfo] = None
    customer: Optional[CustomerInfo] = None
    candidates: List[CarInfo] = []
    queue_id: Any = None
    already_inside: bool = False
    stats: Optional[VisitStats] = None
    cart: Optional[SuggestedCart] = None
    pos_url: Optional[str] = None
    created_at: Optional[datetime] = None


class ConfirmScanRequest(BaseModel):
    """تأكيد يدوي عند ضعف الثقة أو اختيار سيارة من المرشحين"""
    car_id: Any = Field(..., description="السيارة المختارة")
    corrected_plate: Optional[str] = None
    odometer: Optional[int] = None
    notes: Optional[str] = None
    station: Optional[str] = None


class ManualScanRequest(BaseModel):
    """إدخال يدوي للوحة بدون كاميرا"""
    plate: str
    branch_id: Any
    odometer: Optional[int] = None
    auto_checkin: bool = True


class SchemaCheckResult(BaseModel):
    ok: bool
    missing_tables: List[str] = []
    missing_columns: Dict[str, List[str]] = {}
    hint: str = ""
