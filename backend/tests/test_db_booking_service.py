# أجرة خدمة تغيير الزيت للسيارة: العادية والخارجية (زيت يحضره العميل) بقواعد منفصلة لكل سيارة
import uuid

import httpx
import pytest

from conftest import CO, run

pytestmark = pytest.mark.db
CID = uuid.UUID(CO)


def test_regular_and_external_services_resolve_separately(db_ready):
    from app.core import db
    from app.main import app

    async def go():
        async with db.pool().acquire() as c:
            await c.execute("TRUNCATE products, service_price_rules, branches RESTART IDENTITY CASCADE")
            br = await c.fetchval("INSERT INTO branches (company_id, name) VALUES ($1,'فرع') RETURNING id", CID)
            reg = await c.fetchval("INSERT INTO products (company_id, name, is_service, price_vat) VALUES ($1,'خدمة تغيير زيت',true,20) RETURNING id", CID)
            ext = await c.fetchval("INSERT INTO products (company_id, name, is_service, price_vat) VALUES ($1,'خدمة تغيير زيت خارجي',true,0) RETURNING id", CID)
            for pid, brand, price in [(reg, "تويوتا", 29.9), (ext, "تويوتا", 37.9), (ext, "مرسيدس", 75), (ext, None, 50)]:
                await c.execute("INSERT INTO service_price_rules (company_id, service_product_id, brand, price) VALUES ($1,$2,$3,$4)", CID, pid, brand, price)
        out = {}
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://t") as cl:
            for key, brand, e in [("t_reg", "تويوتا", 0), ("t_ext", "تويوتا", 1), ("m_ext", "مرسيدس", 1), ("h_ext", "هوندا", 1), ("m_reg", "مرسيدس", 0)]:
                r = await cl.get(f"/api/products/public/booking-service/{br}?brand={brand}&model=كامري&year=2020&external={e}")
                out[key] = r.json()["service"]
        return out
    o = run(go)
    assert (o["t_reg"]["name"], o["t_reg"]["price"]) == ("خدمة تغيير زيت", 29.9)
    assert (o["t_ext"]["name"], o["t_ext"]["price"]) == ("خدمة تغيير زيت خارجي", 37.9)      # تويوتا: 37.9 (لا تتأثر بالعادية)
    assert o["m_ext"]["price"] == 75.0                                                        # مرسيدس: 75
    assert o["h_ext"]["price"] == 50.0                                                        # بلا قاعدة للماركة: القاعدة العامة للخارجي
    assert o["m_reg"]["name"] == "خدمة تغيير زيت" and o["m_reg"]["price"] == 20.0             # العادية: لا قاعدة لمرسيدس → سعر الصنف نفسه


def test_external_without_configured_service_returns_none(db_ready):
    from app.core import db
    from app.main import app

    async def go():
        async with db.pool().acquire() as c:
            await c.execute("TRUNCATE products, service_price_rules, branches RESTART IDENTITY CASCADE")
            br = await c.fetchval("INSERT INTO branches (company_id, name) VALUES ($1,'فرع') RETURNING id", CID)
            await c.execute("INSERT INTO products (company_id, name, is_service, price_vat) VALUES ($1,'خدمة تغيير زيت',true,20)", CID)
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://t") as cl:
            return (await cl.get(f"/api/products/public/booking-service/{br}?brand=تويوتا&model=كامري&year=2020&external=1")).json()
    assert run(go) == {"service": None}                  # لا نُحمّله أجرة العادية: الأجرة تُحدَّد بالفرع
