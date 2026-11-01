# قائمة الفروع العامة لتطبيق العميل: خدمة/تجزئة، الموقع، حالة الانتظار، وعدم تسرّب فروع شركات أخرى
import uuid

import httpx
import pytest

from conftest import CO, run

pytestmark = pytest.mark.db
CID = uuid.UUID(CO)


def client():
    from app.main import app
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://t")


@pytest.fixture
def world(db_ready):
    from app.core import db

    async def go():
        async with db.pool().acquire() as c:
            await c.execute("TRUNCATE cars, branches RESTART IDENTITY CASCADE")
            ids = {}
            for key, name, cat, lat, lng, active, frozen in [
                ("svc", "فرع الخليج", "service", 24.7136, 46.6753, True, False),
                ("retail", "معرض التجزئة", "retail", 24.80, 46.70, True, False),
                ("noloc", "فرع بلا موقع", "service", None, None, True, False),
                ("frozen", "فرع مجمّد", "service", 24.0, 46.0, True, True),
                ("off", "فرع ملغى", "service", 24.0, 46.0, False, False),
            ]:
                ids[key] = await c.fetchval(
                    "INSERT INTO branches (company_id, name, category, latitude, longitude, is_active, is_frozen) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id",
                    CID, name, cat, lat, lng, active, frozen)
            # 2 منتظرة + 1 داخل الخدمة لفرع الخدمة، وواحدة خرجت (لا تُحسب)
            await c.execute("INSERT INTO cars (company_id, branch_id) VALUES ($1,$2),($1,$2)", CID, ids["svc"])
            await c.execute("INSERT INTO cars (company_id, branch_id, entered_at) VALUES ($1,$2, now())", CID, ids["svc"])
            await c.execute("INSERT INTO cars (company_id, branch_id, entered_at, exited_at) VALUES ($1,$2, now(), now())", CID, ids["svc"])
            return {k: str(v) for k, v in ids.items()}
    return run(go)


def test_lists_active_branches_with_category_location_and_queue(world):
    async def go():
        async with client() as c:
            r = await c.get("/api/cars/public/branches")
            assert r.status_code == 200
            return {b["id"]: b for b in r.json()}
    got = run(go)
    assert set(got) == {world["svc"], world["retail"], world["noloc"]}        # المجمّد والملغى لا يظهران
    svc = got[world["svc"]]
    assert svc["category"] == "service" and svc["bookable"] is True
    assert (svc["latitude"], svc["longitude"]) == (24.7136, 46.6753)
    assert (svc["waiting"], svc["inService"]) == (2, 1)
    assert svc["estWaitMinutes"] == 2 * 18
    retail = got[world["retail"]]
    assert retail["category"] == "retail" and retail["bookable"] is False
    assert retail["waiting"] is None and retail["estWaitMinutes"] is None
    assert got[world["noloc"]]["latitude"] is None


def test_two_companies_require_explicit_company(world):
    from app.core import db
    other = uuid.uuid4()

    async def go():
        async with db.pool().acquire() as c:
            await c.execute("INSERT INTO branches (company_id, name, category) VALUES ($1,'فرع شركة أخرى','service')", other)
        async with client() as cl:
            amb = await cl.get("/api/cars/public/branches")                       # غامض: أكثر من شركة
            mine = await cl.get(f"/api/cars/public/branches?company={CO}")
            theirs = await cl.get(f"/api/cars/public/branches?company={other}")
            bad = await cl.get("/api/cars/public/branches?company=nope")
            return amb, mine, theirs, bad
    amb, mine, theirs, bad = run(go)
    assert amb.status_code == 400
    assert {b["name"] for b in mine.json()} == {"فرع الخليج", "معرض التجزئة", "فرع بلا موقع"}
    assert [b["name"] for b in theirs.json()] == ["فرع شركة أخرى"]
    assert bad.status_code == 422
