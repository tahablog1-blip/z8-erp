# أسعار الخدمة بالشركات دفعة واحدة + إلغاء تصنيف كل الزيوت
import uuid

import pytest

from conftest import CO, run

pytestmark = pytest.mark.db
CID = uuid.UUID(CO)


def test_bulk_rules_upsert_and_clear_all_types(db_ready):
    from app.core import db
    from app.modules.products import service
    from fastapi import HTTPException

    async def go():
        async with db.pool().acquire() as c:
            await c.execute("TRUNCATE products, service_price_rules RESTART IDENTITY CASCADE")
            svc = await c.fetchval("INSERT INTO products (company_id, name, is_service) VALUES ($1,'تغيير زيت',true) RETURNING id", CID)
            oil = await c.fetchval("INSERT INTO products (company_id, name, is_oil, oil_type, oil_brand) VALUES ($1,'شل',true,'engine','شل') RETURNING id", CID)
            svc2 = await c.fetchval("INSERT INTO products (company_id, name, is_service, oil_type) VALUES ($1,'أجرة قير',true,'gearbox') RETURNING id", CID)
            # قاعدة أخص (تويوتا + كامري) يجب ألا تُمس
            await c.execute("INSERT INTO service_price_rules (company_id, service_product_id, brand, model, price) VALUES ($1,$2,'تويوتا','كامري',55)", CID, svc)
        r = await service.bulk_service_rules(CO, str(svc), 40, ["تويوتا", "هيونداي", "تويوتا", " "])
        assert r["count"] == 2                                              # التكرار والفارغ يُهملان
        r2 = await service.bulk_service_rules(CO, str(svc), 45, ["تويوتا"])   # تحديث لا تكرار
        async with db.pool().acquire() as c:
            rows = {(r["brand"], r["model"]): float(r["price"]) for r in await c.fetch("SELECT * FROM service_price_rules")}
        assert rows == {("تويوتا", None): 45.0, ("هيونداي", None): 40.0, ("تويوتا", "كامري"): 55.0}
        await service.bulk_service_rules(CO, str(svc), 30, [], all_brands=True)
        async with db.pool().acquire() as c:
            assert await c.fetchval("SELECT price FROM service_price_rules WHERE brand IS NULL") == 30
        for bad in (lambda: service.bulk_service_rules(CO, str(svc), 10, []),
                    lambda: service.bulk_service_rules(CO, str(svc), -1, ["كيا"]),
                    lambda: service.bulk_service_rules(CO, str(oil), 10, ["كيا"])):       # ليست خدمة
            with pytest.raises(HTTPException):
                await bad()
        # إلغاء تصنيف كل الزيوت لا يمس الخدمات ولا الشركة
        out = await service.clear_all_oil_types(CO)
        assert out["count"] == 1
        async with db.pool().acquire() as c:
            assert await c.fetchval("SELECT oil_type FROM products WHERE id=$1", oil) is None
            assert await c.fetchval("SELECT oil_brand FROM products WHERE id=$1", oil) == "شل"
            assert await c.fetchval("SELECT oil_type FROM products WHERE id=$1", svc2) == "gearbox"
    run(go)
