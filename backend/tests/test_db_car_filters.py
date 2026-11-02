# ربط فلاتر السيارات: عدة فلاتر لسيارة واحدة (زيت متعدد + هواء + مكيف) دفعة واحدة، بلا تكرار، وخيارات للعميل مع المتوفر أولاً
import uuid

import httpx
import pytest
from fastapi import HTTPException

from conftest import CO, run

pytestmark = pytest.mark.db
CID = uuid.UUID(CO)


@pytest.fixture
def world(db_ready):
    from app.core import db

    async def go():
        async with db.pool().acquire() as c:
            await c.execute("TRUNCATE car_oil_filters, products, inventory, branches RESTART IDENTITY CASCADE")
            br = await c.fetchval("INSERT INTO branches (company_id, name) VALUES ($1,'فرع') RETURNING id", CID)
            ids = {}
            for key, name in [("oil1", "فلتر زيت تويوتا 31090"), ("oil2", "فلتر زيت تويوتا e2"), ("air", "فلتر هواء كامري"), ("ac", "فلتر مكيف كامري"), ("other", "فلتر زيت نيسان")]:
                ids[key] = str(await c.fetchval("INSERT INTO products (company_id, name, is_oil_filter, price_vat) VALUES ($1,$2,true,25) RETURNING id", CID, name))
            await c.execute("INSERT INTO inventory (company_id, loc_type, loc_id, product_id, qty) VALUES ($1,'branch',$2,$3,0),($1,'branch',$2,$4,7)",
                            CID, str(br), ids["oil1"], ids["oil2"])      # الأول نفد والثاني متوفر
            return {"br": str(br), **ids}
    return run(go)


def test_bulk_adds_many_filters_without_duplicates(world):
    from app.core import db
    from app.modules.cars import service

    async def go():
        fl = [{"kind": "oil", "productId": world["oil1"]}, {"kind": "oil", "productId": world["oil2"]},
              {"kind": "air", "productId": world["air"]}, {"kind": "ac", "productId": world["ac"]},
              {"kind": "oil", "productId": world["oil1"]}]          # تكرار داخل الطلب يُهمل
        r = await service.bulk_car_filters(CO, " تويوتا ", "كامري", 2025, 2018, fl, None)    # السنوات معكوسة تُصحَّح
        assert r == {"added": 4, "skipped": 0}
        again = await service.bulk_car_filters(CO, "تويوتا", "كامري", 2018, 2025, fl, None)
        assert again == {"added": 0, "skipped": 4}                                          # لا تكرار
        six = await service.bulk_car_filters(CO, "تويوتا", "كامري", 2018, 2025, fl[:1], None, cylinders=6)
        assert six["added"] == 1                                                            # محرك مختلف = ربط مستقل
        async with db.pool().acquire() as c:
            rows = await c.fetch("SELECT filter_kind, year_from, year_to, brand FROM car_oil_filters")
        assert len(rows) == 5 and all((r["year_from"], r["year_to"], r["brand"]) == (2018, 2025, "تويوتا") for r in rows)
        for bad in (lambda: service.bulk_car_filters(CO, "تويوتا", "كامري", 2018, 2025, [], None),
                    lambda: service.bulk_car_filters(CO, "", "كامري", 2018, 2025, fl, None),
                    lambda: service.bulk_car_filters(CO, "تويوتا", "كامري", 2018, 2025, [{"kind": "fuel", "productId": world["air"]}], None),
                    lambda: service.bulk_car_filters(CO, "تويوتا", "كامري", 2018, 2025, [{"kind": "oil", "productId": str(uuid.uuid4())}], None)):
            with pytest.raises(HTTPException):
                await bad()
    run(go)


def test_public_match_returns_all_options_in_stock_first(world):
    from app.main import app
    from app.modules.cars import service

    async def go():
        await service.bulk_car_filters(CO, "تويوتا", "كامري", 2018, 2025,
                                       [{"kind": "oil", "productId": world["oil1"]}, {"kind": "oil", "productId": world["oil2"]}], None)
        await service.bulk_car_filters(CO, "نيسان", "التيما", 2018, 2025, [{"kind": "oil", "productId": world["other"]}], None)
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://t") as cl:
            q = f"/api/cars/public/car-oil-filter-match/{world['br']}?brand=تويوتا&model=كامري&year=2020&kind=oil"
            r = (await cl.get(q)).json()
            none = (await cl.get(f"/api/cars/public/car-oil-filter-match/{world['br']}?brand=هوندا&model=سيفيك&year=2020&kind=oil")).json()
        assert {o["name"] for o in r["options"]} == {"فلتر زيت تويوتا 31090", "فلتر زيت تويوتا e2"}     # كلاهما ممكن للسيارة
        assert r["name"] == "فلتر زيت تويوتا e2" and r["inStock"] is True                            # الأفضل = المتوفر أولاً
        assert {o["name"]: o["inStock"] for o in r["options"]} == {"فلتر زيت تويوتا 31090": False, "فلتر زيت تويوتا e2": True}
        assert none is None
    run(go)


def test_engine_ambiguity_asks_instead_of_showing_other_engines_filters(world):
    """كامري 4 سلندر و6 سلندر بفلاتر مختلفة: سيارة بمحرك مجهول لا تُعرض عليها فلاتر محرك لم تُختر"""
    from app.main import app
    from app.modules.cars import service

    async def go():
        await service.bulk_car_filters(CO, "تويوتا", "كامري", 2011, 2025, [{"kind": "oil", "productId": world["oil1"]}], None, cylinders=6)
        await service.bulk_car_filters(CO, "تويوتا", "كامري", 2018, 2027, [{"kind": "oil", "productId": world["oil2"]}], None, cylinders=4)
        base = f"/api/cars/public/car-oil-filter-match/{world['br']}?brand=تويوتا&model=كامري&year=2020&kind=oil"
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://t") as cl:
            ask = (await cl.get(base + "&engineAsk=1")).json()
            four = (await cl.get(base + "&engineAsk=1&cylinders=4")).json()
            six = (await cl.get(base + "&engineAsk=1&cylinders=6")).json()
            legacy = (await cl.get(base)).json()                   # صفحة الحجز القديمة: سلوكها كما هو
        assert ask["needsEngine"] is True and ask["options"] == []                                   # لا نخمّن
        assert sorted(e["cylinders"] for e in ask["engines"]) == [4, 6]
        assert [o["name"] for o in four["options"]] == ["فلتر زيت تويوتا e2"] and "needsEngine" not in four
        assert [o["name"] for o in six["options"]] == ["فلتر زيت تويوتا 31090"]
        assert "needsEngine" not in legacy and legacy["options"]                                       # تعمل كما كانت
        # ربط عام (بلا محرك) يظهر مع كل محرك، وسؤال المحرك لا يلزم لو محرك واحد فقط
        await service.bulk_car_filters(CO, "تويوتا", "كامري", 2011, 2027, [{"kind": "oil", "productId": world["air"]}], None)
        generic = (await cl_get(app, base + "&engineAsk=1"))
        assert generic["needsEngine"] is True and [o["name"] for o in generic["options"]] == ["فلتر هواء كامري"]
        assert [o["name"] for o in (await cl_get(app, base + "&engineAsk=1&cylinders=6"))["options"]] == ["فلتر زيت تويوتا 31090", "فلتر هواء كامري"]
    run(go)


async def cl_get(app, url):
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://t") as cl:
        return (await cl.get(url)).json()
