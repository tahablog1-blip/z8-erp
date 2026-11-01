# فواتير العميل في تطبيق الحجز: كلها أو سيارة واحدة فقط، بهويته الموثّقة، دون تسريب فواتير غيره
import time
import uuid

import httpx
import jwt
import pytest

from conftest import CO, run

pytestmark = pytest.mark.db
CID = uuid.UUID(CO)


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
            await c.execute("TRUNCATE invoice_items, invoices, customer_cars, cars, customers, branches RESTART IDENTITY CASCADE")
            br = await c.fetchval("INSERT INTO branches (company_id, name) VALUES ($1,'فرع') RETURNING id", CID)
            me = await c.fetchval("INSERT INTO customers (company_id, name, phone) VALUES ($1,'أحمد','0500000001') RETURNING id", CID)
            other = await c.fetchval("INSERT INTO customers (company_id, name, phone) VALUES ($1,'غيره','0500000002') RETURNING id", CID)
            car1 = await c.fetchval("INSERT INTO customer_cars (company_id, customer_id, plate, brand, name) VALUES ($1,$2,'1234 ABC','تويوتا','كامري') RETURNING id", CID, me)
            car2 = await c.fetchval("INSERT INTO customer_cars (company_id, customer_id, plate, brand, name) VALUES ($1,$2,'9999 XYZ','هيونداي','سوناتا') RETURNING id", CID, me)
            foreign = await c.fetchval("INSERT INTO customer_cars (company_id, customer_id, plate, brand, name) VALUES ($1,$2,'5555 QQQ','كيا','سبورتاج') RETURNING id", CID, other)

            async def inv(no, plate, cust, odo, items, phone=None, returned=False):
                wo = await c.fetchval("INSERT INTO cars (company_id, branch_id, plate, brand, name, odometer_current) VALUES ($1,$2,$3,'x','y',$4) RETURNING id", CID, br, plate, odo)
                iid = await c.fetchval(
                    "INSERT INTO invoices (company_id, branch_id, invoice_no, customer_id, customer_phone, car_id, total_inc, payment_status, is_returned) VALUES ($1,$2,$3,$4,$5,$6,$7,'paid',$8) RETURNING id",
                    CID, br, no, cust, phone, wo, sum(p for _, p in items), returned)
                for label, price in items:
                    await c.execute("INSERT INTO invoice_items (invoice_id, label, qty, line_inc) VALUES ($1,$2,1,$3)", iid, label, price)
            await inv("A-1", "1234ABC", me, 80000, [("زيت ماكينة", 120), ("فلتر زيت", 30)])
            await inv("A-2", "1234 ABC", me, 90000, [("زيت قير", 90)])            # نفس اللوحة بمسافة
            await inv("B-1", "9999XYZ", me, 50000, [("زيت دفرنس", 60)])
            await inv("C-1", "1234ABC", None, 1, [("بلا عميل", 5)], phone="966500000001")   # قديمة بالجوال فقط
            await inv("R-1", "1234ABC", me, 1, [("مرتجعة", 5)], returned=True)
            await inv("X-1", "5555QQQ", other, 10, [("لغيري", 999)])
            return {"br": str(br), "car1": str(car1), "car2": str(car2), "foreign": str(foreign), "me": str(me)}
    return run(go)


def post(world, body, otp=False, monkeypatch=None):
    async def go():
        async with client() as c:
            return await c.post(f"/api/cars/public/booking/{world['br']}/invoices", json=body)
    return run(go)


def test_all_invoices_by_phone_when_otp_disabled(world):
    r = post(world, {"phone": "0500000001"})
    assert r.status_code == 200
    nos = [i["invoiceNo"] for i in r.json()["invoices"]]
    assert set(nos) == {"A-1", "A-2", "B-1", "C-1"}                 # لا المرتجعة ولا فواتير غيره
    a1 = next(i for i in r.json()["invoices"] if i["invoiceNo"] == "A-1")
    assert a1["odometer"] == 80000 and a1["total"] == 150
    assert [x["label"] for x in a1["items"]] == ["زيت ماكينة", "فلتر زيت"]
    assert r.json()["pdfPhone"] == "0500000001"


def test_single_car_page_shows_only_that_cars_invoices(world):
    r = post(world, {"phone": "0500000001", "savedCarId": world["car1"]})
    assert {i["invoiceNo"] for i in r.json()["invoices"]} == {"A-1", "A-2", "C-1"}   # اللوحة بمسافة أو بدونها
    r2 = post(world, {"phone": "0500000001", "savedCarId": world["car2"]})
    assert [i["invoiceNo"] for i in r2.json()["invoices"]] == ["B-1"]


def test_cannot_read_another_customers_car_or_unknown_phone(world):
    assert post(world, {"phone": "0500000001", "savedCarId": world["foreign"]}).status_code == 404
    assert post(world, {"phone": "0511111111"}).json() == {"invoices": []}
    assert post(world, {"phone": "123"}).status_code == 422


def test_with_otp_enabled_phone_alone_is_not_enough(world, monkeypatch):
    from app.modules.cars import otp

    async def on(_c):
        return True
    monkeypatch.setattr(otp, "otp_enabled", on)
    assert post(world, {"phone": "0500000001"}).status_code == 401                  # بلا توكن
    now = int(time.time())
    from app.modules.cars.otp import _token_key
    tok = jwt.encode({"typ": "booking", "cid": CO, "ch": "phone", "sub": "0500000001", "iat": now, "exp": now + 600}, _token_key(), algorithm="HS256")
    r = post(world, {"otpToken": tok, "savedCarId": world["car2"]})
    assert r.status_code == 200 and [i["invoiceNo"] for i in r.json()["invoices"]] == ["B-1"]
    bad = jwt.encode({"typ": "booking", "cid": str(uuid.uuid4()), "ch": "phone", "sub": "0500000001", "exp": now + 600}, _token_key(), algorithm="HS256")
    assert post(world, {"otpToken": bad}).status_code == 401                        # توكن شركة أخرى
