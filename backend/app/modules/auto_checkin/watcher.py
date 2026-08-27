"""
Z8 - البوابة الذكية | المراقب الخلفي الدائم
=============================================
يعمل داخل الباك اند نفسه بلا أي صفحة مفتوحة:
  كل بضع ثوانٍ: لقطة من كل كاميرا (المحطة 1 — الدخول)
    -> كشف حركة رخيص (بدون ذكاء) لتجاهل المشهد الثابت
    -> عند الحركة فقط: قراءة اللوحة عبر خط المعالجة الكامل الموجود
       (process_image: قراءة -> مطابقة -> فحص تكرار -> دخول تلقائي -> بث)

اقتصاديات الذكاء (ثلاث بوابات قبل أي استدعاء):
  1. حركة فعلية في الكادر (فرق متوسط > Z8_GATE_MOTION_LEVEL)
  2. تهدئة بين الاستدعاءات لكل كاميرا (Z8_GATE_VISION_COOLDOWN ثانية)
  3. نافذة منع التكرار داخل process_image نفسها (نفس اللوحة لا تُسجل مرتين)

الإيقاف: عطّل الكاميرا من صفحة «كاميرات المحطات» (is_active)
        أو ضع Z8_GATE_AUTO=off في backend/.env
"""

import os
import asyncio
import logging
import uuid
from pathlib import Path
from typing import Dict, Optional

log = logging.getLogger("z8.gate.watcher")

SCAN_INTERVAL = float(os.getenv("Z8_GATE_SCAN_INTERVAL", "1"))
VISION_COOLDOWN = float(os.getenv("Z8_GATE_VISION_COOLDOWN", "2"))
MOTION_LEVEL = float(os.getenv("Z8_GATE_MOTION_LEVEL", "12.0"))
GATE_AUTO = os.getenv("Z8_GATE_AUTO", "on").lower() in ("on", "1", "true", "yes")
CAMERAS_REFRESH = 10  # إعادة قراءة قائمة الكاميرات كل 10ث — المفاتيح تستجيب فوراً

SNAPSHOT_DIR = Path(os.getenv("Z8_SNAPSHOT_DIR", "./storage/gate_snapshots"))

_started = False
_enabled = True  # مفتاح التشغيل/الإيقاف من الواجهة (يرجع "تشغيل" مع كل إقلاع)


def set_enabled(value: bool) -> None:
    """تشغيل/إيقاف المراقب من الواجهة — بدون إعادة تشغيل الخادم"""
    global _enabled
    _enabled = bool(value)
    print(f"🎛 البوابة الذكية: {'تشغيل' if _enabled else 'إيقاف'} المراقب من الواجهة", flush=True)


def is_enabled() -> bool:
    return _enabled


def is_started() -> bool:
    return _started


# إحصاءات حية لكل كاميرا: آخر التقاط ونتيجته — تُعرض في مفاتيح الواجهة
_cam_stats: Dict[str, dict] = {}


def get_camera_stats() -> Dict[str, dict]:
    return dict(_cam_stats)


# سبب آخر فشل التقاط (للتشخيص الذاتي — يُطبع في اللوج بدل الفشل الصامت)
_grab_reason = ""


def _grab_http(url: str):
    """لقطة من كاميرا HTTP — الجوال (بلا مصادقة) أو Hikvision ISAPI (تتطلب Digest).
    الحل الجذري: استخراج بيانات الدخول من الرابط وتجربة Digest ثم Basic ثم عادي."""
    global _grab_reason
    from urllib.parse import urlsplit, urlunsplit
    try:
        import requests
        from requests.auth import HTTPDigestAuth, HTTPBasicAuth

        sp = urlsplit(url)
        user = _unquote(sp.username or "")
        pw = _unquote(sp.password or "")
        # الرابط بدون بيانات الدخول (بعض الخوادم ترفض وجودها في العنوان)
        host = sp.hostname or ""
        if sp.port:
            host += f":{sp.port}"
        clean = urlunsplit((sp.scheme, host, sp.path, sp.query, sp.fragment))

        attempts = ([HTTPDigestAuth(user, pw), HTTPBasicAuth(user, pw), None]
                    if user else [None])
        last = ""
        for auth in attempts:
            try:
                r = requests.get(clean, auth=auth, timeout=6)
                if r.status_code == 200 and r.content[:2] == b"\xff\xd8":
                    return r.content
                last = f"HTTP {r.status_code}"
            except Exception as e:
                last = f"{type(e).__name__}"
        _grab_reason = last or "بلا رد"
    except Exception as e:
        _grab_reason = f"{type(e).__name__}: {e}"
    return None


class _CamState:
    __slots__ = ("last_gray", "last_vision_ts", "last_fail_log")

    def __init__(self) -> None:
        self.last_gray = None
        self.last_vision_ts = 0.0
        self.last_fail_log = 0.0


import re as _re
from urllib.parse import unquote as _unquote


def _gray_from_jpeg(jpeg: bytes):
    """تحويل JPEG لرمادي مصغّر (لكشف الحركة)"""
    import cv2
    import numpy as np
    arr = np.frombuffer(jpeg, np.uint8)
    frame = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if frame is None:
        return None
    small = cv2.resize(frame, (480, 270))
    return cv2.cvtColor(small, cv2.COLOR_BGR2GRAY)


def _grab_isapi(rtsp_url: str):
    """═══ لقطة ISAPI فورية (أسلوب الموبايل) — بقراءة رابط قوية وسبب فشل واضح ═══"""
    global _grab_reason
    from urllib.parse import urlsplit
    try:
        sp = urlsplit(rtsp_url)
        user = _unquote(sp.username or "")
        pw = _unquote(sp.password or "")
        ip = sp.hostname or ""
    except Exception:
        user = pw = ip = ""
    if not ip:
        _grab_reason = "تعذر استخراج عنوان الكاميرا من الرابط"
        return None
    if not user or not pw:
        _grab_reason = "الرابط بلا مستخدم/باسورد — الصيغة: rtsp://user:pass@IP:554/..."
        return None
    try:
        import requests
        from requests.auth import HTTPDigestAuth
        auth = HTTPDigestAuth(user, pw)
        last = ""
        for path in ("/ISAPI/Streaming/channels/101/picture",
                     "/ISAPI/Streaming/channels/1/picture"):
            r = requests.get(f"http://{ip}{path}", auth=auth, timeout=6)
            if r.status_code == 200 and r.content[:2] == b"\xff\xd8":
                return r.content
            last = f"ISAPI {r.status_code}"
        _grab_reason = last or "ISAPI بلا رد"
    except Exception as e:
        _grab_reason = f"{type(e).__name__}: {e}"

    # ═══ الطبقة الجذرية الأخيرة: curl نفسه — الأداة المجربة الناجحة على هذا الجهاز ═══
    jpeg = _grab_curl(user, pw, ip)
    if jpeg is not None:
        return jpeg
    return None


def _grab_curl(user: str, pw: str, ip: str):
    """احتياطي نهائي: curl --digest (نفس الأمر الذي نجح يدوياً بالحرف)"""
    global _grab_reason
    import subprocess
    import sys
    curl = "curl.exe" if sys.platform == "win32" else "curl"
    for path in ("/ISAPI/Streaming/channels/101/picture",
                 "/ISAPI/Streaming/channels/1/picture"):
        try:
            r = subprocess.run(
                [curl, "-s", "--digest", "-u", f"{user}:{pw}",
                 f"http://{ip}{path}", "-o", "-"],
                capture_output=True, timeout=10)
            if r.returncode == 0 and r.stdout[:2] == b"\xff\xd8":
                return r.stdout
        except Exception as e:
            _grab_reason = f"curl: {type(e).__name__}"
            return None
    _grab_reason = (_grab_reason or "") + " + curl فشل أيضاً"
    return None


def _grab_jpeg(rtsp_url: str):
    """لقطة من الكاميرا -> (jpeg bytes, gray small) أو (None, None)
    الأولوية: لقطة ISAPI الفورية (أسلوب كاميرا الموبايل) — نظيفة ومضمونة.
    الاحتياطي: بث RTSP مع تسخين القراءة (5 فريمات، آخذ الأحدث)."""
    import cv2

    # 0) كاميرا HTTP (الجوال) — جلب مباشر
    if rtsp_url.lower().startswith("http"):
        jpeg = _grab_http(rtsp_url)
        if jpeg is not None:
            gray = _gray_from_jpeg(jpeg)
            if gray is not None:
                return jpeg, gray
        return None, None

    # 1) الأسلوب الفوري — نفس مبدأ shot.jpg بتاع الموبايل
    jpeg = _grab_isapi(rtsp_url)
    if jpeg is not None:
        gray = _gray_from_jpeg(jpeg)
        if gray is not None:
            return jpeg, gray

    # 2) الاحتياطي — بث RTSP مع تسخين
    cap = cv2.VideoCapture(rtsp_url, cv2.CAP_FFMPEG)
    frame = None
    try:
        for _ in range(5):
            ok, f = cap.read()
            if ok and f is not None:
                frame = f
    finally:
        cap.release()
    if frame is None:
        return None, None
    small = cv2.resize(frame, (480, 270))
    gray = cv2.cvtColor(small, cv2.COLOR_BGR2GRAY)
    ok, buf = cv2.imencode(".jpg", frame, [int(cv2.IMWRITE_JPEG_QUALITY), 85])
    if not ok:
        return None, None
    return buf.tobytes(), gray


def _motion(prev, cur) -> float:
    """متوسط الفرق بين كادرين — رقم صغير = مشهد ثابت"""
    import cv2
    if prev is None or cur is None:
        return 0.0
    return float(cv2.absdiff(prev, cur).mean())


def _save_snapshot(data: bytes) -> Optional[str]:
    try:
        SNAPSHOT_DIR.mkdir(parents=True, exist_ok=True)
        path = SNAPSHOT_DIR / f"{uuid.uuid4().hex}.jpg"
        path.write_bytes(data)
        return str(path)
    except Exception:
        return None


def _snapshot_path_only() -> Optional[str]:
    """يولّد مسار اللقطة فوراً بلا أي كتابة على القرص (لا حظر) — الكتابة الفعلية
    تتم لاحقاً في مهمة خلفية عبر _write_snapshot_bg."""
    try:
        SNAPSHOT_DIR.mkdir(parents=True, exist_ok=True)
        return str(SNAPSHOT_DIR / f"{uuid.uuid4().hex}.jpg")
    except Exception:
        return None


async def _write_snapshot_bg(path: Optional[str], data: bytes) -> None:
    """كتابة اللقطة على القرص في الخلفية — لا تُعطّل قراءة اللوحة أو الحلقة."""
    if not path:
        return
    try:
        await asyncio.to_thread(lambda: __import__("pathlib").Path(path).write_bytes(data))
    except Exception:
        pass


def _smart_crop(jpeg: bytes, prev_gray, cur_gray) -> bytes:
    """═══ التسريع الجذري: بدل إرسال الصورة الكاملة (~700KB) للذكاء،
    نقص منطقة الحركة فقط (مكان السيارة) ونصغّرها — صورة أصغر 10-20 مرة
    = رد أسرع بكثير + تكلفة أقل + اللوحة أكبر نسبياً في الكادر ═══"""
    try:
        import cv2
        import numpy as np
        arr = np.frombuffer(jpeg, np.uint8)
        frame = cv2.imdecode(arr, cv2.IMREAD_COLOR)
        if frame is None:
            return jpeg
        H, W = frame.shape[:2]

        # منطقة الحركة من فرق الرمادي المصغّر (480x270) => إحداثيات الأصل
        x0, y0, x1, y1 = 0, 0, W, H
        if prev_gray is not None and cur_gray is not None:
            diff = cv2.absdiff(prev_gray, cur_gray)
            _, th = cv2.threshold(diff, 25, 255, cv2.THRESH_BINARY)
            th = cv2.dilate(th, None, iterations=3)
            cnts, _ = cv2.findContours(th, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
            if cnts:
                xs, ys, xe, ye = [], [], [], []
                for c in cnts:
                    if cv2.contourArea(c) < 80:
                        continue
                    bx, by, bw, bh = cv2.boundingRect(c)
                    xs.append(bx); ys.append(by); xe.append(bx + bw); ye.append(by + bh)
                if xs:
                    sx, sy = W / cur_gray.shape[1], H / cur_gray.shape[0]
                    mx, my = int(0.12 * W), int(0.12 * H)  # هامش أمان حول الحركة
                    x0 = max(0, int(min(xs) * sx) - mx)
                    y0 = max(0, int(min(ys) * sy) - my)
                    x1 = min(W, int(max(xe) * sx) + mx)
                    y1 = min(H, int(max(ye) * sy) + my)

        # حد أدنى معقول للقص (ثلث الكادر) — أقل من كده نرجع للكامل
        if (x1 - x0) < W // 3 or (y1 - y0) < H // 4:
            cx, cy = (x0 + x1) // 2, (y0 + y1) // 2
            x0, x1 = max(0, cx - W // 3), min(W, cx + W // 3)
            y0, y1 = max(0, cy - H // 4), min(H, cy + H // 4)

        crop = frame[y0:y1, x0:x1]
        ch, cw = crop.shape[:2]
        # الدرس المستفاد: 1024 كانت تسحق تفاصيل اللوحة (الكاميرا 3840 عرض)
        # — 1600 توازن صح: أسرع من الكامل بكثير وتفاصيل اللوحة محفوظة
        if cw > 1600:
            crop = cv2.resize(crop, (1600, int(ch * 1600 / cw)))
        ok, buf = cv2.imencode(".jpg", crop, [int(cv2.IMWRITE_JPEG_QUALITY), 88])
        return buf.tobytes() if ok else jpeg
    except Exception:
        return jpeg


def _shrink_if_huge(jpeg: bytes, max_w: int = 2560) -> bytes:
    # 2560 = دقة الكاميرا الأصلية تقريباً — لا تصغير فعلي فيها، يمنع
    # فقدان تفاصيل اللوحات البعيدة. لا نصغّر إلا لو أكبر من دقة الكاميرا فعلاً.
    """تصغير الصورة الكاملة فقط إن كانت أعرض من max_w — بلا أي قص.
    نحافظ على اللوحة كاملة في الإطار؛ الكاميرا 4K تُصغَّر لـ2560 (تفاصيل اللوحة تبقى واضحة)."""
    try:
        import cv2
        import numpy as np
        arr = np.frombuffer(jpeg, np.uint8)
        frame = cv2.imdecode(arr, cv2.IMREAD_COLOR)
        if frame is None:
            return jpeg
        h, w = frame.shape[:2]
        if w <= max_w:
            return jpeg
        frame = cv2.resize(frame, (max_w, int(h * max_w / w)))
        ok, buf = cv2.imencode(".jpg", frame, [int(cv2.IMWRITE_JPEG_QUALITY), 85])
        return buf.tobytes() if ok else jpeg
    except Exception:
        return jpeg


async def _watch_loop() -> None:
    from app.core.db import transaction
    from . import service

    states: Dict[str, _CamState] = {}
    cameras: list = []
    last_cam_refresh = 0.0
    print(f"🚗 البوابة الذكية: المراقب الخلفي بدأ (كل {SCAN_INTERVAL:.0f} ث، حركة>{MOTION_LEVEL:.1f})", flush=True)

    while True:
        try:
            # 🎛 المفتاح مقفول من الواجهة => سكون تام (لا لقطات ولا استهلاك)
            if not _enabled:
                await asyncio.sleep(2)
                continue

            now = asyncio.get_event_loop().time()

            # ── تحديث قائمة كاميرات المحطة 1 النشطة (كل دقيقة) ──
            if now - last_cam_refresh > CAMERAS_REFRESH or not cameras:
                async with transaction() as conn:
                    rows = await conn.fetch(
                        """SELECT id, company_id, branch_id, name, rtsp_url
                           FROM station_cameras
                           WHERE is_active = TRUE AND station = 1"""
                    )
                # كل الكاميرات النشطة تعمل: RTSP (لقطة ISAPI فورية) وHTTP (الجوال)
                cameras = [dict(r) for r in rows]
                last_cam_refresh = now

                # ═══ معالج ذاتي دائم: أي سيارة سُجلت (يدوياً/حجزاً) بلا تطبيع
                #     للوحة => نكمّله فوراً — فتصبح مرئية للمطابقة دائماً ═══
                try:
                    from app.core.plate_utils import normalize_plate as _np
                    async with transaction() as conn:
                        broken = await conn.fetch(
                            """SELECT id, plate FROM cars
                               WHERE (plate_normalized IS NULL OR plate_normalized='')
                                 AND plate IS NOT NULL AND plate <> ''
                               LIMIT 30""")
                        healed = 0
                        for b in broken:
                            k = _np(b["plate"])
                            if not k.canonical:
                                continue
                            await conn.execute(
                                "UPDATE cars SET plate_normalized=$2, plate_loose=$3 WHERE id=$1",
                                b["id"], k.canonical, k.loose)
                            healed += 1
                        if healed:
                            print(f"🩹 المعالج الذاتي: استكمل تطبيع {healed} لوحة", flush=True)
                except Exception:
                    pass
                for c in cameras:
                    states.setdefault(str(c["id"]), _CamState())

            for cam in cameras:
                cam_id = str(cam["id"])
                st = states[cam_id]

                # لقطة (في ثريد منفصل حتى لا يتجمد الخادم)
                try:
                    jpeg, gray = await asyncio.wait_for(
                        asyncio.to_thread(_grab_jpeg, cam["rtsp_url"]), timeout=20)
                except Exception:
                    jpeg, gray = None, None
                _cam_stats[cam_id] = {"name": cam["name"], "ok": jpeg is not None,
                                      "ts": now, "last": _cam_stats.get(cam_id, {}).get("last", "")}
                if jpeg is None:
                    # تشخيص ذاتي: سبب الفشل يُطبع مرة كل دقيقة (لا فشل صامت)
                    if now - st.last_fail_log > 60:
                        st.last_fail_log = now
                        print(f"⚠ {cam['name']}: تعذر الالتقاط — {_grab_reason or 'سبب غير معروف'}", flush=True)
                    continue

                # بوابة 1: حركة فعلية
                prev_gray_snapshot = st.last_gray
                level = _motion(st.last_gray, gray)
                first_frame = st.last_gray is None
                st.last_gray = gray
                if first_frame or level < MOTION_LEVEL:
                    continue

                # بوابة 2: تهدئة استدعاء الذكاء لكل كاميرا
                if now - st.last_vision_ts < VISION_COOLDOWN:
                    continue
                st.last_vision_ts = now

                # ═══ لا حظر لحلقة الأحداث: توليد المسار فوراً (بلا I/O)، وتأجيل
                # كتابة الملف والتصغير لمهام غير حاجبة — نفس سرعة اللقطة اليدوية ═══
                path = _snapshot_path_only()
                asyncio.create_task(_write_snapshot_bg(path, jpeg))
                # الصورة الكاملة تُرسل كما هي (القص أزال اللوحة سابقاً — راجع الشرح
                # في _smart_crop أعلاه)؛ التصغير فقط في ثريد منفصل حتى لا يجمّد الحلقة.
                send_jpeg = await asyncio.to_thread(_shrink_if_huge, jpeg)
                try:
                    async with transaction() as conn:
                        ev = await service.process_image(
                            conn, send_jpeg, str(cam["branch_id"]),
                            camera_id=cam_id,
                            filename=f"auto-{cam['name']}.jpg",
                            image_path=path,
                            auto_checkin=True,
                        )
                    status = getattr(ev, "status", None) or getattr(ev, "match_mode", "")
                    _cam_stats[cam_id]["last"] = str(status)
                    # نطبع رقم اللوحة المقروء فعلياً مع الحالة — بدونه "unknown" لا تقول
                    # أي لوحة قُرئت، فيتعذّر مطابقتها بالسيارة المسجّلة عند التشخيص.
                    pl = getattr(ev, "plate", None)
                    plate_txt = (getattr(pl, "plate_display_en", "") or
                                 getattr(pl, "plate_display_ar", "") or "؟") if pl else "؟"
                    plate_canon = getattr(pl, "canonical", "") if pl else ""
                    print(f"🎥 {cam['name']}: حركة {level:.1f} -> {status} "
                          f"[{plate_txt} | canonical={plate_canon}]", flush=True)
                except Exception:
                    print(f"❌ فشل معالجة لقطة من {cam['name']}:", flush=True)
                    import traceback as _tb; _tb.print_exc()

        except asyncio.CancelledError:
            raise
        except Exception:
            print("❌ خطأ في دورة المراقب — نكمل:", flush=True)
            import traceback as _tb2; _tb2.print_exc()

        await asyncio.sleep(SCAN_INTERVAL)


def start_watcher() -> None:
    """يُستدعى مرة واحدة عند إقلاع الخادم"""
    global _started
    if _started or not GATE_AUTO:
        if not GATE_AUTO:
            print("⏸ البوابة الذكية: المراقب الخلفي مُعطّل (Z8_GATE_AUTO=off)", flush=True)
        return
    _started = True
    asyncio.get_event_loop().create_task(_watch_loop())
