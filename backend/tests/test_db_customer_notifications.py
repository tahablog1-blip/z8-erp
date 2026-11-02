# صندوق إشعارات العميل (زر الجرس) + قائمة المحادثات + تسجيل سيارة بدون حجز
import uuid

import httpx
import pytest

from conftest import CO, run as _run

pytestmark = pytest.mark.db


def run(x):
    return _run(x) if callable(x) else _run(lambda: x)
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
            await c.execute("TRUNCATE customer_notifications, service_messages, invoice_items, invoices, customer_cars, cars, customers, branches RESTART IDENTITY CASCADE")
            br = await c.fetchval("INSERT INTO branches (company_id, name) VALUES ($1,'فرع الشمال') RETURNING id", CID)
            me = await c.fetchval("INSERT INTO customers (company_id, name, phone) VALUES ($1,'أحمد','0500000001') RETURNING id", CID)
            other = await c.fetchval("INSERT INTO customers (company_id, name, phone) VALUES ($1,'غيره','0500000002') RETURNING id", CID)
            return {"br": str(br), "me": me, "other": other}
    return run(go)


def call(path, body):
    async def go():
        async with client() as c:
            return await c.post(path, json=body)
    return run(go())


def test_add_list_read_and_isolation(world):
    from app.modules.cars import notify_inbox
    run(notify_inbox.add(CID, world["me"], "booking", "تم حجز دورك", "x", dedupe="b:1"))
    run(notify_inbox.add(CID, world["me"], "booking", "تم حجز دورك", "x", dedupe="b:1"))      # مكرر → يُتجاهل
    run(notify_inbox.add(CID, world["other"], "booking", "لغيري"))
    base = f"/api/cars/public/booking/{world['br']}"
    r = call(f"{base}/notifications", {"phone": "0500000001"}).json()
    assert [i["title"] for i in r["items"]] == ["تم حجز دورك"] and r["unread"] == 1
    call(f"{base}/notifications/read", {"phone": "0500000001", "ids": [r["items"][0]["id"]]})
    r = call(f"{base}/notifications", {"phone": "0500000001"}).json()
    assert r["unread"] == 0 and r["items"][0]["read"] is True
    r2 = call(f"{base}/notifications", {"phone": "0500000002"}).json()
    assert [i["title"] for i in r2["items"]] == ["لغيري"]


def test_due_reminder_after_five_months_once(world):
    from app.core import db
    from app.modules.cars import notify_inbox

    async def go():
        async with db.pool().acquire() as c:
            wo = await c.fetchval("INSERT INTO cars (company_id, branch_id, plate) VALUES ($1,$2,'1234 ABC') RETURNING id", CID, uuid.UUID(world["br"]))
            await c.execute("INSERT INTO invoices (company_id, branch_id, invoice_no, customer_id, car_id, total_inc, issued_at) VALUES ($1,$2,'A-1',$3,$4,100, now() - interval '200 days')",
                            CID, uuid.UUID(world["br"]), world["me"], wo)
    run(go())
    for _ in range(2):
        r = run(notify_inbox.list_for(CID, world["me"]))
    assert [i["kind"] for i in r["items"]] == ["due"] and "1234 ABC" in r["items"][0]["body"]


def test_employee_message_notifies_and_chat_list(world):
    from app.core import db
    from app.modules.service_notes import api as sn

    async def go():
        async with db.pool().acquire() as c:
            return await c.fetchval("INSERT INTO cars (company_id, branch_id, plate, customer_id) VALUES ($1,$2,'1234 ABC',$3) RETURNING id",
                                    CID, uuid.UUID(world["br"]), world["me"])
    wo = run(go())

    async def msg(text):
        async with db.pool().acquire() as c:
            await c.execute("INSERT INTO service_messages (company_id, branch_id, work_order_id, customer_id, sender_type, message) VALUES ($1,$2,$3,$4,'employee',$5)",
                            CID, uuid.UUID(world["br"]), wo, world["me"], text)
        await sn._notify_customer_message(wo, text)
    run(msg("أول رسالة"))
    run(msg("سيارتك جاهزة"))
    base = f"/api/cars/public/booking/{world['br']}"
    n = call(f"{base}/notifications", {"phone": "0500000001"}).json()
    assert [(i["kind"], i["body"], i["refId"]) for i in n["items"]] == [("message", "سيارتك جاهزة", str(wo))]   # إشعار واحد يتحدّث
    ch = call(f"{base}/chats", {"phone": "0500000001"}).json()["chats"]
    assert len(ch) == 1 and ch[0]["bookingId"] == str(wo) and ch[0]["unread"] == 2 and ch[0]["lastMessage"] == "سيارتك جاهزة"
    assert call(f"{base}/chats", {"phone": "0500000002"}).json()["chats"] == []


def test_register_only_then_booking_notify(world):
    base = f"/api/cars/public/booking/{world['br']}"
    car = {"plateNumbers": "7777", "plateLetters": "KSA", "brand": "تويوتا", "carName": "كامري", "modelYear": "2020", "fuelType": "بنزين"}
    r = call(base, {"name": "أحمد", "phone": "0500000001", "car": car, "registerOnly": True})
    assert r.status_code == 201 and r.json() == {"registered": True, "plate": "7777 KSA"}, r.text
    n = call(f"{base}/notifications", {"phone": "0500000001"}).json()
    assert [i["kind"] for i in n["items"]] == ["car_registered"]
    # لم يُنشأ حجز دور
    from app.core import db

    async def cnt():
        async with db.pool().acquire() as c:
            return await c.fetchval("SELECT COUNT(*) FROM cars")
    assert run(cnt) == 0
    r = call(base, {"name": "أحمد", "phone": "0500000001", "car": {**car, "odometer": "5000"}})
    assert r.status_code == 201, r.text
    kinds = sorted(i["kind"] for i in call(f"{base}/notifications", {"phone": "0500000001"}).json()["items"])
    assert kinds == ["booking", "car_registered"]   # السيارة سُجّلت سابقاً فلا إشعار تسجيل ثانٍ


def test_lookup_cars_carry_fuel_and_last_odometer(world):
    base = f"/api/cars/public/booking/{world['br']}"
    car = {"plateNumbers": "7777", "plateLetters": "KSA", "brand": "تويوتا", "carName": "كامري", "modelYear": "2020", "fuelType": "بنزين"}
    call(base, {"name": "أحمد", "phone": "0500000001", "car": {**car, "odometer": "5000"}})
    r = call(f"{base}/lookup", {"phone": "0500000001"}).json()
    c = r["cars"][0]
    assert c["fuel_type"] == "بنزين" and c["last_odometer"] == 5000
