"""
Z8 - البوابة الذكية | منطق الأعمال
===================================
التسلسل:
  صورة -> قراءة اللوحة -> توحيد -> مطابقة -> فحص التكرار
       -> دخول تلقائي للطابور -> بناء سلة الفاتورة من آخر زيارة -> بث للشاشة
"""

import os
import logging
from decimal import Decimal
from datetime import datetime, timezone
from typing import Optional, Any, List, Dict

from app.core.plate_utils import normalize_plate, PlateKey, plate_similarity
from . import queries as Q
from . import vision
from .schemas import (
    PlateReadResult, CarInfo, CustomerInfo, CartLine, SuggestedCart,
    VisitStats, GateEvent, SchemaCheckResult,
)
from .ws_hub import hub

log = logging.getLogger("z8.gate.service")

# ---------------------------------------------------------------------------
# إعدادات (متغيرات بيئة)
# ---------------------------------------------------------------------------
AUTO_CHECKIN_MIN_CONFIDENCE = float(os.getenv("Z8_GATE_MIN_CONFIDENCE", "0.85"))
DUPLICATE_WINDOW_MINUTES = int(os.getenv("Z8_GATE_DUPLICATE_MINUTES", "20"))
VAT_RATE = Decimal(os.getenv("Z8_VAT_RATE", "0.15"))
DEFAULT_STATION = os.getenv("Z8_GATE_DEFAULT_STATION", "استقبال")
DEFAULT_QUEUE_STATUS = os.getenv("Z8_GATE_QUEUE_STATUS", "waiting")
SERVICE_INTERVAL_KM = int(os.getenv("Z8_SERVICE_INTERVAL_KM", "5000"))
POS_BASE_URL = os.getenv("Z8_POS_URL", "/pos")


# ---------------------------------------------------------------------------
# فحص المخطط
# ---------------------------------------------------------------------------
async def schema_check(conn) -> SchemaCheckResult:
    table_names = list(Q.REQUIRED.keys())
    rows = await conn.fetch(Q.Q_SCHEMA_CHECK, table_names)

    found: Dict[str, set] = {}
    for r in rows:
        found.setdefault(r["table_name"], set()).add(r["column_name"])

    missing_tables = [t for t in table_names if t not in found]
    missing_columns: Dict[str, List[str]] = {}

    for table, cols in Q.REQUIRED.items():
        if table in missing_tables:
            continue
        miss = [c for c in cols if c not in found[table]]
        if miss:
            missing_columns[table] = miss

    ok = not missing_tables and not missing_columns
    hint = (
        "كل الأسماء مضبوطة. الموديول جاهز."
        if ok else
        "عدّل الأسماء الناقصة في ملف app/modules/auto_checkin/queries.py "
        "أو شغّل ملف sql/2026_auto_checkin.sql لو الأعمدة الجديدة ناقصة."
    )
    return SchemaCheckResult(ok=ok, missing_tables=missing_tables,
                             missing_columns=missing_columns, hint=hint)


# ---------------------------------------------------------------------------
# المطابقة
# ---------------------------------------------------------------------------
def _row_to_car(row) -> CarInfo:
    return CarInfo(
        car_id=row["car_id"],
        plate_number=row["plate_number"],
        brand=row["brand"],
        model=row["model"],
        year=row["year"],
        color=row["color"],
        vin=row["vin"],
        last_odometer=row["last_odometer"],
    )


def _row_to_customer(row) -> CustomerInfo:
    return CustomerInfo(
        customer_id=row["customer_id"],
        name=row["customer_name"],
        phone=row["customer_phone"],
        vat_number=row["customer_vat"],
        balance=row["customer_balance"],
    )


async def match_plate(conn, key: PlateKey):
    """
    يرجع (row, match_mode, candidates)
    match_mode: exact | loose | fuzzy | none
    """
    if not key.canonical:
        return None, "none", []

    # 1) مطابقة تامة
    row = await conn.fetchrow(Q.Q_FIND_CAR_EXACT, key.canonical)
    if row:
        return row, "exact", []

    # 2) مطابقة متساهلة (نفس الحروف بترتيب مختلف)
    if key.loose:
        row = await conn.fetchrow(Q.Q_FIND_CAR_LOOSE, key.loose)
        if row:
            return row, "loose", []

    # 3) مرشحون بنفس الأرقام
    if key.digits:
        rows = await conn.fetch(Q.Q_FIND_CANDIDATES, key.digits)
        cands = []
        for r in rows:
            other = normalize_plate(r["plate_normalized"] or r["plate_number"])
            if plate_similarity(key, other) >= 0.75:
                cands.append(r)
        if len(cands) == 1:
            return cands[0], "fuzzy", []
        if cands:
            return None, "fuzzy", cands

    return None, "none", []


# ---------------------------------------------------------------------------
# إحصائيات الزيارات
# ---------------------------------------------------------------------------
async def build_stats(conn, car_id, last_odometer: Optional[int]) -> VisitStats:
    rows = await conn.fetch(Q.Q_VISIT_HISTORY, car_id)
    st = VisitStats(visits_count=len(rows))
    if not rows:
        return st

    last = rows[0]
    st.last_visit_date = last["invoice_date"]
    st.last_visit_odometer = last["odometer"]

    if st.last_visit_date:
        now = datetime.now(timezone.utc)
        d = st.last_visit_date
        if d.tzinfo is None:
            d = d.replace(tzinfo=timezone.utc)
        st.days_since_last_visit = max((now - d).days, 0)

    # معدل الكيلومترات اليومي من آخر زيارتين
    if len(rows) >= 2 and rows[0]["odometer"] and rows[1]["odometer"]:
        km_diff = int(rows[0]["odometer"]) - int(rows[1]["odometer"])
        d0, d1 = rows[0]["invoice_date"], rows[1]["invoice_date"]
        if d0 and d1:
            days = max((d0 - d1).days, 1)
            if km_diff > 0:
                st.avg_km_per_day = round(km_diff / days, 1)

    base = st.last_visit_odometer or last_odometer
    if base and st.avg_km_per_day and st.days_since_last_visit is not None:
        st.estimated_odometer_now = int(base + st.avg_km_per_day * st.days_since_last_visit)
        st.km_since_last_service = st.estimated_odometer_now - int(base)

    if st.km_since_last_service and st.km_since_last_service >= SERVICE_INTERVAL_KM:
        st.service_due = True
        st.service_due_note = (
            f"تقديرياً قطعت {st.km_since_last_service:,} كم منذ آخر خدمة "
            f"(الحد {SERVICE_INTERVAL_KM:,} كم) — موعد التغيير حان."
        )
    elif st.days_since_last_visit and st.days_since_last_visit >= 180:
        st.service_due = True
        st.service_due_note = f"مر {st.days_since_last_visit} يوم على آخر خدمة."

    return st


# ---------------------------------------------------------------------------
# بناء سلة الفاتورة من آخر زيارة
# ---------------------------------------------------------------------------
async def build_cart(conn, car_id, customer_id) -> SuggestedCart:
    cart = SuggestedCart()

    inv = await conn.fetchrow(Q.Q_LAST_INVOICE_BY_CAR, car_id)
    source = "last_car_invoice"

    if not inv and customer_id is not None:
        inv = await conn.fetchrow(Q.Q_LAST_INVOICE_BY_CUSTOMER, customer_id)
        source = "last_customer_invoice"
        if inv:
            cart.warnings.append("لا توجد فاتورة سابقة لهذه السيارة — تم جلب آخر فاتورة للعميل.")

    if not inv:
        cart.warnings.append("عميل مسجل بدون فواتير سابقة — ابدأ فاتورة جديدة.")
        return cart

    cart.source = source
    cart.source_invoice_id = inv["id"]
    cart.source_invoice_number = inv["invoice_number"]
    cart.source_invoice_date = inv["invoice_date"]

    items = await conn.fetch(Q.Q_INVOICE_ITEMS, inv["id"])
    subtotal = Decimal("0")

    for it in items:
        old_price = Decimal(str(it["old_price"] or 0))
        cur_price = it["current_price"]
        cur_price = Decimal(str(cur_price)) if cur_price is not None else old_price

        qty = Decimal(str(it["quantity"] or 1))
        disc = Decimal(str(it["discount"] or 0))
        line_total = (qty * cur_price) - disc

        line = CartLine(
            product_id=it["product_id"],
            product_name=it["product_name"] or "صنف محذوف",
            sku=it["sku"],
            quantity=qty,
            unit_price=cur_price,
            old_price=old_price,
            discount=disc,
            line_total=line_total,
            is_service=bool(it["is_service"]),
            price_changed=(cur_price != old_price),
            unavailable=not bool(it["is_active"]),
        )

        if line.price_changed:
            line.note = f"السعر اتغير من {old_price} إلى {cur_price}"
            cart.warnings.append(f"{line.product_name}: تحديث سعر {old_price} ← {cur_price}")
        if line.unavailable:
            line.note = "الصنف موقوف حالياً"
            cart.warnings.append(f"{line.product_name}: صنف موقوف — راجعه قبل الحفظ.")

        subtotal += line_total
        cart.lines.append(line)

    cart.subtotal = subtotal.quantize(Decimal("0.01"))
    cart.vat = (subtotal * VAT_RATE).quantize(Decimal("0.01"))
    cart.total = (cart.subtotal + cart.vat).quantize(Decimal("0.01"))
    return cart


# ---------------------------------------------------------------------------
# الدخول التلقائي للطابور
# ---------------------------------------------------------------------------
async def do_checkin(conn, car_id, customer_id, branch_id,
                     odometer: Optional[int] = None,
                     station: Optional[str] = None,
                     notes: str = "دخول تلقائي — البوابة الذكية"):
    """يسجل السيارة في طابور الخدمة. آمن ضد التكرار."""
    open_q = await conn.fetchrow(Q.Q_OPEN_QUEUE_FOR_CAR, car_id)
    if open_q:
        return open_q["id"], True   # (queue_id, already_inside)

    async with conn.transaction():
        row = await conn.fetchrow(
            Q.Q_INSERT_QUEUE,
            car_id, customer_id, branch_id,
            DEFAULT_QUEUE_STATUS, station or DEFAULT_STATION,
            odometer, notes,
        )
        if odometer:
            await conn.execute(Q.Q_UPDATE_CAR_ODOMETER, car_id, odometer)
        # ── أمر عمل مؤقت: السيارة دخلت فعلياً — تتحول 'preparing' وتفضل مخفية
        #    عن الكاشير لحد ما موظف الإعداد يؤكد الأصناف والبيانات ──
        await conn.execute(
            "UPDATE cars SET work_status='preparing' WHERE id=$1 AND work_status='queued'",
            car_id)

    return row["id"], False


# ---------------------------------------------------------------------------
# المعالجة الكاملة للقطة
# ---------------------------------------------------------------------------
async def process_image(conn, image_bytes: bytes, branch_id, *,
                        camera_id: Optional[str] = None,
                        filename: str = "",
                        image_path: Optional[str] = None,
                        auto_checkin: bool = True) -> GateEvent:
    """نقطة الدخول الرئيسية: صورة -> حدث كامل جاهز للشاشة"""

    # 1) قراءة اللوحة
    try:
        v = await vision.read_plate(image_bytes, filename)
    except Exception as e:
        log.exception("فشل قراءة اللوحة")
        return GateEvent(status="error", message=f"تعذّرت قراءة اللوحة: {e}",
                         branch_id=branch_id, camera_id=camera_id,
                         plate=PlateReadResult())

    raw_plate = v.get("plate_ar") or v.get("plate_en") or ""
    confidence = float(v.get("confidence") or 0)
    key = normalize_plate(raw_plate)

    plate_res = PlateReadResult(
        plate_raw=raw_plate,
        plate_display_ar=key.display_ar,
        plate_display_en=key.display_en,
        canonical=key.canonical,
        loose=key.loose,
        digits=key.digits,
        letters_ar=key.letters_ar,
        confidence=confidence,
        is_valid_format=key.is_valid,
        model_used=v.get("_model", ""),
        issues=v.get("issues"),
    )

    # 2) لا توجد لوحة صالحة
    if not v.get("plate_found", True) or not key.is_valid:
        ev = GateEvent(status="no_plate", branch_id=branch_id, camera_id=camera_id,
                       plate=plate_res,
                       message="لم يتم التقاط لوحة واضحة — أعد المحاولة أو أدخل اللوحة يدوياً")
        await _save_and_broadcast(conn, ev, image_path, v)
        return ev

    # 3) فحص التكرار (نفس السيارة دخلت من دقايق)
    dup = await conn.fetchrow(Q.Q_RECENT_DUPLICATE, key.canonical,
                              branch_id, str(DUPLICATE_WINDOW_MINUTES))
    if dup:
        ev = GateEvent(status="duplicate", branch_id=branch_id, camera_id=camera_id,
                       plate=plate_res, already_inside=True,
                       message=f"اللوحة {key.display_ar} مسجّل دخولها بالفعل — تم تجاهل اللقطة")
        await _save_and_broadcast(conn, ev, image_path, v)
        return ev

    # 4) المطابقة
    row, mode, candidates = await match_plate(conn, key)
    plate_res_mode = mode

    # 4-أ) غير مسجّل
    if row is None and not candidates:
        ev = GateEvent(status="unknown", branch_id=branch_id, camera_id=camera_id,
                       plate=plate_res, match_mode=mode,
                       message=f"سيارة غير مسجّلة — {key.display_ar}. سجّل العميل الآن.")
        await _save_and_broadcast(conn, ev, image_path, v)
        return ev

    # 4-ب) أكثر من احتمال
    if row is None and candidates:
        ev = GateEvent(status="needs_confirm", branch_id=branch_id, camera_id=camera_id,
                       plate=plate_res, match_mode="fuzzy",
                       candidates=[_row_to_car(c) for c in candidates],
                       message="أكثر من سيارة مطابقة — اختر السيارة الصحيحة")
        await _save_and_broadcast(conn, ev, image_path, v)
        return ev

    # 5) اتلاقت السيارة
    car = _row_to_car(row)
    customer = _row_to_customer(row)
    stats = await build_stats(conn, car.car_id, car.last_odometer)
    cart = await build_cart(conn, car.car_id, customer.customer_id)

    low_confidence = confidence < AUTO_CHECKIN_MIN_CONFIDENCE
    weak_match = plate_res_mode in ("loose", "fuzzy")

    # 5-أ) ثقة ضعيفة -> تأكيد بشري
    if low_confidence or weak_match:
        reason = ("ثقة القراءة منخفضة" if low_confidence else "مطابقة تقريبية")
        ev = GateEvent(status="needs_confirm", branch_id=branch_id, camera_id=camera_id,
                       plate=plate_res, match_mode=plate_res_mode,
                       car=car, customer=customer, stats=stats, cart=cart,
                       message=f"{reason} — أكّد أن السيارة صحيحة قبل الدخول")
        await _save_and_broadcast(conn, ev, image_path, v)
        return ev

    # 5-ب) دخول تلقائي
    queue_id, already_inside = (None, False)
    if auto_checkin:
        queue_id, already_inside = await do_checkin(
            conn, car.car_id, customer.customer_id, branch_id,
            odometer=stats.estimated_odometer_now or car.last_odometer,
        )

    ev = GateEvent(
        status="checked_in" if queue_id else "matched",
        branch_id=branch_id, camera_id=camera_id,
        plate=plate_res, match_mode=plate_res_mode,
        car=car, customer=customer, stats=stats, cart=cart,
        queue_id=queue_id, already_inside=already_inside,
        pos_url=f"{POS_BASE_URL}?car_id={car.car_id}&queue_id={queue_id or ''}",
        message=(f"أهلاً {customer.name or ''} — تم تسجيل الدخول تلقائياً"
                 if not already_inside else
                 f"{customer.name or ''} — السيارة موجودة بالفعل داخل المركز"),
    )
    await _save_and_broadcast(conn, ev, image_path, v)
    return ev


async def _save_and_broadcast(conn, ev: GateEvent, image_path, vision_raw: dict):
    """يحفظ اللقطة في السجل ويبثها للشاشات"""
    try:
        rec = await conn.fetchrow(
            Q.Q_INSERT_SCAN,
            ev.branch_id, ev.camera_id,
            ev.plate.plate_raw, ev.plate.canonical, ev.plate.loose,
            ev.plate.plate_display_ar, ev.plate.confidence,
            ev.match_mode, ev.status,
            ev.car.car_id if ev.car else None,
            ev.customer.customer_id if ev.customer else None,
            ev.queue_id, image_path,
            vision_raw.get("_model"), (vision_raw.get("_raw") or "")[:2000],
        )
        ev.scan_id = rec["id"]
        ev.created_at = rec["created_at"]
    except Exception:
        log.exception("فشل حفظ سجل اللقطة (الحدث هيتبعت برضه)")

    try:
        await hub.broadcast(ev.branch_id, ev.model_dump())
    except Exception:
        log.exception("فشل البث للشاشات")


# ---------------------------------------------------------------------------
# التأكيد اليدوي
# ---------------------------------------------------------------------------
async def confirm_scan(conn, scan_id, car_id, branch_id, *,
                       odometer: Optional[int] = None,
                       station: Optional[str] = None,
                       notes: Optional[str] = None) -> GateEvent:
    """الموظف اختار السيارة الصحيحة -> نكمل الدخول عادي"""
    row = await conn.fetchrow(Q.Q_FIND_CAR_EXACT.replace(
        f"WHERE c.{Q.C['car_plate_norm']} = $1",
        f"WHERE c.{Q.C['car_id']} = $1",
    ), car_id)

    if not row:
        raise ValueError("السيارة غير موجودة")

    car = _row_to_car(row)
    customer = _row_to_customer(row)
    stats = await build_stats(conn, car.car_id, car.last_odometer)
    cart = await build_cart(conn, car.car_id, customer.customer_id)

    queue_id, already_inside = await do_checkin(
        conn, car.car_id, customer.customer_id, branch_id,
        odometer=odometer or stats.estimated_odometer_now or car.last_odometer,
        station=station,
        notes=notes or "دخول بتأكيد الموظف — البوابة الذكية",
    )

    if scan_id:
        try:
            await conn.execute(Q.Q_UPDATE_SCAN_STATUS, scan_id, "checked_in",
                               car.car_id, customer.customer_id, queue_id)
        except Exception:
            log.exception("فشل تحديث حالة اللقطة")

    ev = GateEvent(
        scan_id=scan_id, status="checked_in", branch_id=branch_id,
        plate=PlateReadResult(plate_display_ar=car.plate_number or "", confidence=1.0),
        match_mode="manual", car=car, customer=customer,
        stats=stats, cart=cart, queue_id=queue_id, already_inside=already_inside,
        pos_url=f"{POS_BASE_URL}?car_id={car.car_id}&queue_id={queue_id or ''}",
        message=f"تم تسجيل دخول {customer.name or ''} بتأكيد الموظف",
    )
    await hub.broadcast(branch_id, ev.model_dump())
    return ev


async def process_manual_plate(conn, plate: str, branch_id, *,
                               odometer: Optional[int] = None,
                               auto_checkin: bool = True) -> GateEvent:
    """إدخال يدوي للوحة (لو الكاميرا وقعت أو اللوحة متسخة)"""
    key = normalize_plate(plate)
    plate_res = PlateReadResult(
        plate_raw=plate, plate_display_ar=key.display_ar,
        plate_display_en=key.display_en, canonical=key.canonical,
        loose=key.loose, digits=key.digits, letters_ar=key.letters_ar,
        confidence=1.0, is_valid_format=key.is_valid, model_used="manual",
    )

    if not key.is_valid:
        return GateEvent(status="no_plate", branch_id=branch_id, plate=plate_res,
                         message="صيغة اللوحة غير صحيحة (المطلوب 3 حروف + أرقام)")

    row, mode, candidates = await match_plate(conn, key)

    if row is None:
        return GateEvent(status="unknown", branch_id=branch_id, plate=plate_res,
                         match_mode=mode,
                         candidates=[_row_to_car(c) for c in candidates],
                         message=f"سيارة غير مسجّلة — {key.display_ar}")

    car = _row_to_car(row)
    customer = _row_to_customer(row)
    stats = await build_stats(conn, car.car_id, car.last_odometer)
    cart = await build_cart(conn, car.car_id, customer.customer_id)

    queue_id, already_inside = (None, False)
    if auto_checkin:
        queue_id, already_inside = await do_checkin(
            conn, car.car_id, customer.customer_id, branch_id,
            odometer=odometer or stats.estimated_odometer_now or car.last_odometer,
            notes="إدخال يدوي — البوابة الذكية",
        )

    ev = GateEvent(
        status="checked_in" if queue_id else "matched",
        branch_id=branch_id, plate=plate_res, match_mode=mode,
        car=car, customer=customer, stats=stats, cart=cart,
        queue_id=queue_id, already_inside=already_inside,
        pos_url=f"{POS_BASE_URL}?car_id={car.car_id}&queue_id={queue_id or ''}",
        message=f"أهلاً {customer.name or ''}",
    )
    await hub.broadcast(branch_id, ev.model_dump())
    return ev


async def recent_scans(conn, branch_id, limit: int = 30):
    rows = await conn.fetch(Q.Q_RECENT_SCANS, branch_id, limit)
    return [dict(r) for r in rows]
