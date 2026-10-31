# modules/edge/service.py — وكيل المحطة: الكاميرات على شبكة المحطة المحلية (عناوين خاصة) والسيرفر في السحابة.
# الوكيل يتصل بالسيرفر (خارجياً فقط)، يرسل لقطات الحركة، وينفّذ أوامر «هات لقطة الآن» من طابور قصير.
import asyncio
import hashlib
import hmac
import secrets

from fastapi import HTTPException

from ...core.config import settings
from ...core.db import execute, fetch, fetchrow

KEY_PREFIX = "z8a_"
ONLINE_SECONDS = 45          # آخر نبضة أحدث من هذا = متصل
MAX_JPEG = 8 * 1024 * 1024


def key_hash(key: str) -> str:
    return hmac.new(settings.JWT_SECRET.encode(), ("z8-edge-key:" + key).encode(), hashlib.sha256).hexdigest()


def new_key() -> str:
    return KEY_PREFIX + secrets.token_urlsafe(30)


# ══════════════════ الوكلاء ══════════════════

async def agent_by_key(key: str | None) -> dict | None:
    if not key or not key.startswith(KEY_PREFIX) or len(key) > 120:
        return None
    r = await fetchrow("SELECT * FROM edge_agents WHERE key_hash=$1 AND revoked_at IS NULL", key_hash(key))
    return dict(r) if r else None


async def require_agent(key: str | None) -> dict:
    a = await agent_by_key(key)
    if not a:
        raise HTTPException(401, "مفتاح الوكيل غير صحيح أو أُلغي")
    return a


async def create_agent(company_id: str, branch_id: str, name: str) -> dict:
    name = (name or "").strip()
    if not name:
        raise HTTPException(422, "اكتب اسم الوكيل (مثل: كمبيوتر المحطة)")
    if not await fetchrow("SELECT 1 FROM branches WHERE id=$1 AND company_id=$2", branch_id, company_id):
        raise HTTPException(404, "الفرع غير موجود")
    key = new_key()
    r = await fetchrow("INSERT INTO edge_agents (company_id, branch_id, name, key_hash) VALUES ($1,$2,$3,$4) RETURNING id",
                       company_id, branch_id, name[:80], key_hash(key))
    return {"id": str(r["id"]), "key": key}        # المفتاح يظهر هذه المرة فقط


async def revoke_agent(company_id: str, agent_id: str) -> None:
    await execute("UPDATE edge_agents SET revoked_at=now() WHERE id=$1 AND company_id=$2", agent_id, company_id)
    await execute("""UPDATE edge_commands SET status='failed', error='أُلغي الوكيل', done_at=now()
                     WHERE agent_id=$1 AND status IN ('pending','claimed')""", agent_id)


async def list_agents(company_id: str) -> list[dict]:
    rows = await fetch(
        """SELECT a.id, a.name, a.version, a.last_seen, a.cameras, a.revoked_at, a.created_at, b.name AS branch_name,
                  (a.last_seen IS NOT NULL AND a.last_seen > now() - ($2 || ' seconds')::interval AND a.revoked_at IS NULL) AS online
           FROM edge_agents a JOIN branches b ON b.id=a.branch_id WHERE a.company_id=$1 ORDER BY a.created_at""",
        company_id, str(ONLINE_SECONDS))
    names = {str(c["id"]): c["name"] for c in await fetch("SELECT id, name FROM station_cameras WHERE company_id=$1", company_id)}
    out = []
    for r in rows:
        cams = r["cameras"] if isinstance(r["cameras"], dict) else {}
        out.append({"id": str(r["id"]), "name": r["name"], "branchName": r["branch_name"], "version": r["version"], "lastSeen": r["last_seen"],
                    "online": bool(r["online"]), "revoked": r["revoked_at"] is not None,
                    "cameras": [{"id": k, "name": names.get(k, k[:8]), "ok": bool(v.get("ok")), "reason": v.get("reason", "")} for k, v in cams.items()]})
    return out


def _clean_status(cameras: object) -> dict:
    out: dict = {}
    if isinstance(cameras, dict):
        for k, v in list(cameras.items())[:50]:
            if isinstance(v, dict):
                out[str(k)[:40]] = {"ok": bool(v.get("ok")), "reason": str(v.get("reason") or "")[:160]}
    return out


async def heartbeat(agent: dict, version: str | None, cameras: object) -> dict:
    await execute("UPDATE edge_agents SET last_seen=now(), version=COALESCE($2, version), cameras=$3::jsonb WHERE id=$1",
                  agent["id"], (version or "")[:40] or None, _clean_status(cameras))     # الاتصال يرمّز jsonb تلقائياً — لا json.dumps هنا
    rows = await fetch("""SELECT id, name, station, rtsp_url FROM station_cameras
                          WHERE company_id=$1 AND branch_id=$2 AND is_active=TRUE ORDER BY station, name""",
                       agent["company_id"], agent["branch_id"])
    return {"agent": {"id": str(agent["id"]), "name": agent["name"], "branchId": str(agent["branch_id"])},
            "cameras": [{"id": str(r["id"]), "name": r["name"], "station": r["station"], "url": r["rtsp_url"]} for r in rows]}


async def online_agent_for_branch(company_id: str, branch_id: str) -> dict | None:
    r = await fetchrow(
        """SELECT * FROM edge_agents WHERE company_id=$1 AND branch_id=$2 AND revoked_at IS NULL
           AND last_seen > now() - ($3 || ' seconds')::interval ORDER BY last_seen DESC LIMIT 1""",
        company_id, branch_id, str(ONLINE_SECONDS))
    return dict(r) if r else None


async def online_branch_ids() -> set[str]:
    rows = await fetch("SELECT DISTINCT branch_id FROM edge_agents WHERE revoked_at IS NULL AND last_seen > now() - ($1 || ' seconds')::interval", str(ONLINE_SECONDS))
    return {str(r["branch_id"]) for r in rows}


# ══════════════════ طابور الأوامر ══════════════════

async def request_snapshot(agent: dict, camera_id: str, timeout: float = 15.0) -> bytes:
    """يطلب من الوكيل لقطة ويبقى ينتظرها (حتى timeout ثانية)"""
    await execute("DELETE FROM edge_commands WHERE created_at < now() - interval '10 minutes'")
    cmd = await fetchrow("INSERT INTO edge_commands (agent_id, camera_id) VALUES ($1,$2) RETURNING id", agent["id"], camera_id)
    waited = 0.0
    while waited < timeout:
        r = await fetchrow("SELECT status, jpeg, error FROM edge_commands WHERE id=$1", cmd["id"])
        if r and r["status"] == "done" and r["jpeg"]:
            await execute("DELETE FROM edge_commands WHERE id=$1", cmd["id"])
            return bytes(r["jpeg"])
        if r and r["status"] == "failed":
            await execute("DELETE FROM edge_commands WHERE id=$1", cmd["id"])
            raise HTTPException(502, r["error"] or "فشل الوكيل في التقاط اللقطة")
        await asyncio.sleep(0.25)
        waited += 0.25
    await execute("UPDATE edge_commands SET status='failed', error='timeout', done_at=now() WHERE id=$1 AND status IN ('pending','claimed')", cmd["id"])
    raise HTTPException(504, "وكيل المحطة لم يردّ في الوقت المحدد — تحقق أن كمبيوتر المحطة يعمل ومتصل بالإنترنت")


async def poll_commands(agent: dict, wait: float = 20.0) -> list[dict]:
    """Long-poll: يرجع فور وجود أمر أو بعد wait ثانية بقائمة فارغة. كل استدعاء يُحسب نبضة حياة."""
    waited = 0.0
    while True:
        await execute("UPDATE edge_agents SET last_seen=now() WHERE id=$1", agent["id"])
        rows = await fetch(
            """UPDATE edge_commands SET status='claimed', claimed_at=now()
               WHERE id IN (SELECT id FROM edge_commands WHERE agent_id=$1 AND status='pending' ORDER BY created_at LIMIT 5 FOR UPDATE SKIP LOCKED)
               RETURNING id, camera_id, kind""", agent["id"])
        if rows:
            return [{"id": str(r["id"]), "cameraId": str(r["camera_id"]), "kind": r["kind"]} for r in rows]
        if waited >= wait:
            return []
        step = 1.0
        await asyncio.sleep(step)
        waited += step


async def submit_result(agent: dict, command_id: str, jpeg: bytes | None, error: str | None) -> None:
    if jpeg is not None and (len(jpeg) < 100 or len(jpeg) > MAX_JPEG or jpeg[:2] != b"\xff\xd8"):
        raise HTTPException(422, "اللقطة غير صالحة")
    r = await fetchrow(
        """UPDATE edge_commands SET status=$3, jpeg=$4, error=$5, done_at=now()
           WHERE id=$1 AND agent_id=$2 AND status IN ('pending','claimed') RETURNING id""",
        command_id, agent["id"], "done" if jpeg is not None else "failed", jpeg, (error or "")[:200] or None)
    if not r:
        raise HTTPException(404, "الأمر غير موجود أو انتهى")


# ══════════════════ صلاحية رفع لقطات الحركة (/auto-checkin/scan) ══════════════════

async def authorize_scan(gate_key: str | None, branch_id: str, global_key: str) -> None:
    """مفتاح وكيل صالح لفرعه، أو مفتاح البوابة العام (السلوك القديم). مفتاح وكيل لفرع آخر مرفوض."""
    if gate_key and gate_key.startswith(KEY_PREFIX):
        a = await agent_by_key(gate_key)
        if not a:
            raise HTTPException(401, "مفتاح الوكيل غير صحيح أو أُلغي")
        if str(a["branch_id"]) != str(branch_id):
            raise HTTPException(403, "مفتاح الوكيل لا يخص هذا الفرع")
        await execute("UPDATE edge_agents SET last_seen=now() WHERE id=$1", a["id"])
        return
    if global_key and gate_key != global_key:
        raise HTTPException(401, "مفتاح البوابة غير صحيح")
