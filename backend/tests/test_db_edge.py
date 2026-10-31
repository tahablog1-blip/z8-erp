# وكيل المحطة: مفاتيح مُجزّأة، نبضة/إعداد الكاميرات، طابور اللقطات عند الطلب، صلاحية رفع الحركة، واختيار مسار الالتقاط (وكيل أم مباشر).
# التركيبة المختبرة = محطة العميل: سيران بكاميرا مدخل لكل منهما (محطة 1) + 3 حفر بكاميرا لكل حفرة (محطة 2).
import asyncio
import json
import uuid

import pytest
from fastapi import HTTPException

from conftest import CO, run

pytestmark = pytest.mark.db
CID = uuid.UUID(CO)
JPEG = b"\xff\xd8\xff" + b"x" * 200


@pytest.fixture
def e(db_ready):
    from app.core import db
    from app.modules.edge.schema import EDGE_ENSURE_SQL

    async def go():
        async with db.pool().acquire() as c:
            await c.execute("DROP TABLE IF EXISTS edge_commands, edge_agents CASCADE")
            for s in EDGE_ENSURE_SQL:
                await c.execute(s)
            await c.execute("TRUNCATE station_cameras, branches RESTART IDENTITY CASCADE")
            b1, b2 = uuid.uuid4(), uuid.uuid4()
            await c.execute("INSERT INTO branches (id, company_id, name) VALUES ($1,$3,'فرع المحطة'),($2,$3,'فرع آخر')", b1, b2, CID)
            ids = {}
            for name, station, url, active, br in [
                ("سير 1 — مدخل", 1, "rtsp://u:p@192.168.1.11:554/Streaming/Channels/101", True, b1),
                ("سير 2 — مدخل", 1, "rtsp://u:p@192.168.1.12:554/Streaming/Channels/101", True, b1),
                ("حفرة 1", 2, "rtsp://u:p@192.168.1.21:554/x", True, b1), ("حفرة 2", 2, "rtsp://u:p@192.168.1.22:554/x", True, b1),
                ("حفرة 3", 2, "rtsp://u:p@192.168.1.23:554/x", True, b1),
                ("كاميرا معطلة", 3, "rtsp://u:p@192.168.1.99/x", False, b1), ("كاميرا فرع آخر", 1, "rtsp://u:p@10.0.0.5/x", True, b2),
            ]:
                ids[name] = str(await c.fetchval("INSERT INTO station_cameras (company_id, branch_id, station, name, rtsp_url, is_active) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id", CID, br, station, name, url, active))
            return {"b1": str(b1), "b2": str(b2), "cams": ids}
    return run(go)


def svc():
    from app.modules.edge import service
    return service


def mk(e, name="كمبيوتر المحطة", branch=None):
    return run(lambda: svc().create_agent(CO, branch or e["b1"], name))


def agent_of(key):
    return run(lambda: svc().agent_by_key(key))


def q(sql, *a):
    from app.core import db

    async def go():
        async with db.pool().acquire() as c:
            return await c.fetch(sql, *a)
    return run(go)


# ══════════════════ المفاتيح ══════════════════

def test_key_format_hashed_storage_and_validation(e):
    r = mk(e)
    assert r["key"].startswith("z8a_") and len(r["key"]) > 30
    stored = json.dumps([dict(x) for x in q("SELECT * FROM edge_agents")], default=str)
    assert r["key"] not in stored                                             # لا نص صريح
    assert agent_of(r["key"])["name"] == "كمبيوتر المحطة"
    for bad in (None, "", "z8a_wrong", "abc", "z8a_" + "x" * 200, r["key"] + "x"):
        assert agent_of(bad) is None
    with pytest.raises(HTTPException) as ex:
        mk(e, "  ")
    assert ex.value.status_code == 422
    with pytest.raises(HTTPException) as ex:
        run(lambda: svc().create_agent(CO, str(uuid.uuid4()), "x"))
    assert ex.value.status_code == 404


def test_revoked_key_stops_working_and_fails_pending_commands(e):
    r = mk(e)
    a = agent_of(r["key"])
    q("INSERT INTO edge_commands (agent_id, camera_id) VALUES ($1,$2)", a["id"], uuid.UUID(e["cams"]["حفرة 1"]))
    run(lambda: svc().revoke_agent(CO, r["id"]))
    assert agent_of(r["key"]) is None
    assert q("SELECT status FROM edge_commands")[0]["status"] == "failed"
    with pytest.raises(HTTPException) as ex:
        run(lambda: svc().require_agent(r["key"]))
    assert ex.value.status_code == 401


# ══════════════════ النبضة والإعداد ══════════════════

def test_hello_returns_only_branch_active_cameras_and_marks_online(e):
    a = agent_of(mk(e)["key"])
    assert run(lambda: svc().online_agent_for_branch(CO, e["b1"])) is None          # لم يُرسل نبضة بعد
    cfg = run(lambda: svc().heartbeat(a, "1.0.0", {e["cams"]["سير 1 — مدخل"]: {"ok": True}, e["cams"]["حفرة 1"]: {"ok": False, "reason": "ISAPI 401"}, "junk": 5}))
    names = [c["name"] for c in cfg["cameras"]]
    assert names == ["سير 1 — مدخل", "سير 2 — مدخل", "حفرة 1", "حفرة 2", "حفرة 3"]    # لا معطلة ولا فرع آخر
    assert cfg["agent"]["branchId"] == e["b1"] and all(c["url"].startswith("rtsp://") for c in cfg["cameras"])
    assert run(lambda: svc().online_agent_for_branch(CO, e["b1"])) is not None
    assert run(lambda: svc().online_agent_for_branch(CO, e["b2"])) is None          # فرع آخر بلا وكيل
    assert run(lambda: svc().online_branch_ids()) == {e["b1"]}
    ag = run(lambda: svc().list_agents(CO))[0]
    assert ag["online"] is True and ag["version"] == "1.0.0"
    st = {c["name"]: c for c in ag["cameras"]}
    assert st["حفرة 1"]["ok"] is False and st["حفرة 1"]["reason"] == "ISAPI 401" and st["سير 1 — مدخل"]["ok"] is True
    assert len(ag["cameras"]) == 2                                                   # المفتاح الفاسد "junk" أُهمل


def test_agent_goes_offline_after_45_seconds(e):
    a = agent_of(mk(e)["key"])
    run(lambda: svc().heartbeat(a, "1", {}))
    q("UPDATE edge_agents SET last_seen = now() - interval '2 minutes'")
    assert run(lambda: svc().online_agent_for_branch(CO, e["b1"])) is None
    assert run(lambda: svc().list_agents(CO))[0]["online"] is False


# ══════════════════ طلب لقطة عند الحاجة ══════════════════

def test_snapshot_roundtrip_through_agent(e):
    a = agent_of(mk(e)["key"])
    cam = e["cams"]["حفرة 2"]

    async def agent_side():
        cmds = await svc().poll_commands(a, wait=5)
        assert len(cmds) == 1 and cmds[0]["cameraId"] == cam and cmds[0]["kind"] == "snapshot"
        await svc().submit_result(a, cmds[0]["id"], JPEG, None)

    async def go():
        got, _ = await asyncio.gather(svc().request_snapshot(a, cam, timeout=8), agent_side())
        return got
    assert run(go) == JPEG
    assert q("SELECT 1 FROM edge_commands") == []                      # نُظِّف بعد التسليم


def test_agent_failure_reason_reaches_caller_and_timeout(e):
    a = agent_of(mk(e)["key"])
    cam = e["cams"]["سير 1 — مدخل"]

    async def failing():
        cmds = await svc().poll_commands(a, wait=5)
        await svc().submit_result(a, cmds[0]["id"], None, "ISAPI 401 — كلمة مرور الكاميرا خاطئة")

    async def go():
        return await asyncio.gather(svc().request_snapshot(a, cam, timeout=8), failing(), return_exceptions=True)
    r = run(go)[0]
    assert isinstance(r, HTTPException) and r.status_code == 502 and "كلمة مرور" in r.detail
    with pytest.raises(HTTPException) as ex:                           # لا أحد يجيب
        run(lambda: svc().request_snapshot(a, cam, timeout=0.6))
    assert ex.value.status_code == 504


def test_other_agent_cannot_answer_and_bad_jpeg_rejected(e):
    a1 = agent_of(mk(e, "أ")["key"]); a2 = agent_of(mk(e, "ب")["key"])
    q("INSERT INTO edge_commands (agent_id, camera_id) VALUES ($1,$2)", a1["id"], uuid.UUID(e["cams"]["حفرة 3"]))
    cid = str(q("SELECT id FROM edge_commands")[0]["id"])
    with pytest.raises(HTTPException) as ex:
        run(lambda: svc().submit_result(a2, cid, JPEG, None))
    assert ex.value.status_code == 404
    for bad in (b"not a jpeg" * 20, b"\xff\xd8", b"\xff\xd8" + b"x" * (9 * 1024 * 1024)):
        with pytest.raises(HTTPException) as ex:
            run(lambda: svc().submit_result(a1, cid, bad, None))
        assert ex.value.status_code == 422
    run(lambda: svc().submit_result(a1, cid, JPEG, None))              # صاحب الأمر ينجح
    assert q("SELECT status FROM edge_commands")[0]["status"] == "done"


# ══════════════════ رفع لقطات الحركة /auto-checkin/scan ══════════════════

def test_authorize_scan_rules(e):
    r1 = mk(e)["key"]; r2 = mk(e, "فرع آخر", e["b2"])["key"]
    auth = lambda key, br, glob="": run(lambda: svc().authorize_scan(key, br, glob))
    auth(r1, e["b1"], "GLOBAL")                                        # مفتاح الوكيل لفرعه + وجود مفتاح عام
    for key, br, code in [(r1, e["b2"], 403), (r2, e["b1"], 403), ("z8a_forged", e["b1"], 401)]:
        with pytest.raises(HTTPException) as ex:
            auth(key, br, "GLOBAL")
        assert ex.value.status_code == code
    auth("GLOBAL", e["b1"], "GLOBAL")                                  # السلوك القديم: مفتاح البوابة العام
    with pytest.raises(HTTPException) as ex:
        auth("WRONG", e["b1"], "GLOBAL")
    assert ex.value.status_code == 401
    with pytest.raises(HTTPException) as ex:
        auth(None, e["b1"], "GLOBAL")
    assert ex.value.status_code == 401
    auth(None, e["b1"], "")                                            # بلا مفتاح عام = مفتوح كما كان (تحذير مُوثَّق في security-check)
    first = str(q("SELECT id FROM edge_agents ORDER BY created_at")[0]["id"])
    run(lambda: svc().revoke_agent(CO, first))
    with pytest.raises(HTTPException) as ex:
        auth(r1, e["b1"], "GLOBAL")                                    # المفتاح الملغى
    assert ex.value.status_code == 401


# ══════════════════ مسار الالتقاط: وكيل أم مباشر ══════════════════

def test_grab_goes_through_agent_only_when_online(e, monkeypatch):
    from app.core import camera_grab
    from app.modules.cameras import api as cams_api
    calls = {"direct": 0, "agent": 0}

    def fake_direct(url):
        calls["direct"] += 1
        return b"DIRECT"

    async def fake_snapshot(agent, camera_id, timeout=15.0):
        calls["agent"] += 1
        return b"AGENT"
    monkeypatch.setattr(cams_api, "_grab_frame", fake_direct)
    monkeypatch.setattr(svc(), "request_snapshot", fake_snapshot)
    cam = e["cams"]["حفرة 1"]
    g = lambda br: run(lambda: camera_grab.grab_jpeg(cam, CO, br, "rtsp://x"))
    assert g(e["b1"]) == b"DIRECT"                                     # لا وكيل → مباشر (سلوك الكاميرات التي يصل لها السيرفر)
    a = agent_of(mk(e)["key"])
    run(lambda: svc().heartbeat(a, "1", {}))
    assert g(e["b1"]) == b"AGENT"                                      # وكيل متصل → عبره
    assert g(e["b2"]) == b"DIRECT"                                     # فرع آخر لا يتأثر
    q("UPDATE edge_agents SET last_seen = now() - interval '5 minutes'")
    assert g(e["b1"]) == b"DIRECT"                                     # الوكيل انقطع → رجوع للمباشر
    assert calls == {"direct": 3, "agent": 1}
