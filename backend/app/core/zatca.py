# core/zatca.py — توليد نص QR بصيغة TLV/Base64 وفق مواصفات هيئة الزكاة والضريبة (ZATCA)
# منقول بالحرف من zatca.service.js
#
# المرحلة الأولى (Generation) للفواتير المبسطة B2C تتطلب 5 حقول (Tags 1-5):
#   Tag 1: اسم البائع · Tag 2: الرقم الضريبي للبائع · Tag 3: الطابع الزمني ISO 8601
#   Tag 4: إجمالي الفاتورة شامل الضريبة · Tag 5: إجمالي ضريبة القيمة المضافة
#
# ⚠ المرحلة الثانية (Integration): الحقول 6-9 (تجزئة XML، التوقيع الرقمي، المفتاح
#    العام، ختم الهيئة) تُضاف فقط بعد التسجيل في بوابة فاتورة والحصول على شهادة CSID.
#    الدالة مبنية بحيث يمكن تمرير phase2_tags لاحقاً بدون تغيير الواجهة.
import base64
from datetime import datetime, timezone


def tlv(tag: int, value: str) -> bytes:
    """يبني tuple واحد بصيغة TLV: [tag][length][value bytes]
    length هو طول القيمة بعد ترميز UTF-8 (بايت واحد، حتى 255)"""
    value_bytes = str(value).encode("utf-8")
    if len(value_bytes) > 255:
        # للمرحلة الأولى القيم دائماً أقصر من ذلك؛ نتركها كحماية فقط
        raise ValueError(f"قيمة الحقل {tag} أطول من 255 بايت — غير مدعوم في هذا الترميز المبسّط")
    return bytes([tag, len(value_bytes)]) + value_bytes


def _to_iso_utc_z(ts) -> str:
    """يطابق صيغة JS's toISOString(): دايماً UTC بلاحقة Z، بغض النظر عن منطقة الإدخال.
    وقت بدون منطقة زمنية (naive) بيتفرض إنه UTC أصلاً (نفس افتراض `new Date(...)`)."""
    dt = ts if isinstance(ts, datetime) else datetime.fromisoformat(str(ts))
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    else:
        dt = dt.astimezone(timezone.utc)
    return dt.strftime("%Y-%m-%dT%H:%M:%SZ")


def generate_qr_tlv(
    *, seller_name: str, vat_number: str, timestamp,
    total_with_vat: float, vat_total: float, phase2_tags: list[bytes] | None = None,
) -> str:
    """يولّد نص QR بصيغة TLV/Base64 للفاتورة المبسطة (Tags 1-5)"""
    parts = [
        tlv(1, seller_name or ""),
        tlv(2, vat_number or ""),
        tlv(3, _to_iso_utc_z(timestamp)),
        tlv(4, f"{float(total_with_vat or 0):.2f}"),
        tlv(5, f"{float(vat_total or 0):.2f}"),
        *(phase2_tags or []),
    ]
    return base64.b64encode(b"".join(parts)).decode("ascii")
