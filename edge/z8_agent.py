#!/usr/bin/env python3
"""
Z8 — وكيل المحطة (Edge Agent)
==============================
يعمل على كمبيوتر داخل شبكة المحطة (نفس شبكة الكاميرات). يقرأ الكاميرات محلياً بعناوينها الخاصة،
ويتصل بالسيرفر في السحابة اتصالاً خارجياً فقط (HTTPS) — لا IP عالمي ولا فتح منافذ في الراوتر.

يفعل ثلاثة أشياء:
  1) نبضة حياة كل 15 ث + جلب قائمة كاميرات فرعه من الموقع (لا ملفات إعداد للكاميرات) + إبلاغ حالة كل كاميرا.
  2) مراقبة حركة كاميرات المدخل (المحطة 1): عند دخول سيارة يرسل اللقطة إلى /api/auto-checkin/scan.
  3) تنفيذ أوامر «هات لقطة الآن» من الموقع (اختبار الكاميرا، لقطة المحطة، فحص السيارة، المشرف الآلي).

الإعداد (ملف agent.env بجانب البرنامج أو متغيرات بيئة):
  Z8_SERVER=https://z8masdr.duckdns.org
  Z8_AGENT_KEY=z8a_...        (من الموقع: الإعدادات ← كاميرات المحطات ← وكلاء المحطات)
اختياري: Z8_SCAN_INTERVAL=1  Z8_MOTION_LEVEL=12  Z8_VISION_COOLDOWN=2  Z8_WATCH_STATIONS=1  Z8_LOG_FILE=agent.log
"""
from __future__ import annotations

import logging
import logging.handlers
import os
import subprocess
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Optional
from urllib.parse import unquote, urlsplit

VERSION = "1.0.0"
log = logging.getLogger("z8.agent")


# ══════════════════ الإعدادات ══════════════════

def load_env_file(path: Path) -> dict:
    out: dict = {}
    if path.exists():
        for line in path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                out[k.strip()] = v.strip().strip('"').strip("'")
    return out


@dataclass
class Config:
    server: str
    key: str
    scan_interval: float = 1.0
    motion_level: float = 12.0
    vision_cooldown: float = 2.0
    watch_stations: tuple = (1,)
    heartbeat: float = 15.0
    log_file: str = ""

    @staticmethod
    def load(env: Optional[dict] = None, base: Optional[Path] = None) -> "Config":
        base = base or Path(__file__).resolve().parent
        merged = {**load_env_file(base / "agent.env"), **(env if env is not None else os.environ)}
        server = (merged.get("Z8_SERVER") or "").rstrip("/")
        key = merged.get("Z8_AGENT_KEY") or ""
        if not server.startswith("http"):
            raise SystemExit("Z8_SERVER غير مضبوط (مثال: https://z8masdr.duckdns.org) — ضعه في agent.env")
        if not key.startswith("z8a_"):
            raise SystemExit("Z8_AGENT_KEY غير مضبوط أو غير صالح — أنشئ وكيلاً من الموقع وانسخ مفتاحه إلى agent.env")
        stations = tuple(int(x) for x in str(merged.get("Z8_WATCH_STATIONS", "1")).replace("،", ",").split(",") if x.strip().isdigit()) or (1,)
        return Config(server=server, key=key, scan_interval=float(merged.get("Z8_SCAN_INTERVAL", 1)), motion_level=float(merged.get("Z8_MOTION_LEVEL", 12)),
                      vision_cooldown=float(merged.get("Z8_VISION_COOLDOWN", 2)), watch_stations=stations, log_file=merged.get("Z8_LOG_FILE", ""))


# ══════════════════ التقاط لقطة (نفس منطق السيرفر المجرَّب: ISAPI ثم RTSP) ══════════════════

class GrabError(Exception):
    pass


def _grab_http(url: str, timeout: float = 8) -> bytes:
    import requests
    sp = urlsplit(url)
    auth = None
    if sp.username:
        from requests.auth import HTTPBasicAuth
        auth = HTTPBasicAuth(unquote(sp.username), unquote(sp.password or ""))
        url = url.replace(f"{sp.username}:{sp.password}@" if sp.password else f"{sp.username}@", "", 1)
    r = requests.get(url, auth=auth, timeout=timeout)
    if r.status_code == 200 and r.content[:2] == b"\xff\xd8":
        return r.content
    raise GrabError(f"HTTP {r.status_code}")


def _grab_isapi(url: str) -> bytes:
    """لقطة فورية من كاميرات Hikvision (ISAPI + Digest) — نظيفة وسريعة"""
    import requests
    from requests.auth import HTTPDigestAuth
    sp = urlsplit(url)
    user, pw, host = unquote(sp.username or ""), unquote(sp.password or ""), sp.hostname or ""
    if not host:
        raise GrabError("تعذر استخراج عنوان الكاميرا من الرابط")
    if not user or not pw:
        raise GrabError("الرابط بلا مستخدم/باسورد — الصيغة: rtsp://user:pass@IP:554/...")
    last = "ISAPI بلا رد"
    for path in ("/ISAPI/Streaming/channels/101/picture", "/ISAPI/Streaming/channels/1/picture"):
        try:
            r = requests.get(f"http://{host}{path}", auth=HTTPDigestAuth(user, pw), timeout=6)
        except Exception as e:
            last = f"{type(e).__name__}"
            continue
        if r.status_code == 200 and r.content[:2] == b"\xff\xd8":
            return r.content
        last = f"ISAPI {r.status_code}"
    raise GrabError(last)


def _grab_rtsp(url: str) -> bytes:
    import cv2
    cap = cv2.VideoCapture(url, cv2.CAP_FFMPEG)
    try:
        try:
            cap.set(cv2.CAP_PROP_OPEN_TIMEOUT_MSEC, 6000); cap.set(cv2.CAP_PROP_READ_TIMEOUT_MSEC, 6000)
        except Exception:
            pass
        if not cap.isOpened():
            raise GrabError("تعذّر فتح بث الكاميرا — راجع العنوان والباسورد")
        frame = None
        for _ in range(5):                       # تسخين: نأخذ الأحدث
            ok, f = cap.read()
            if ok and f is not None:
                frame = f
        if frame is None:
            raise GrabError("الكاميرا متصلة لكن اللقطة فشلت")
        ok, buf = cv2.imencode(".jpg", frame, [int(cv2.IMWRITE_JPEG_QUALITY), 88])
        if not ok:
            raise GrabError("فشل ترميز اللقطة")
        return buf.tobytes()
    finally:
        cap.release()


def grab_jpeg(url: str) -> bytes:
    if url.lower().startswith("http"):
        return _grab_http(url)
    try:
        return _grab_isapi(url)
    except GrabError as first:
        try:
            return _grab_rtsp(url)
        except GrabError as second:
            raise GrabError(f"{first} | {second}")


def shrink_if_huge(jpeg: bytes, max_w: int = 2560) -> bytes:
    try:
        import cv2
        import numpy as np
        frame = cv2.imdecode(np.frombuffer(jpeg, np.uint8), cv2.IMREAD_COLOR)
        if frame is None or frame.shape[1] <= max_w:
            return jpeg
        h = int(frame.shape[0] * max_w / frame.shape[1])
        ok, buf = cv2.imencode(".jpg", cv2.resize(frame, (max_w, h)), [int(cv2.IMWRITE_JPEG_QUALITY), 88])
        return buf.tobytes() if ok else jpeg
    except Exception:
        return jpeg


def gray_small(jpeg: bytes):
    import cv2
    import numpy as np
    frame = cv2.imdecode(np.frombuffer(jpeg, np.uint8), cv2.IMREAD_COLOR)
    if frame is None:
        return None
    return cv2.cvtColor(cv2.resize(frame, (480, 270)), cv2.COLOR_BGR2GRAY)


def motion_level(prev, cur) -> float:
    """متوسط فرق كادرين رماديين — رقم صغير = مشهد ثابت"""
    import cv2
    if prev is None or cur is None:
        return 0.0
    return float(cv2.absdiff(prev, cur).mean())


# ══════════════════ الاتصال بالسيرفر ══════════════════

class ServerApi:
    def __init__(self, cfg: Config):
        import requests
        self.cfg = cfg
        self.s = requests.Session()
        self.s.headers["X-Agent-Key"] = cfg.key

    def _url(self, p: str) -> str:
        return f"{self.cfg.server}/api{p}"

    def hello(self, cameras_status: dict) -> dict:
        r = self.s.post(self._url("/edge/hello"), json={"version": VERSION, "cameras": cameras_status}, timeout=15)
        r.raise_for_status()
        return r.json()

    def commands(self, wait: int = 20) -> list:
        r = self.s.get(self._url("/edge/commands"), params={"wait": wait}, timeout=wait + 15)
        r.raise_for_status()
        return r.json()

    def result(self, command_id: str, jpeg: Optional[bytes], error: Optional[str]) -> None:
        files = {"image": ("shot.jpg", jpeg, "image/jpeg")} if jpeg else None
        r = self.s.post(self._url(f"/edge/commands/{command_id}/result"), files=files, data={"error": error or ""} if not jpeg else None, timeout=30)
        r.raise_for_status()

    def scan(self, jpeg: bytes, branch_id: str, camera_id: str, name: str) -> dict:
        r = self.s.post(self._url("/auto-checkin/scan"), files={"image": (f"auto-{name}.jpg", jpeg, "image/jpeg")},
                        data={"branch_id": branch_id, "camera_id": camera_id, "auto_checkin": "true", "gate_key": self.cfg.key}, timeout=60)
        r.raise_for_status()
        return r.json()


# ══════════════════ الوكيل ══════════════════

@dataclass(frozen=True)
class Cam:
    id: str
    name: str
    station: int
    url: str


class Agent:
    def __init__(self, cfg: Config, api, grabber: Callable[[str], bytes] = grab_jpeg):
        self.cfg, self.api, self.grab = cfg, api, grabber
        self.stop = threading.Event()
        self.branch_id = ""
        self.cams: dict[str, Cam] = {}
        self.status: dict[str, dict] = {}
        self.watchers: dict[str, tuple[Cam, threading.Event]] = {}
        self.pool = ThreadPoolExecutor(max_workers=6, thread_name_prefix="cmd")
        self.lock = threading.Lock()

    # ── إعداد الكاميرات من السيرفر ──
    def apply_config(self, cfg: dict) -> None:
        self.branch_id = cfg["agent"]["branchId"]
        new = {c["id"]: Cam(c["id"], c["name"], int(c["station"] or 0), c["url"]) for c in cfg["cameras"]}
        with self.lock:
            self.cams = new
            for cid in list(self.status):
                if cid not in new:
                    self.status.pop(cid, None)
        # مراقبة الحركة لكاميرات المدخل فقط؛ تُعاد عند تغيّر الرابط
        for cid, (cam, ev) in list(self.watchers.items()):
            if cid not in new or new[cid] != cam:
                ev.set(); self.watchers.pop(cid)
        for cid, cam in new.items():
            if cam.station in self.cfg.watch_stations and cid not in self.watchers:
                ev = threading.Event()
                self.watchers[cid] = (cam, ev)
                threading.Thread(target=self.watch_camera, args=(cam, ev), name=f"watch-{cam.name}", daemon=True).start()
                log.info("بدأت مراقبة %s (محطة %s)", cam.name, cam.station)

    def _set_status(self, cam: Cam, ok: bool, reason: str = "") -> None:
        self.status[cam.id] = {"ok": ok, "reason": reason[:160]}

    # ── مراقبة حركة كاميرا مدخل ──
    def watch_camera(self, cam: Cam, ev: threading.Event) -> None:
        prev, last_sent, last_log = None, 0.0, 0.0
        while not self.stop.is_set() and not ev.is_set():
            try:
                jpeg = self.grab(cam.url)
                gray = gray_small(jpeg)
                self._set_status(cam, True)
                level = motion_level(prev, gray)
                first = prev is None
                prev = gray
                now = time.time()
                if not first and level >= self.cfg.motion_level and now - last_sent >= self.cfg.vision_cooldown:
                    last_sent = now
                    ev_json = self.api.scan(shrink_if_huge(jpeg), self.branch_id, cam.id, cam.name)
                    log.info("🎥 %s: حركة %.1f -> %s", cam.name, level, ev_json.get("status") or ev_json.get("match_mode") or "")
            except GrabError as e:
                self._set_status(cam, False, str(e))
                if time.time() - last_log > 60:
                    last_log = time.time(); log.warning("⚠ %s: تعذر الالتقاط — %s", cam.name, e)
            except Exception as e:
                self._set_status(cam, self.status.get(cam.id, {}).get("ok", False), f"{type(e).__name__}: {e}")
                if time.time() - last_log > 60:
                    last_log = time.time(); log.warning("خطأ في مراقبة %s: %s", cam.name, e)
            ev.wait(self.cfg.scan_interval) if not self.stop.is_set() else None

    # ── أوامر «هات لقطة» ──
    def handle_command(self, cmd: dict) -> None:
        cam = self.cams.get(cmd.get("cameraId", ""))
        try:
            if not cam:
                raise GrabError("الكاميرا غير معرّفة على هذا الوكيل (غير نشطة أو من فرع آخر)")
            if cmd.get("kind") != "snapshot":
                raise GrabError("نوع أمر غير مدعوم")
            jpeg = self.grab(cam.url)
            self._set_status(cam, True)
            self.api.result(cmd["id"], jpeg, None)
        except GrabError as e:
            if cam:
                self._set_status(cam, False, str(e))
            self._safe_result(cmd["id"], str(e))
        except Exception as e:
            self._safe_result(cmd["id"], f"{type(e).__name__}: {e}")

    def _safe_result(self, cid: str, error: str) -> None:
        try:
            self.api.result(cid, None, error)
        except Exception:
            log.exception("تعذر إرسال نتيجة الأمر")

    def command_loop(self) -> None:
        backoff = 1.0
        while not self.stop.is_set():
            try:
                for cmd in self.api.commands(20):
                    self.pool.submit(self.handle_command, cmd)
                backoff = 1.0
            except Exception as e:
                log.warning("انقطاع عن السيرفر (الأوامر): %s — إعادة بعد %.0f ث", e, backoff)
                self.stop.wait(backoff); backoff = min(backoff * 2, 30)

    def heartbeat_loop(self) -> None:
        backoff = 1.0
        while not self.stop.is_set():
            try:
                self.apply_config(self.api.hello(dict(self.status)))
                backoff = 1.0
                self.stop.wait(self.cfg.heartbeat)
            except Exception as e:
                log.warning("انقطاع عن السيرفر (نبضة): %s — إعادة بعد %.0f ث", e, backoff)
                self.stop.wait(backoff); backoff = min(backoff * 2, 30)

    def run(self) -> None:
        log.info("وكيل Z8 %s يعمل — السيرفر: %s", VERSION, self.cfg.server)
        threading.Thread(target=self.command_loop, name="commands", daemon=True).start()
        try:
            self.heartbeat_loop()
        except KeyboardInterrupt:
            pass
        finally:
            self.stop.set()
            for _, ev in self.watchers.values():
                ev.set()


def setup_logging(cfg: Config) -> None:
    handlers: list = [logging.StreamHandler(sys.stdout)]
    if cfg.log_file:
        handlers.append(logging.handlers.RotatingFileHandler(cfg.log_file, maxBytes=2_000_000, backupCount=3, encoding="utf-8"))
    logging.basicConfig(level=logging.INFO, format="%(asctime)s | %(levelname)-7s | %(message)s", handlers=handlers)


if __name__ == "__main__":
    c = Config.load()
    setup_logging(c)
    Agent(c, ServerApi(c)).run()
