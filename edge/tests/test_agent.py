# اختبارات وكيل المحطة: الإعداد، كشف الحركة، وتدفق كامل مع خادم وهمي (نبضة، مراقبة المدخل، أوامر اللقطة، الأخطاء).
import json
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import cv2
import numpy as np
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import z8_agent as za  # noqa: E402

KEY = "z8a_testkey_123456"


def jpeg(value=100, box=None):
    img = np.full((540, 960, 3), value, np.uint8)
    if box:
        x, y, w, h = box
        img[y:y + h, x:x + w] = 255
    ok, buf = cv2.imencode(".jpg", img)
    assert ok
    return buf.tobytes()


STATIC, MOVED = jpeg(100), jpeg(100, (100, 100, 500, 300))


# ══════════════════ الإعداد ══════════════════

def test_config_requires_server_and_agent_key(tmp_path):
    with pytest.raises(SystemExit):
        za.Config.load({"Z8_AGENT_KEY": KEY}, tmp_path)
    with pytest.raises(SystemExit):
        za.Config.load({"Z8_SERVER": "https://x.sa", "Z8_AGENT_KEY": "bad"}, tmp_path)
    c = za.Config.load({"Z8_SERVER": "https://x.sa/", "Z8_AGENT_KEY": KEY, "Z8_WATCH_STATIONS": "1,2", "Z8_MOTION_LEVEL": "9"}, tmp_path)
    assert c.server == "https://x.sa" and c.watch_stations == (1, 2) and c.motion_level == 9 and c.scan_interval == 1.0


def test_config_reads_agent_env_file(tmp_path):
    (tmp_path / "agent.env").write_text(f'# تعليق\nZ8_SERVER="https://z8.example"\nZ8_AGENT_KEY={KEY}\n', encoding="utf-8")
    c = za.Config.load({}, tmp_path)
    assert c.server == "https://z8.example" and c.key == KEY and c.watch_stations == (1,)


# ══════════════════ كشف الحركة ══════════════════

def test_motion_level_static_vs_moving():
    g1, g2, g3 = za.gray_small(STATIC), za.gray_small(STATIC), za.gray_small(MOVED)
    assert za.motion_level(None, g1) == 0.0
    assert za.motion_level(g1, g2) < 1.0
    assert za.motion_level(g1, g3) > 12.0                        # تجاوز العتبة الافتراضية


def test_shrink_only_when_wider_than_limit():
    big = jpeg(120)
    assert za.shrink_if_huge(big, max_w=2560) == big
    small = za.shrink_if_huge(big, max_w=480)
    assert cv2.imdecode(np.frombuffer(small, np.uint8), cv2.IMREAD_COLOR).shape[1] == 480


# ══════════════════ خادم وهمي ══════════════════

class Fake:
    def __init__(self):
        self.hellos, self.scans, self.results, self.cmds = [], [], [], []
        self.cameras = []
        self.lock = threading.Lock()


def make_server(state: Fake):
    class H(BaseHTTPRequestHandler):
        def log_message(self, *a): pass

        def _json(self, obj, code=200):
            b = json.dumps(obj).encode()
            self.send_response(code); self.send_header("Content-Type", "application/json"); self.send_header("Content-Length", str(len(b))); self.end_headers(); self.wfile.write(b)

        def _auth(self):
            if self.headers.get("X-Agent-Key") != KEY and b"gate_key" not in b"":
                pass
            return True

        def do_POST(self):
            n = int(self.headers.get("Content-Length") or 0); body = self.rfile.read(n)
            if self.path == "/api/edge/hello":
                with state.lock:
                    state.hellos.append(json.loads(body))
                return self._json({"agent": {"id": "a1", "name": "pc", "branchId": "B1"}, "cameras": state.cameras})
            if self.path == "/api/auto-checkin/scan":
                with state.lock:
                    state.scans.append(body)
                return self._json({"status": "matched"})
            if self.path.startswith("/api/edge/commands/") and self.path.endswith("/result"):
                with state.lock:
                    state.results.append((self.path.split("/")[-2], body))
                self.send_response(204); self.end_headers(); return
            self._json({"error": "nope"}, 404)

        def do_GET(self):
            if self.path.startswith("/api/edge/commands"):
                with state.lock:
                    out, state.cmds = state.cmds, []
                if not out:
                    time.sleep(0.2)
                return self._json(out)
            self._json({"error": "nope"}, 404)
    srv = ThreadingHTTPServer(("127.0.0.1", 0), H)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv


@pytest.fixture
def world():
    st = Fake()
    st.cameras = [
        {"id": "c-in1", "name": "سير 1 — مدخل", "station": 1, "url": "rtsp://in1"}, {"id": "c-in2", "name": "سير 2 — مدخل", "station": 1, "url": "rtsp://in2"},
        {"id": "c-p1", "name": "حفرة 1", "station": 2, "url": "rtsp://pit1"}, {"id": "c-p2", "name": "حفرة 2", "station": 2, "url": "rtsp://pit2"},
        {"id": "c-p3", "name": "حفرة 3", "station": 2, "url": "rtsp://pit3"},
    ]
    srv = make_server(st)
    cfg = za.Config(server=f"http://127.0.0.1:{srv.server_port}", key=KEY, scan_interval=0.05, vision_cooldown=0.2, motion_level=12, heartbeat=0.3)
    yield st, cfg
    srv.shutdown()


def wait(cond, timeout=6):
    end = time.time() + timeout
    while time.time() < end:
        if cond():
            return True
        time.sleep(0.05)
    return False


def start(cfg, grabber):
    ag = za.Agent(cfg, za.ServerApi(cfg), grabber)
    t = threading.Thread(target=ag.run, daemon=True); t.start()
    return ag


# ══════════════════ التدفق الكامل ══════════════════

def test_only_entrance_cameras_are_watched_and_motion_posts_scan(world):
    st, cfg = world
    frames = {"rtsp://in1": [STATIC, STATIC, MOVED, MOVED, MOVED, MOVED]}      # سير 1: ثبات ثم دخول سيارة
    idx = {}

    def grabber(url):
        if url == "rtsp://in1":
            i = idx.get(url, 0); idx[url] = i + 1
            return frames[url][min(i, len(frames[url]) - 1)]
        return STATIC                                                           # بقية الكاميرات مشهد ثابت
    ag = start(cfg, grabber)
    try:
        assert wait(lambda: len(st.scans) >= 1)
        assert set(ag.watchers) == {"c-in1", "c-in2"}                          # سيران فقط — لا مراقبة للحفر
        body = st.scans[0]
        assert b'name="branch_id"' in body and b"B1" in body                   # فرع الوكيل من إعداد السيرفر
        assert b'name="camera_id"' in body and b"c-in1" in body
        assert b'name="gate_key"' in body and KEY.encode() in body             # مفتاح الوكيل يُرسل للمصادقة
        assert body.count(b"\xff\xd8") >= 1                                    # اللقطة نفسها
        assert all(b"c-in2" not in s for s in st.scans)                        # سير 2 ثابت فلا إرسال منه
    finally:
        ag.stop.set()


def test_heartbeat_reports_camera_status_including_failure_reason(world):
    st, cfg = world

    def grabber(url):
        if url == "rtsp://in2":
            raise za.GrabError("ISAPI 401")
        return STATIC
    ag = start(cfg, grabber)
    try:
        assert wait(lambda: any(h["cameras"].get("c-in2", {}).get("reason") == "ISAPI 401" for h in st.hellos))
        last = [h for h in st.hellos if "c-in1" in h["cameras"]][-1]
        assert last["version"] == za.VERSION and last["cameras"]["c-in1"]["ok"] is True
    finally:
        ag.stop.set()


def test_snapshot_command_returns_frame_for_pit_camera_and_errors_for_failures(world):
    st, cfg = world

    def grabber(url):
        if url == "rtsp://pit2":
            raise za.GrabError("تعذّر فتح بث الكاميرا")
        return STATIC
    ag = start(cfg, grabber)
    try:
        assert wait(lambda: "c-p1" in ag.cams)
        with st.lock:
            st.cmds = [{"id": "k1", "cameraId": "c-p1", "kind": "snapshot"}, {"id": "k2", "cameraId": "c-p2", "kind": "snapshot"},
                       {"id": "k3", "cameraId": "c-unknown", "kind": "snapshot"}]
        assert wait(lambda: len(st.results) == 3)
        res = dict(st.results)
        assert b"\xff\xd8" in res["k1"] and b"filename" in res["k1"]           # لقطة حقيقية مرفوعة كملف
        from urllib.parse import parse_qs
        assert parse_qs(res["k2"].decode())["error"] == ["تعذّر فتح بث الكاميرا"]   # سبب الفشل يصل للسيرفر كما هو
        assert "غير معرّفة" in parse_qs(res["k3"].decode())["error"][0]
    finally:
        ag.stop.set()


def test_removed_camera_stops_being_watched(world):
    st, cfg = world
    ag = start(cfg, lambda url: STATIC)
    try:
        assert wait(lambda: set(ag.watchers) == {"c-in1", "c-in2"})
        with st.lock:
            st.cameras = [c for c in st.cameras if c["id"] != "c-in2"]
        assert wait(lambda: set(ag.watchers) == {"c-in1"})
    finally:
        ag.stop.set()
