# وكيل المحطة عبر HTTP حقيقي (ASGI داخل العملية): مصادقة المفتاح، النبضة، طابور اللقطات بـ multipart، وحماية /scan والإدارة.
import asyncio
import uuid

import httpx
import pytest

from conftest import CO, run
from test_db_edge import CID, JPEG, e, mk, svc, agent_of, q   # noqa: F401  (e = عالم المحطة)

pytestmark = pytest.mark.db


def client():
    from app.main import app
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://t")


def test_hello_commands_result_over_http(e):
    key = mk(e)["key"]
    cam = e["cams"]["حفرة 3"]

    async def go():
        async with client() as c:
            h = {"X-Agent-Key": key}
            assert (await c.post("/api/edge/hello", json={"version": "1"})).status_code == 401           # بلا مفتاح
            assert (await c.post("/api/edge/hello", json={}, headers={"X-Agent-Key": "z8a_nope"})).status_code == 401
            r = await c.post("/api/edge/hello", json={"version": "1.2", "cameras": {cam: {"ok": True}}}, headers=h)
            assert r.status_code == 200 and len(r.json()["cameras"]) == 5

            agent = agent_of_sync = await svc().require_agent(key)

            async def agent_side():
                cmds = (await c.get("/api/edge/commands?wait=5", headers=h)).json()
                assert cmds[0]["cameraId"] == cam
                res = await c.post(f"/api/edge/commands/{cmds[0]['id']}/result", files={"image": ("shot.jpg", JPEG, "image/jpeg")}, headers=h)
                assert res.status_code == 204
            got, _ = await asyncio.gather(svc().request_snapshot(agent, cam, timeout=10), agent_side())
            assert got == JPEG

            async def agent_fails():
                cmds = (await c.get("/api/edge/commands?wait=5", headers=h)).json()
                res = await c.post(f"/api/edge/commands/{cmds[0]['id']}/result", data={"error": "ISAPI 401"}, headers=h)
                assert res.status_code == 204
            from fastapi import HTTPException
            out = await asyncio.gather(svc().request_snapshot(agent, cam, timeout=10), agent_fails(), return_exceptions=True)
            assert isinstance(out[0], HTTPException) and out[0].status_code == 502 and out[0].detail == "ISAPI 401"
    run(go)


def test_admin_requires_login_and_scan_rejects_foreign_agent_key(e):
    k_other = mk(e, "وكيل فرع آخر", e["b2"])["key"]

    async def go():
        async with client() as c:
            assert (await c.get("/api/edge/admin/agents")).status_code == 401
            assert (await c.post("/api/edge/admin/agents", json={"branchId": e["b1"], "name": "x"})).status_code == 401
            # /scan بمفتاح وكيل فرع آخر → 403 قبل أي معالجة
            r = await c.post("/api/auto-checkin/scan", files={"image": ("a.jpg", JPEG, "image/jpeg")},
                             data={"branch_id": e["b1"], "gate_key": k_other, "auto_checkin": "true"})
            assert r.status_code == 403
            r = await c.post("/api/auto-checkin/scan", files={"image": ("a.jpg", JPEG, "image/jpeg")},
                             data={"branch_id": e["b1"], "gate_key": "z8a_forged", "auto_checkin": "true"})
            assert r.status_code == 401
    run(go)
