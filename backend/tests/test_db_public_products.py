# كتالوج الحجز العام: الزيوت بشركاتها (يُستخدم في تطبيق العميل)
import uuid

import httpx
import pytest

from conftest import CO, run

pytestmark = pytest.mark.db
CID = uuid.UUID(CO)


def test_products_include_oils_and_brands_only(db_ready):
    from app.core import db
    from app.main import app

    async def go():
        async with db.pool().acquire() as c:
            await c.execute("TRUNCATE products, branches RESTART IDENTITY CASCADE")
            br = await c.fetchval("INSERT INTO branches (company_id, name) VALUES ($1,'فرع') RETURNING id", CID)
            await c.execute("""INSERT INTO products (company_id, name, spec, price_vat, is_oil, oil_brand, oil_type) VALUES
                 ($1,'شل هيلكس','5W-30',40,true,'شل','engine'), ($1,'كاسترول قير','75W-90',55,true,'كاسترول','gearbox')""", CID)
            await c.execute("""INSERT INTO products (company_id, name, price_vat, is_service, oil_type) VALUES
                 ($1,'أجرة تغيير زيت قير',25,true,'gearbox'), ($1,'أجرة دبل',30,true,'transfer'),
                 ($1,'خدمة بلا نوع',10,true,NULL)""", CID)
            await c.execute("INSERT INTO products (company_id, name, price_vat, is_service, oil_type, is_active) VALUES ($1,'موقوفة',9,true,'engine',false)", CID)
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://t") as cl:
            return (await cl.get(f"/api/cars/public/booking-products/{br}")).json()
    d = run(go)
    assert {o["name"] for o in d["oils"]} == {"شل هيلكس", "كاسترول قير"}
    assert "services" not in d      # أجرة الجير/الدفرنس/الدبل تُحدَّد في الفرع حسب الخدمة المتوفرة


def test_stock_flags_per_branch_and_customer_note_reaches_staff(db_ready):
    from app.core import db
    from app.main import app
    from app.modules.cars import service as cars_service

    async def go():
        async with db.pool().acquire() as c:
            await c.execute("TRUNCATE products, inventory, cars, branches RESTART IDENTITY CASCADE")
            b1 = await c.fetchval("INSERT INTO branches (company_id, name) VALUES ($1,'فرع 1') RETURNING id", CID)
            b2 = await c.fetchval("INSERT INTO branches (company_id, name) VALUES ($1,'فرع 2') RETURNING id", CID)
            have = await c.fetchval("INSERT INTO products (company_id, name, is_oil, oil_type, price_vat) VALUES ($1,'زيت متوفر',true,'engine',40) RETURNING id", CID)
            empty = await c.fetchval("INSERT INTO products (company_id, name, is_oil, oil_type, price_vat) VALUES ($1,'زيت نفد',true,'engine',50) RETURNING id", CID)
            other = await c.fetchval("INSERT INTO products (company_id, name, is_oil, oil_type, price_vat) VALUES ($1,'زيت بفرع آخر فقط',true,'engine',60) RETURNING id", CID)
            for br, pid, q in ((b1, have, 5), (b1, empty, 0), (b2, other, 9)):
                await c.execute("INSERT INTO inventory (company_id, loc_type, loc_id, product_id, qty) VALUES ($1,'branch',$2,$3,$4)", CID, str(br), pid, q)
            car = await c.fetchval("INSERT INTO cars (company_id, branch_id, notes) VALUES ($1,$2,'ملاحظة سابقة') RETURNING id", CID, b1)
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://t") as cl:
            d = (await cl.get(f"/api/cars/public/booking-products/{b1}")).json()
        stock = {o["name"]: o["inStock"] for o in d["oils"]}
        assert stock == {"زيت متوفر": True, "زيت نفد": False, "زيت بفرع آخر فقط": False}     # لكل فرع مخزونه
        await cars_service._save_booking_items(str(car), {"items": [], "customerNote": "زيت ماكينة من العميل (خارجي)"})
        await cars_service._save_booking_items(str(car), {"items": [], "customerNote": "زيت ماكينة من العميل (خارجي)"})   # بلا تكرار
        async with db.pool().acquire() as c:
            return await c.fetchval("SELECT notes FROM cars WHERE id=$1", car)
    notes = run(go)
    assert notes == "ملاحظة سابقة\n[العميل] زيت ماكينة من العميل (خارجي)"
