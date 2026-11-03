# modules/cars/geofence.py — منع الحجز إلا من أمام الفرع فعلياً
# الفحص في الخادم (لا في التطبيق وحده): التطبيق يرسل موقعه إلى /geo-check فيرجع توكناً قصير العمر
# مربوطاً بالفرع، ولا يُقبل الحجز دونه. طبقات ضد تزييف الموقع (بلا شهادات أجهزة) — انظر check().
import math
import time

import jwt
from fastapi import HTTPException

from ...core.config import settings
from ...core.db import fetchrow

DEFAULT_RADIUS_M = 150
TOKEN_TTL_S = 180            # التوكن صالح 3 دقائق فقط ثم يُعاد فحص الموقع
MAX_ACCURACY_M = 100         # دقة أسوأ من هذا = إشارة ضعيفة، نطلب الانتظار/الخروج لمكان مفتوح
MAX_FIX_AGE_S = 60           # قراءة GPS أقدم من دقيقة = قديمة (مخزّنة)


def _key() -> str:
    return settings.JWT_SECRET + ":geofence"


def haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    r = 6371000.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = p2 - p1, math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


async def branch_rule(branch_id: str) -> dict:
    br = await fetchrow(
        "SELECT id, latitude, longitude, geofence_enabled, geofence_radius_m FROM branches WHERE id=$1::uuid AND is_frozen=FALSE",
        branch_id)
    if not br:
        raise HTTPException(404, "الفرع غير متاح للحجز حالياً")
    return {"enabled": bool(br["geofence_enabled"]), "radiusM": int(br["geofence_radius_m"] or DEFAULT_RADIUS_M),
            "lat": br["latitude"], "lng": br["longitude"]}


async def public_rule(branch_id: str) -> dict:
    r = await branch_rule(branch_id)
    return {"enabled": r["enabled"], "radiusM": r["radiusM"]}


def issue_token(branch_id: str, distance_m: float) -> str:
    now = int(time.time())
    return jwt.encode({"typ": "geo", "bid": branch_id, "d": round(distance_m), "iat": now, "exp": now + TOKEN_TTL_S},
                      _key(), algorithm="HS256")


async def check(branch_id: str, lat: float, lng: float, accuracy: float | None,
                mocked: bool = False, fix_age_s: float | None = None) -> dict:
    """يفحص موقع العميل. يرجع {ok, distanceM, radiusM, token?, reason?}. لا يخزّن الإحداثيات أبداً."""
    rule = await branch_rule(branch_id)
    if not rule["enabled"]:
        return {"enabled": False, "ok": True, "radiusM": rule["radiusM"]}
    if rule["lat"] is None or rule["lng"] is None:
        raise HTTPException(409, "موقع الفرع غير مضبوط — تواصل مع الفرع")
    out = {"enabled": True, "radiusM": rule["radiusM"]}
    if mocked:
        return {**out, "ok": False, "reason": "mock", "message": "تم اكتشاف موقع وهمي — أوقف تطبيقات تغيير الموقع ثم أعد المحاولة"}
    if not (-90 <= lat <= 90 and -180 <= lng <= 180):
        raise HTTPException(422, "موقع غير صالح")
    if accuracy is None or accuracy <= 0:
        # مزيّفو الموقع غالباً يرسلون دقة 0 أو لا يرسلونها؛ الحساس الحقيقي دائماً يعطي دقة موجبة
        return {**out, "ok": False, "reason": "no_accuracy", "message": "تعذّر التحقق من دقة موقعك — أعد المحاولة"}
    if fix_age_s is not None and fix_age_s > MAX_FIX_AGE_S:
        return {**out, "ok": False, "reason": "stale", "message": "موقعك قديم — انتظر ثوانٍ ليتحدّث ثم أعد المحاولة"}
    if accuracy > MAX_ACCURACY_M:
        return {**out, "ok": False, "reason": "weak", "accuracyM": round(accuracy),
                "message": "إشارة الموقع ضعيفة — اخرج لمكان مفتوح وانتظر ثوانٍ ثم أعد المحاولة"}
    d = haversine_m(lat, lng, rule["lat"], rule["lng"])
    # نحسب بالمسافة الأقرب الممكنة ضمن دقة الجهاز (تسامح لا يتجاوز 50 م حتى لا تُفتح الدائرة بدقة سيئة)
    effective = max(0.0, d - min(accuracy, 50.0))
    if effective > rule["radiusM"]:
        return {**out, "ok": False, "reason": "far", "distanceM": round(d),
                "message": f"أنت على بعد {round(d)} م من الفرع — اقترب لأقل من {rule['radiusM']} م لتتمكن من الحجز"}
    return {**out, "ok": True, "distanceM": round(d), "token": issue_token(branch_id, d)}


async def require(branch_id: str, token: str | None) -> None:
    """يُستدعى قبل إنشاء أي حجز: لو الفرع مفعّل الفحص ولا يوجد توكن صالح لهذا الفرع → 403."""
    rule = await branch_rule(branch_id)
    if not rule["enabled"]:
        return
    if not token:
        raise HTTPException(403, "الحجز متاح من تطبيق مصدر الزيوت وأنت أمام الفرع فقط — حدّث التطبيق وفعّل الموقع")
    try:
        c = jwt.decode(token, _key(), algorithms=["HS256"])
    except jwt.PyJWTError:
        raise HTTPException(403, "انتهت صلاحية التحقق من موقعك — تأكد أنك أمام الفرع ثم أعد المحاولة")
    if c.get("typ") != "geo" or c.get("bid") != str(branch_id):
        raise HTTPException(403, "التحقق من الموقع غير صالح لهذا الفرع")


async def web_blocked(branch_id: str) -> None:
    """الحجز عبر الويب ملغى حيث الفحص مفعّل — التطبيق فقط"""
    rule = await branch_rule(branch_id)
    if rule["enabled"]:
        raise HTTPException(403, "الحجز متاح الآن من تطبيق مصدر الزيوت فقط وأنت أمام الفرع")
