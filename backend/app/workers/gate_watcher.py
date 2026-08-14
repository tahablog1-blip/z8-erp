"""
Z8 - مراقب كاميرات البوابة
===========================
يشتغل كـ process مستقل. يقرأ ستريم RTSP، يكشف الحركة،
وعند دخول سيارة يبعت اللقطة لـ /api/auto-checkin/scan

التشغيل:
    cd C:\\Users\\sda56\\Desktop\\z8\\backend
    python -m app.workers.gate_watcher

المتطلبات:
    pip install opencv-python numpy httpx asyncpg

الإعدادات (متغيرات بيئة):
    Z8_API_BASE          = http://localhost:4001
    Z8_GATE_API_KEY      = نفس المفتاح في الباك إند
    DATABASE_URL         = رابط قاعدة البيانات
    Z8_GATE_COOLDOWN_SEC = 15   (أقل زمن بين لقطتين لنفس الكاميرا)
    Z8_GATE_MOTION_AREA  = 8000 (حساسية الحركة — أقل = أحسس)
"""

import os
import asyncio
import logging
from typing import Optional

import cv2
import numpy as np
import httpx
import asyncpg

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)-7s | %(name)s | %(message)s",
)
log = logging.getLogger("z8.gate.watcher")

API_BASE = os.getenv("Z8_API_BASE", "http://localhost:4001")
GATE_API_KEY = os.getenv("Z8_GATE_API_KEY", "")
DATABASE_URL = os.getenv(
    "DATABASE_URL", "postgresql://postgres:postgres@localhost:5432/z8_car_manager")

COOLDOWN_SEC = int(os.getenv("Z8_GATE_COOLDOWN_SEC", "15"))
MOTION_AREA = int(os.getenv("Z8_GATE_MOTION_AREA", "8000"))
SETTLE_FRAMES = int(os.getenv("Z8_GATE_SETTLE_FRAMES", "6"))  # كام فريم ثبات قبل اللقطة
JPEG_QUALITY = int(os.getenv("Z8_GATE_JPEG_QUALITY", "88"))


class CameraWorker:
    """عامل مستقل لكل كاميرا"""

    def __init__(self, cam_id: str, branch_id: str, name: str, rtsp_url: str):
        self.cam_id = str(cam_id)
        self.branch_id = str(branch_id)
        self.name = name
        self.rtsp_url = rtsp_url
        self.cap: Optional[cv2.VideoCapture] = None
        self.bg = cv2.createBackgroundSubtractorMOG2(
            history=300, varThreshold=40, detectShadows=False)
        self.last_sent = 0.0
        self.motion_streak = 0

    def _open(self) -> bool:
        self.cap = cv2.VideoCapture(self.rtsp_url, cv2.CAP_FFMPEG)
        try:
            self.cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
        except Exception:
            pass
        if not self.cap.isOpened():
            log.error("[%s] فشل فتح الستريم", self.name)
            return False
        log.info("[%s] الكاميرا شغالة", self.name)
        return True

    def _detect_motion(self, frame) -> bool:
        small = cv2.resize(frame, (640, 360))
        mask = self.bg.apply(small)
        mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, np.ones((5, 5), np.uint8))
        contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        return any(cv2.contourArea(c) > MOTION_AREA for c in contours)

    @staticmethod
    def _sharpness(frame) -> float:
        """أعلى قيمة = صورة أوضح. نستخدمها لاختيار أحسن فريم"""
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        return cv2.Laplacian(gray, cv2.CV_64F).var()

    async def _send(self, frame) -> None:
        ok, buf = cv2.imencode(".jpg", frame,
                               [int(cv2.IMWRITE_JPEG_QUALITY), JPEG_QUALITY])
        if not ok:
            return

        files = {"image": (f"{self.cam_id}.jpg", buf.tobytes(), "image/jpeg")}
        data = {
            "branch_id": self.branch_id,
            "camera_id": self.cam_id,
            "auto_checkin": "true",
            "gate_key": GATE_API_KEY,
        }

        try:
            async with httpx.AsyncClient(timeout=45.0) as client:
                r = await client.post(f"{API_BASE}/api/auto-checkin/scan",
                                      files=files, data=data)
            if r.status_code == 200:
                ev = r.json()
                plate = (ev.get("plate") or {}).get("plate_display_ar", "?")
                cust = (ev.get("customer") or {}).get("name", "")
                log.info("[%s] %s | %s | %s", self.name, ev.get("status"), plate, cust)
            else:
                log.warning("[%s] الخادم رد %s: %s", self.name, r.status_code, r.text[:200])
        except Exception as e:
            log.error("[%s] فشل إرسال اللقطة: %s", self.name, e)

    async def run(self) -> None:
        loop = asyncio.get_event_loop()

        while True:
            if self.cap is None or not self.cap.isOpened():
                if not self._open():
                    await asyncio.sleep(10)
                    continue

            ok, frame = await loop.run_in_executor(None, self.cap.read)
            if not ok or frame is None:
                log.warning("[%s] انقطع الستريم — إعادة اتصال", self.name)
                self.cap.release()
                self.cap = None
                await asyncio.sleep(3)
                continue

            now = loop.time()
            has_motion = await loop.run_in_executor(None, self._detect_motion, frame)

            if has_motion:
                self.motion_streak += 1
            else:
                self.motion_streak = 0

            # حركة ثابتة لعدة فريمات = سيارة واقفة قدام البوابة
            if self.motion_streak >= SETTLE_FRAMES and (now - self.last_sent) > COOLDOWN_SEC:
                # اختار أوضح فريم من 5 لقطات متتالية
                best, best_score = frame, self._sharpness(frame)
                for _ in range(4):
                    ok2, f2 = await loop.run_in_executor(None, self.cap.read)
                    if ok2 and f2 is not None:
                        s = await loop.run_in_executor(None, self._sharpness, f2)
                        if s > best_score:
                            best, best_score = f2, s

                self.last_sent = now
                self.motion_streak = 0
                asyncio.create_task(self._send(best))

            await asyncio.sleep(0.04)   # ~25 فريم/ثانية


async def load_cameras():
    conn = await asyncpg.connect(DATABASE_URL)
    try:
        rows = await conn.fetch(
            "SELECT id, branch_id, name, rtsp_url FROM gate_cameras "
            "WHERE is_active = true AND direction = 'in'"
        )
        return [dict(r) for r in rows]
    finally:
        await conn.close()


async def main() -> None:
    cams = await load_cameras()

    if not cams:
        log.warning("لا توجد كاميرات مفعّلة. أضف كاميرا بـ:")
        log.warning(
            "INSERT INTO gate_cameras (branch_id, name, rtsp_url) VALUES "
            "('6184cbb3-e748-40b0-9e4b-cf0074b7bec6', 'بوابة الفرع الرئيسي', "
            "'rtsp://user:pass@192.168.1.50:554/stream1');"
        )
        return

    log.info("تشغيل %d كاميرا", len(cams))
    workers = [CameraWorker(c["id"], c["branch_id"], c["name"], c["rtsp_url"])
               for c in cams]
    await asyncio.gather(*(w.run() for w in workers))


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        log.info("إيقاف المراقب")
