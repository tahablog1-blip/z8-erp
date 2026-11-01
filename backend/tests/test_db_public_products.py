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
