# منع الحجز إلا أمام الفرع: الفحص في الخادم + توكن قصير + طبقات ضد التزييف
import uuid

import httpx
import pytest

from conftest import CO, run

pytestmark = pytest.mark.db
CID = uuid.UUID(CO)
LAT, LNG = 24.7136, 46.6753
NEAR = (LAT + 0.0003, LNG)          # ~33 م
FAR = (LAT + 0.0040, LNG)           # ~445 م


def client():
    from app.main import app
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://t")


@pytest.fixture(autouse=True)
def otp_off(monkeypatch):
    from app.modules.cars import otp

    async def off(_c):
        return False
    monkeypatch.setattr(otp, "otp_enabled", off)


@pytest.fixture
def world(db_ready):
    from app.core import db

    async def go():
        async with db.pool().acquire() as c:
            await c.execute("TRUNCATE customer_notifications, invoice_items, invoices, customer_cars, cars, customers, branches RESTART IDENTITY CASCADE")
            br = await c.fetchval("INSERT INTO branches (company_id, name, latitude, longitude, geofence_enabled) VALUES ($1,'فرع',$2,$3,TRUE) RETURNING id", CID, LAT, LNG)
            off = await c.fetchval("INSERT INTO branches (company_id, name, latitude, longitude) VALUES ($1,'بلا فحص',$2,$3) RETURNING id", CID, LAT, LNG)
            return {"br": str(br), "off": str(off)}
    return run(go)


def post(path, body):
    async def go():
        async with client() as c:
            return await c.post(path, json=body)
    return run(go)


def geo(world, loc, **kw):
    return post(f"/api/cars/public/booking/{world['br']}/geo-check", {"lat": loc[0], "lng": loc[1], "accuracy": kw.pop("accuracy", 8), **kw}).json()


CAR = {"plateNumbers": "7777", "plateLetters": "KSA", "brand": "تويوتا", "carName": "كامري", "modelYear": "2020", "fuelType": "بنزين", "odometer": "5000"}


def book(world, token=None, branch="br"):
    return post(f"/api/cars/public/booking/{world[branch]}", {"name": "أحمد", "phone": "0500000001", "car": CAR, "geoToken": token})


def test_near_gets_token_and_can_book(world):
    r = geo(world, NEAR)
    assert r["ok"] and r["token"] and r["distanceM"] < 60
    assert book(world, r["token"]).status_code == 201


def test_far_is_refused_with_distance(world):
    r = geo(world, FAR)
    assert not r["ok"] and r["reason"] == "far" and 400 < r["distanceM"] < 500 and "token" not in r
    assert "اقترب" in r["message"]


def test_booking_without_or_with_forged_token_is_blocked(world):
    assert book(world).status_code == 403
    assert book(world, "forged.token.value").status_code == 403


def test_token_is_bound_to_its_branch(world):
    from app.core import db

    async def two():
        async with db.pool().acquire() as c:
            return str(await c.fetchval("INSERT INTO branches (company_id, name, latitude, longitude, geofence_enabled) VALUES ($1,'ثاني',$2,$3,TRUE) RETURNING id", CID, LAT, LNG))
    world["b2"] = run(two)
    tok = geo(world, NEAR)["token"]
    assert book(world, tok, branch="b2").status_code == 403


def test_expired_token_is_refused(world):
    import time
    import jwt
    from app.modules.cars import geofence
    old = int(time.time()) - 600
    tok = jwt.encode({"typ": "geo", "bid": world["br"], "iat": old, "exp": old + 180}, geofence._key(), algorithm="HS256")
    assert book(world, tok).status_code == 403


def test_spoofing_layers(world):
    assert geo(world, NEAR, mocked=True)["reason"] == "mock"
    assert geo(world, NEAR, accuracy=0)["reason"] == "no_accuracy"
    assert geo(world, NEAR, accuracy=250)["reason"] == "weak"
    assert geo(world, NEAR, fixAgeS=300)["reason"] == "stale"


def test_poor_accuracy_cannot_open_the_circle(world):
    far_edge = (LAT + 0.0020, LNG)      # ~222 م
    assert not geo(world, far_edge, accuracy=90)["ok"]      # التسامح بالدقة سقفه 50 م فقط


def test_branch_without_geofence_is_unaffected_and_web_booking_blocked_only_when_on(world):
    assert book(world, None, branch="off").status_code == 201
    web = {"customerName": "سالم", "customerPhone": "0555555555", "plateLetters": "ABC", "plateNumbers": "1234"}
    assert post(f"/api/cars/public/book/{world['br']}", web).status_code == 403


def test_register_only_needs_no_location(world):
    r = post(f"/api/cars/public/booking/{world['br']}", {"name": "أحمد", "phone": "0500000001", "car": CAR, "registerOnly": True})
    assert r.status_code == 201


def test_info_exposes_rule(world):
    async def go():
        async with client() as c:
            return await c.get(f"/api/cars/public/booking/{world['br']}")
    r = run(go).json()
    assert r["geofence"] == {"enabled": True, "radiusM": 150}
