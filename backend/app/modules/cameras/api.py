# modules/cameras/api.py — تسجيل كاميرات المحطات + التقاط لقطة اختبار عبر RTSP
# اللقطات هي وقود المرحلة الجاية (تحليل Claude Vision وتحديث التشييك آلياً)
import asyncio
import base64

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from ...core.db import execute, fetch, fetchrow
from ...core.deps import CurrentUser, require_permission

router = APIRouter()
_PERM = "settings.company"


class CameraIn(BaseModel):
    branchId: str
    station: int = Field(ge=1, le=3)          # 1 دخول / 2 زيت / 3 تشييك نهائي
    name: str = Field(min_length=1)
    rtspUrl: str = Field(min_length=7)        # rtsp://user:pass@ip:554/...


class CameraOut(BaseModel):
    id: str
    branch_id: str
    branch_name: str | None = None
    station: int
    name: str
    rtsp_url: str
    is_active: bool


def _row(r: dict) -> dict:
    r = dict(r)
    r["id"] = str(r["id"]); r["branch_id"] = str(r["branch_id"])
    return r


@router.get("", response_model=list[CameraOut])
async def list_cameras(user: CurrentUser = Depends(require_permission(_PERM))):
    rows = await fetch(
        """SELECT c.*, b.name AS branch_name
           FROM station_cameras c LEFT JOIN branches b ON b.id = c.branch_id
           WHERE c.company_id=$1 ORDER BY b.name, c.station""",
        user.company_id)
    return [_row(r) for r in rows]


@router.post("", response_model=CameraOut, status_code=201)
async def create_camera(body: CameraIn, user: CurrentUser = Depends(require_permission(_PERM))):
    row = await fetchrow(
        """INSERT INTO station_cameras (company_id, branch_id, station, name, rtsp_url)
           VALUES ($1,$2,$3,$4,$5) RETURNING *, NULL AS branch_name""",
        user.company_id, body.branchId, body.station, body.name.strip(), body.rtspUrl.strip())
    return _row(row)


@router.put("/{camera_id}", response_model=CameraOut)
async def update_camera(camera_id: str, body: CameraIn,
                        user: CurrentUser = Depends(require_permission(_PERM))):
    row = await fetchrow(
        """UPDATE station_cameras SET branch_id=$1, station=$2, name=$3, rtsp_url=$4
           WHERE id=$5 AND company_id=$6 RETURNING *, NULL AS branch_name""",
        body.branchId, body.station, body.name.strip(), body.rtspUrl.strip(),
        camera_id, user.company_id)
    if not row:
        raise HTTPException(404, "الكاميرا غير موجودة")
    return _row(row)


@router.delete("/{camera_id}", status_code=204)
async def delete_camera(camera_id: str, user: CurrentUser = Depends(require_permission(_PERM))):
    row = await fetchrow(
        "DELETE FROM station_cameras WHERE id=$1 AND company_id=$2 RETURNING id",
        camera_id, user.company_id)
    if not row:
        raise HTTPException(404, "الكاميرا غير موجودة")


# ══════════════════ التقاط لقطة (RTSP → JPEG) ══════════════════

def _grab_frame(rtsp_url: str) -> bytes:
    """بيتنفذ في Thread منفصل لأن OpenCV بيحجز التنفيذ"""
    try:
        import cv2  # opencv-python-headless — بيتسطب عبر INSTALL-Z8.bat
    except ImportError:
        raise HTTPException(500, "مكتبة الكاميرات غير مسطّبة — شغّل INSTALL-Z8.bat مرة واحدة")
    cap = cv2.VideoCapture(rtsp_url, cv2.CAP_FFMPEG)
    try:
        cap.set(cv2.CAP_PROP_OPEN_TIMEOUT_MSEC, 6000)
        cap.set(cv2.CAP_PROP_READ_TIMEOUT_MSEC, 6000)
    except Exception:
        pass
    try:
        if not cap.isOpened():
            raise HTTPException(502, "تعذّر فتح بث الكاميرا — راجع العنوان والباسورد وإن الكاميرا على نفس الشبكة")
        ok, frame = cap.read()
        if not ok or frame is None:
            raise HTTPException(502, "الكاميرا متصلة لكن اللقطة فشلت — جرّب تاني أو راجع مسار البث")
        ok, buf = cv2.imencode(".jpg", frame, [int(cv2.IMWRITE_JPEG_QUALITY), 82])
        if not ok:
            raise HTTPException(500, "فشل ترميز اللقطة")
        return bytes(buf)
    finally:
        cap.release()


@router.post("/{camera_id}/snapshot")
async def snapshot(camera_id: str, user: CurrentUser = Depends(require_permission(_PERM))):
    cam = await fetchrow(
        "SELECT rtsp_url, name FROM station_cameras WHERE id=$1 AND company_id=$2",
        camera_id, user.company_id)
    if not cam:
        raise HTTPException(404, "الكاميرا غير موجودة")
    jpeg = await asyncio.to_thread(_grab_frame, cam["rtsp_url"])
    return {"name": cam["name"], "image_base64": base64.b64encode(jpeg).decode()}


# ══════════════════ نقاط خط الخدمة (لموظفي التشغيل) ══════════════════

_LINE_PERMS = ("cars.create", "cars.confirm_entry", "cars.confirm_exit", "cars.edit")

# نقاط التشييك لكل محطة — مطابقة لتعريف الواجهة في lib/service-line.ts
STAGE_CHECKPOINTS: dict[int, list[dict]] = {
    1: [
        {"key": "air_filter",     "label": "فك فلتر الهواء وتنظيفه أو تبديله"},
        {"key": "coolant_top",    "label": "تزويد ماء الرديتر"},
        {"key": "wiper_fluid",    "label": "تزويد ماء المساحات"},
        {"key": "drain_plug_off", "label": "فك صرة الزيت من أسفل"},
        {"key": "oil_filter_off", "label": "فك فلتر الزيت"},
        {"key": "oil_filter_on",  "label": "تركيب فلتر الزيت الجديد"},
    ],
    2: [
        {"key": "oil_suction",    "label": "شفط الزيت المتبقي بجهاز الشفط"},
        {"key": "drain_plug_on",  "label": "تركيب صرة الزيت"},
        {"key": "oil_fill",       "label": "تعبئة الزيت الجديد"},
        {"key": "oil_cap_close",  "label": "إغلاق غطاء الزيت"},
    ],
    3: [
        {"key": "dipstick_check", "label": "فحص مستوى الزيت بالعيار"},
        {"key": "leak_check",     "label": "فحص أسفل السيارة: تسريب أم سليم"},
        {"key": "air_clean",      "label": "تنظيف الماكينة بالهواء من الغبار"},
    ],
}


@router.get("/for-station")
async def cameras_for_station(branchId: str, station: int,
                              user: CurrentUser = Depends(require_permission(*_LINE_PERMS))):
    """كاميرات محطة معينة — متاحة لموظفي خط الخدمة لالتقاط اللوحة والتحليل"""
    rows = await fetch(
        """SELECT id, name, station FROM station_cameras
           WHERE company_id=$1 AND branch_id=$2 AND station=$3 AND is_active=TRUE
           ORDER BY name""",
        user.company_id, branchId, station)
    return [{"id": str(r["id"]), "name": r["name"], "station": r["station"]} for r in rows]


@router.post("/{camera_id}/grab")
async def grab_for_line(camera_id: str,
                        user: CurrentUser = Depends(require_permission(*_LINE_PERMS))):
    """لقطة خام من كاميرا المحطة — تُستخدم لقراءة اللوحة من كاميرا الدخول"""
    cam = await fetchrow(
        "SELECT rtsp_url, name FROM station_cameras WHERE id=$1 AND company_id=$2",
        camera_id, user.company_id)
    if not cam:
        raise HTTPException(404, "الكاميرا غير موجودة")
    jpeg = await asyncio.to_thread(_grab_frame, cam["rtsp_url"])
    return {"name": cam["name"], "image_base64": base64.b64encode(jpeg).decode()}


def _analyze_call(api_key: str, image_b64: str, stage: int) -> list[dict]:
    """تحليل لقطة المحطة بالرؤية — بيتنفذ في Thread"""
    import json as _json
    import urllib.request as _rq
    import urllib.error as _er

    steps = STAGE_CHECKPOINTS.get(stage, [])
    steps_txt = "\n".join(f'- key="{s["key"]}": {s["label"]}' for s in steps)
    prompt = (
        f"You are an automated quality supervisor for station {stage} of a Saudi car oil-change service line. "
        f"The steps performed at this station are:\n{steps_txt}\n"
        "Look at the image and for EACH step judge what is visible RIGHT NOW:\n"
        '- "in_progress" if a worker appears to be doing it now\n'
        '- "done" if there is clear visual evidence it was completed\n'
        '- "needs" if you see a problem (leak, open oil cap, missing part)\n'
        '- "pending" if you cannot tell from the image\n'
        "Be conservative: prefer pending over guessing. Write the note in Arabic (short). "
        "Respond ONLY with a JSON array like: "
        '[{"key":"oil_fill","status":"in_progress","note":"عامل يعبئ الزيت","confidence":0.8}]'
    )
    payload = _json.dumps({
        "model": "claude-haiku-4-5-20251001",
        "max_tokens": 700,
        "messages": [{"role": "user", "content": [
            {"type": "image", "source": {"type": "base64", "media_type": "image/jpeg", "data": image_b64}},
            {"type": "text", "text": prompt},
        ]}],
    }).encode()
    req = _rq.Request("https://api.anthropic.com/v1/messages", data=payload, method="POST",
                      headers={"Content-Type": "application/json", "x-api-key": api_key,
                               "anthropic-version": "2023-06-01"})
    try:
        with _rq.urlopen(req, timeout=35) as resp:
            data = _json.loads(resp.read().decode())
    except _er.HTTPError as e:
        if e.code == 401:
            raise RuntimeError("المفتاح مرفوض (401) — راجع ANTHROPIC_API_KEY")
        raise RuntimeError(f"خدمة الرؤية ردّت بخطأ {e.code}")
    except _er.URLError as e:
        raise RuntimeError(f"تعذّر الوصول لخدمة الرؤية ({e.reason})")
    text = "".join(b.get("text", "") for b in data.get("content", []) if b.get("type") == "text")
    text = text.replace("```json", "").replace("```", "").strip()
    items = _json.loads(text)
    valid_keys = {s["key"] for s in STAGE_CHECKPOINTS.get(stage, [])}
    return [i for i in items if isinstance(i, dict) and i.get("key") in valid_keys]


@router.post("/{camera_id}/analyze-stage")
async def analyze_stage(camera_id: str, stage: int,
                        user: CurrentUser = Depends(require_permission(*_LINE_PERMS))):
    """المشرف الآلي: لقطة من كاميرا المحطة + تحليل Claude Vision → اقتراحات التشييك"""
    from ...core.config import settings as cfg
    key = (cfg.ANTHROPIC_API_KEY or "").strip()
    if not key:
        raise HTTPException(503, "المراقبة الذكية غير مفعّلة — أضف ANTHROPIC_API_KEY في backend/.env")
    cam = await fetchrow(
        "SELECT rtsp_url, name, station FROM station_cameras WHERE id=$1 AND company_id=$2",
        camera_id, user.company_id)
    if not cam:
        raise HTTPException(404, "الكاميرا غير موجودة")

    jpeg = await asyncio.to_thread(_grab_frame, cam["rtsp_url"])
    img_b64 = base64.b64encode(jpeg).decode()
    try:
        items = await asyncio.to_thread(_analyze_call, key, img_b64, stage)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(502, f"فشل تحليل اللقطة: {e}")

    return {"camera": cam["name"], "stage": stage, "items": items, "image_base64": img_b64}


# ══════════════════ صياد الأخطاء: كتالوج أخطاء ورشة الزيوت ══════════════════
_FAULT_CATALOG = """
- oil_cap_open: غطاء فتحة تعبئة الزيت مفتوح أو غير مركّب على المحرك
- drain_plug_missing: صرة تصريف الزيت غير مركّبة أو بيخرج منها زيت
- oil_leak: تسريب أو بقعة زيت واضحة (أرضية / أسفل السيارة / على المحرك)
- old_filter_left: فلتر زيت قديم أو خرطوشة متروكة في حجرة المحرك أو على السيارة
- tools_left: عدة أو مفاتيح أو قمع متروكة داخل حجرة المحرك أو على الرفارف
- open_bottle_on_engine: عبوة زيت مفتوحة موضوعة فوق المحرك
- hood_open_leaving: الكبوت مفتوح وتبدو السيارة جاهزة للخروج
- dipstick_out: عصا قياس الزيت مسحوبة وغير مركّبة
- cloth_left: قماش أو فوطة متروكة في حجرة المحرك
- danger_under_car: شخص أسفل السيارة في وضع خطر
"""


def _error_hunt_call(api_key: str, image_b64: str) -> list[dict]:
    """تحليل متخصص: صيد أخطاء ورشة الزيوت من لقطة المحطة"""
    import json as _json
    import urllib.error as _er
    import urllib.request as _rq

    prompt = (
        "أنت مفتش جودة آلي في مركز تغيير زيوت سيارات سعودي. افحص الصورة بدقة بحثاً عن الأخطاء "
        f"التالية فقط:\n{_FAULT_CATALOG}\n"
        "قواعد صارمة:\n"
        "- بلّغ فقط عمّا تراه بوضوح فعلي في الصورة. كن متحفظاً جداً — عدم البلاغ أفضل من بلاغ كاذب.\n"
        "- severity: high للأخطاء التي تمنع خروج السيارة (غطاء، صرة، تسريب، خطر)، medium للباقي.\n"
        "- note بالعربي: أين تراه في الصورة بإيجاز.\n"
        'رد بمصفوفة JSON فقط (فاضية لو لا أخطاء): '
        '[{"code":"oil_cap_open","severity":"high","note":"غطاء الزيت مفتوح أعلى يمين المحرك","confidence":0.9}]'
    )
    payload = _json.dumps({
        "model": "claude-haiku-4-5-20251001",
        "max_tokens": 500,
        "messages": [{"role": "user", "content": [
            {"type": "image", "source": {"type": "base64", "media_type": "image/jpeg", "data": image_b64}},
            {"type": "text", "text": prompt},
        ]}],
    }).encode()
    req = _rq.Request("https://api.anthropic.com/v1/messages", data=payload, method="POST",
                      headers={"Content-Type": "application/json", "x-api-key": api_key,
                               "anthropic-version": "2023-06-01"})
    try:
        with _rq.urlopen(req, timeout=35) as resp:
            data = _json.loads(resp.read().decode())
    except _er.HTTPError as e:
        raise RuntimeError(f"خدمة الرؤية ردّت بخطأ {e.code}")
    except _er.URLError as e:
        raise RuntimeError(f"تعذّر الوصول لخدمة الرؤية ({e.reason})")
    text = "".join(b.get("text", "") for b in data.get("content", []) if b.get("type") == "text")
    text = text.replace("```json", "").replace("```", "").strip()
    try:
        items = _json.loads(text)
    except ValueError:
        return []
    _AR = {"oil_cap_open": "غطاء الزيت مفتوح", "drain_plug_missing": "صرة التصريف غير مركّبة",
           "oil_leak": "تسريب زيت", "old_filter_left": "فلتر قديم متروك", "tools_left": "عدة متروكة",
           "open_bottle_on_engine": "عبوة مفتوحة فوق المحرك", "hood_open_leaving": "الكبوت مفتوح",
           "dipstick_out": "عصا الزيت غير مركّبة", "cloth_left": "فوطة متروكة",
           "danger_under_car": "⚠ شخص أسفل السيارة"}
    out = []
    for i in items if isinstance(items, list) else []:
        if isinstance(i, dict) and i.get("code") in _AR:
            out.append({"code": i["code"], "label": _AR[i["code"]],
                        "severity": i.get("severity") or "medium",
                        "note": str(i.get("note") or "")[:150],
                        "confidence": float(i.get("confidence") or 0)})
    return out


def _compare_call(api_key: str, before_b64: str, after_b64: str) -> list[dict]:
    """المقارنة الذهبية: نفس السيارة قبل الشغل وبعده — الفروقات الخطرة فقط"""
    import json as _json
    import urllib.error as _er
    import urllib.request as _rq

    prompt = (
        "صورتان لنفس السيارة في محطة تغيير زيت سعودية: الأولى عند بدء الخدمة، الثانية الآن قبل التسليم. "
        f"قارنهما وابحث عن الأخطاء التالية في الصورة الثانية:\n{_FAULT_CATALOG}\n"
        "ركّز على الفروقات: شيء كان مركّباً وأصبح مفتوحاً/مفقوداً، أو جسم (فوطة/عدة/عبوة) ظهر ولم يكن موجوداً. "
        "كن متحفظاً — بلّغ فقط عن الواضح فعلاً في الصورة الثانية.\n"
        'رد بمصفوفة JSON فقط (فاضية لو سليم): '
        '[{"code":"oil_cap_open","severity":"high","note":"كان مغلقاً في لقطة الدخول والآن مفتوح","confidence":0.9}]'
    )
    payload = _json.dumps({
        "model": "claude-haiku-4-5-20251001",
        "max_tokens": 500,
        "messages": [{"role": "user", "content": [
            {"type": "text", "text": "لقطة الدخول (قبل الخدمة):"},
            {"type": "image", "source": {"type": "base64", "media_type": "image/jpeg", "data": before_b64}},
            {"type": "text", "text": "اللقطة الحالية (قبل التسليم):"},
            {"type": "image", "source": {"type": "base64", "media_type": "image/jpeg", "data": after_b64}},
            {"type": "text", "text": prompt},
        ]}],
    }).encode()
    req = _rq.Request("https://api.anthropic.com/v1/messages", data=payload, method="POST",
                      headers={"Content-Type": "application/json", "x-api-key": api_key,
                               "anthropic-version": "2023-06-01"})
    try:
        with _rq.urlopen(req, timeout=40) as resp:
            data = _json.loads(resp.read().decode())
    except _er.HTTPError as e:
        raise RuntimeError(f"خدمة الرؤية ردّت بخطأ {e.code}")
    except _er.URLError as e:
        raise RuntimeError(f"تعذّر الوصول لخدمة الرؤية ({e.reason})")
    text = "".join(b.get("text", "") for b in data.get("content", []) if b.get("type") == "text")
    text = text.replace("```json", "").replace("```", "").strip()
    try:
        items = _json.loads(text)
    except ValueError:
        return []
    return _normalize_faults(items)


def _normalize_faults(items) -> list[dict]:
    _AR = {"oil_cap_open": "غطاء الزيت مفتوح", "drain_plug_missing": "صرة التصريف غير مركّبة",
           "oil_leak": "تسريب زيت", "old_filter_left": "فلتر قديم متروك", "tools_left": "عدة متروكة",
           "open_bottle_on_engine": "عبوة مفتوحة فوق المحرك", "hood_open_leaving": "الكبوت مفتوح",
           "dipstick_out": "عصا الزيت غير مركّبة", "cloth_left": "فوطة متروكة",
           "danger_under_car": "⚠ شخص أسفل السيارة"}
    out = []
    for i in items if isinstance(items, list) else []:
        if isinstance(i, dict) and i.get("code") in _AR:
            out.append({"code": i["code"], "label": _AR[i["code"]],
                        "severity": i.get("severity") or "medium",
                        "note": str(i.get("note") or "")[:150],
                        "confidence": float(i.get("confidence") or 0)})
    return out


class ErrorScanIn(BaseModel):
    carId: str


@router.post("/error-scan")
async def error_scan(body: ErrorScanIn,
                     user: CurrentUser = Depends(require_permission(*_LINE_PERMS))):
    """الفحص الختامي: لقطة من كاميرا محطة السيارة + صيد أخطاء — يُستدعى قبل الدفع/الخروج"""
    from ...core.config import settings as cfg
    key = (cfg.ANTHROPIC_API_KEY or "").strip()
    if not key:
        raise HTTPException(503, "المراقبة الذكية غير مفعّلة")
    comp = await fetchrow("SELECT COALESCE(ai_supervisor_enabled, TRUE) AS en FROM companies WHERE id=$1",
                          user.company_id)
    if comp and not comp["en"]:
        return {"available": False, "faults": []}   # النظام مقفول من الإعدادات — الدفع يكمل عادي
    car = await fetchrow(
        """SELECT c.id, c.plate, c.station, c.ref_photo_b64, cam.rtsp_url
           FROM cars c
           JOIN station_cameras cam
             ON cam.company_id=c.company_id AND cam.branch_id=c.branch_id AND cam.is_active=TRUE
            AND cam.station::text = regexp_replace(COALESCE(c.station,''), '\\D', '', 'g')
           WHERE c.id=$1 AND c.company_id=$2 AND c.is_deleted=FALSE
           LIMIT 1""", body.carId, user.company_id)
    if not car:
        return {"available": False, "faults": []}
    jpeg = await asyncio.to_thread(_grab_frame, car["rtsp_url"])
    img_b64 = base64.b64encode(jpeg).decode()
    compared = bool(car["ref_photo_b64"])
    try:
        if compared:
            faults = await asyncio.to_thread(_compare_call, key, car["ref_photo_b64"], img_b64)
        else:
            faults = await asyncio.to_thread(_error_hunt_call, key, img_b64)
    except Exception as e:
        raise HTTPException(502, f"فشل الفحص: {e}")
    faults = [f for f in faults if f["confidence"] >= 0.6]
    # تسجيل الأخطاء العالية كتنبيهات
    for f in faults:
        if f["severity"] == "high":
            await execute(
                """INSERT INTO car_alerts (company_id, car_id, plate, station, message)
                   SELECT $1,$2,$3,$4,$5
                   WHERE NOT EXISTS (SELECT 1 FROM car_alerts WHERE car_id=$2 AND message=$5 AND seen=FALSE)""",
                user.company_id, car["id"], car["plate"], car["station"],
                f"🎯 {f['label']}: {f['note']}")
    return {"available": True, "faults": faults, "image_base64": img_b64, "compared": compared}


# ══════════════════ لقطة مباشرة من رابط كاميرا IP (للبوابة الحية) ══════════════════
# بيدعم روابط JPEG المباشرة زي IP Webcam: http://PHONE-IP:8080/shot.jpg
import base64 as _b64
import ipaddress as _ipa
import urllib.request as _rq
from urllib.parse import urlparse as _urlparse

from pydantic import BaseModel as _BM2


class SnapshotUrlIn(_BM2):
    url: str


def _is_private_host(host: str) -> bool:
    try:
        ip = _ipa.ip_address(host)
        if ip.is_private:
            return True
        # نطاق CGNAT المشترك (100.64.0.0/10) — بعض شبكات هوت سبوت الموبايل
        # وبعض الراوترات بتوزّع عناوين منه بدل الخاص التقليدي
        return ip in _ipa.ip_network("100.64.0.0/10")
    except ValueError:
        return host in ("localhost",)


@router.post("/fetch-snapshot")
async def fetch_snapshot_url(body: SnapshotUrlIn,
                             user: CurrentUser = Depends(require_permission(
                                 "cars.confirm_entry", "cars.create", "settings.company"))):
    parsed = _urlparse(body.url)
    if parsed.scheme not in ("http", "https") or not parsed.hostname:
        raise HTTPException(400, "رابط غير صالح — لازم يبدأ بـ http://")
    if not _is_private_host(parsed.hostname):
        raise HTTPException(400, "مسموح بكاميرات الشبكة المحلية فقط")

    import asyncio as _aio

    def _grab() -> bytes:
        req = _rq.Request(body.url, headers={"User-Agent": "Z8-Gate/1.0"})
        with _rq.urlopen(req, timeout=6) as resp:
            data = resp.read(6 * 1024 * 1024)
        if not data or len(data) < 100:
            raise RuntimeError("اللقطة فاضية")
        return data

    try:
        data = await _aio.to_thread(_grab)
    except Exception as e:
        raise HTTPException(502, f"تعذّر سحب اللقطة من الكاميرا: {e}")
    return {"image_base64": _b64.b64encode(data).decode()}


# ═══ لقطة حية HTTP من أي كاميرا مسجلة — جسر للشاشات التي تطلب رابط صورة مباشر ═══
from fastapi.responses import Response as _ImgResponse
import time as _time
_LIVE_CACHE: dict = {}


@router.get("/public-live/{camera_id}.jpg")
async def public_live_frame(camera_id: str):
    row = await fetchrow(
        "SELECT rtsp_url FROM station_cameras WHERE id=$1::uuid",
        camera_id)
    if not row:
        raise HTTPException(404, "الكاميرا غير موجودة")
    now = _time.time()
    cached = _LIVE_CACHE.get(camera_id)
    if cached and now - cached[0] < 2.0:
        return _ImgResponse(content=cached[1], media_type="image/jpeg")
    import cv2
    cap = cv2.VideoCapture(row["rtsp_url"], cv2.CAP_FFMPEG)
    try:
        ok, frame = False, None
        for _ in range(3):
            ok, frame = cap.read()
            if ok:
                break
    finally:
        cap.release()
    if not ok or frame is None:
        raise HTTPException(502, "تعذر الالتقاط من الكاميرا")
    ok, buf = cv2.imencode(".jpg", frame, [int(cv2.IMWRITE_JPEG_QUALITY), 80])
    data = buf.tobytes()
    _LIVE_CACHE[camera_id] = (now, data)
    return _ImgResponse(content=data, media_type="image/jpeg")



# ═══ 🩺 فحص كل الكاميرات دفعة واحدة — بدون فتح كل كاميرا ═══
from fastapi import Depends as _Dep
from ...core.deps import CurrentUser as _CU, get_current_user as _gcu


@router.post("/health-check")
async def cameras_health_check(user: _CU = _Dep(_gcu)):
    import asyncio
    import cv2
    rows = await fetch(
        """SELECT id, name, rtsp_url FROM station_cameras
           WHERE company_id=$1 AND is_active=TRUE ORDER BY station""",
        user.company_id)

    def _grab_ok(url: str) -> bool:
        cap = cv2.VideoCapture(url, cv2.CAP_FFMPEG)
        try:
            ok, _ = cap.read()
            return bool(ok)
        finally:
            cap.release()

    out = []
    for r in rows:
        try:
            ok = await asyncio.wait_for(asyncio.to_thread(_grab_ok, r["rtsp_url"]), timeout=8)
        except Exception:
            ok = False
        out.append({"id": str(r["id"]), "name": r["name"], "ok": ok})
    return {"cameras": out, "all_ok": bool(out) and all(c["ok"] for c in out)}

