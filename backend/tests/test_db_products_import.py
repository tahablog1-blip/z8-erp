# استيراد الأصناف من Excel: صنفان مختلفا الباركود بنفس (الفئة+الاسم) لا يكسران القيد uq_products_combo.
import uuid

import pytest

from conftest import CO, run

pytestmark = pytest.mark.db
CID = uuid.UUID(CO)


def test_import_rename_clash_updates_prices_only_with_warning(db_ready):
    from app.core import db
    from app.modules.products import service

    async def go():
        await db.execute("TRUNCATE products RESTART IDENTITY CASCADE")
        await db.execute("CREATE UNIQUE INDEX IF NOT EXISTS uq_products_combo ON products (company_id, category, name, COALESCE(spec, ''))")
        await db.execute("INSERT INTO products (company_id,category,name,barcode,price,cost_price) VALUES ($1,'فلاتر','فلتر هواء','A1',10,5),($1,'فلاتر','فلتر هواء 2','B2',20,8)", CID)
        # الصف: باركود B2 (صنف «فلتر هواء 2») لكن اسمه بالملف «فلتر هواء» بنفس الفئة → كان يصطدم بالقيد
        res = await service.import_products_rows(CO, [{"name": "فلتر هواء", "barcode": "B2", "price_vat": "23", "cost": "9", "unit": "", "category": "فلاتر"}])
        assert res["errorsTotal"] == 0 and res["warningsTotal"] == 1 and res["updated"] == 1
        row = await db.fetchrow("SELECT name, price, cost_price FROM products WHERE barcode='B2'")
        assert row["name"] == "فلتر هواء 2" and float(row["cost_price"]) == 9.0 and round(float(row["price"]), 2) == 20.0
        # حالة عادية: إعادة تسمية بلا تعارض تعمل كما كانت
        res = await service.import_products_rows(CO, [{"name": "فلتر هواء جديد", "barcode": "B2", "price_vat": "", "cost": "", "unit": "", "category": "فلاتر"}])
        assert res["warningsTotal"] == 0 and res["errorsTotal"] == 0
        assert (await db.fetchrow("SELECT name FROM products WHERE barcode='B2'"))["name"] == "فلتر هواء جديد"
    run(go)
