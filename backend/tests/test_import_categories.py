# استيراد Excel: الفئة تُدخَل حرفياً كما في الملف، ونوع الصنف (خدمة/زيت/فلتر/عادي) يتبع الفئة
import uuid

import pytest

from app.modules.products.service import category_kind as k, clean_category as cc


@pytest.mark.parametrize("cat,kind", [
    ("خدمات", "service"), ("خدمة تغيير زيت", "service"), ("أجرة عمالة", "service"), ("Service", "service"),
    ("زيوت", "oil"), ("زيوت محركات", "oil"), ("Engine Oil", "oil"),
    ("فلاتر", "filter"), ("فلاتر زيت", "filter"), ("فلتر هواء", "filter"),     # فلاتر الزيت فلتر لا زيت
    ("اكسسوارات", "normal"), ("بطاريات", "normal"), ("", "normal"),
])
def test_category_kind(cat, kind):
    assert k(cat) == kind


def test_clean_category_keeps_text_verbatim():
    assert cc("  زيوت ‏/ محركات  ") == "زيوت / محركات"       # يزيل علامات الاتجاه ويوحّد المسافات فقط
    assert cc("All / Saleable / زيوت") == "All / Saleable / زيوت"       # لا يقتطع المسار


@pytest.mark.db
def test_import_sets_category_and_type_flags(db_ready):
    from conftest import CO, run
    from app.core import db
    from app.modules.products import service
    CID = uuid.UUID(CO)

    async def go():
        async with db.pool().acquire() as c:
            await c.execute("TRUNCATE products RESTART IDENTITY CASCADE")
            # صنف قديم مصنّف خطأً كخدمة سيُعاد تصنيفه من الملف
            await c.execute("INSERT INTO products (company_id, name, barcode, category, is_service) VALUES ($1,'كاسترول زيت ماكينة','111','قديمة',true)", CID)
        rows = [
            {"name": "كاسترول زيت ماكينة", "barcode": "111", "price_vat": "40", "category": "زيوت"},
            {"name": "تغيير زيت ماكينة", "barcode": "222", "price_vat": "30", "category": "خدمات"},
            {"name": "فلتر زيت تويوتا", "barcode": "333", "price_vat": "25", "category": "فلاتر"},
            {"name": "فلتر هواء كامري", "barcode": "334", "price_vat": "35", "category": "فلتر هواء"},
            {"name": "ممسحة زجاج", "barcode": "444", "price_vat": "15", "category": "اكسسوارات"},
            {"name": "منتج بلا فئة", "barcode": "555", "price_vat": "5", "category": ""},
            {"name": "إطار", "barcode": "666", "price_vat": "300", "category": "إطارات"},
        ]
        r = await service.import_products_rows(CO, rows, {"إطارات": "oil"})     # تعيين صريح من شاشة المراجعة يغلب الاستنتاج
        assert r["added"] == 6 and r["updated"] == 1 and r["errorsTotal"] == 0
        async with db.pool().acquire() as c:
            got = {x["barcode"]: x for x in await c.fetch("SELECT barcode, category, is_service, is_oil, is_oil_filter, filter_kind FROM products")}
        assert got["111"]["category"] == "زيوت" and got["111"]["is_oil"] and not got["111"]["is_service"]   # صُحّح من الملف
        assert got["222"]["category"] == "خدمات" and got["222"]["is_service"] and not got["222"]["is_oil"]
        assert got["333"]["is_oil_filter"] and got["333"]["filter_kind"] == "oil" and not got["333"]["is_oil"]
        assert got["334"]["is_oil_filter"] and got["334"]["filter_kind"] == "air"
        assert got["444"]["category"] == "اكسسوارات" and not (got["444"]["is_service"] or got["444"]["is_oil"] or got["444"]["is_oil_filter"])
        assert got["666"]["category"] == "إطارات" and got["666"]["is_oil"]
        assert not (got["555"]["is_service"] or got["555"]["is_oil"])                                      # بلا فئة: لا تغيير
    run(go)


def test_resolve_uses_product_category_and_pos_category():
    from app.modules.products.service import resolve_import_class as r
    def x(name, pos, prod=""):
        return r({"name": name, "category": pos, "product_category": prod})
    a = x("كاسترول 5-30", "زيت المحرك", "Engine Oil")
    assert (a["category"], a["kind"], a["oilType"]) == ("زيت المحرك", "oil", "engine")             # فئة نقطة البيع حرفياً
    b = x("زيت دفرينس 80-90", "زيت القير", "Gear Oil")
    assert (b["kind"], b["oilType"]) == ("oil", "differential")                                      # زيت قير بالاسم دفرنس
    assert x("زيت قير ATF", "زيت القير", "Gear Oil")["oilType"] == "gearbox"
    assert x("زيت دركسيون", "زيوت ومواد تشحيم أخرى", "Steering Oil")["oilType"] == "steering"
    assert x("إضافة محرك", "زيوت ومواد تشحيم أخرى", "Additive Oil")["kind"] == "normal"            # المضافات ليست زيتاً يُختار
    assert x("شحم", "زيوت ومواد تشحيم أخرى", "Grease")["kind"] == "normal"
    assert x("زيت مستهلك", "الزيت المستهلك", "Wasted Oil")["kind"] == "normal"
    f = x("فلتر مكيف", "الفلاتر", "AC Filters")
    assert (f["kind"], f["filterKind"]) == ("filter", "ac")
    assert x("فلتر", "الفلاتر", "Air Filters")["filterKind"] == "air"
    assert x("فلتر", "الفلاتر", "Oil Filters")["filterKind"] == "oil"
    assert x("معطر", "الفلاتر", "Air Freshener")["kind"] == "normal"                                 # فئة المنتج تحسم لا فئة نقطة البيع
    assert x("فلتر هواء", "الأدوات والإكسسوارات", "Air Filters")["kind"] == "filter"
    s = x("خدمة تغيير زيت دفرنس", "خدمة زيت الدفرنس", "Differential Oil Service")
    assert (s["kind"], s["oilType"]) == ("service", None)                                            # الخدمة ليست زيتاً
    assert x("بطاقة الهدايا", "زيت الفرامل", "All")["kind"] == "normal"                              # فئة نقطة البيع خاطئة
    assert x("زيت فرامل", "زيت الفرامل", "All")["kind"] == "oil"
    assert x("خدمة", "خدمات العناية بالسيارة", "All")["kind"] == "service"
    assert x("مادة", "", "Tools & Accessories")["category"] == "Tools & Accessories"                 # بلا فئة نقطة بيع: فئة المنتج
    assert x("مادة", "", "All")["category"] == "أخرى"


@pytest.mark.db
def test_sync_deactivates_products_missing_from_file(db_ready):
    from conftest import CO, run
    from app.core import db
    from app.modules.products import service
    CID = uuid.UUID(CO)

    async def go():
        async with db.pool().acquire() as c:
            await c.execute("TRUNCATE products RESTART IDENTITY CASCADE")
            await c.execute("INSERT INTO products (company_id, name, barcode, category) VALUES ($1,'قديم لن يظهر','900','ق'),($1,'باقٍ','901','ق')", CID)
        rows = [{"name": "باقٍ", "barcode": "901", "price_vat": "10", "category": "زيت المحرك", "product_category": "Engine Oil"},
                {"name": "جديد", "barcode": "902", "price_vat": "20", "category": "الفلاتر", "product_category": "Air Filters"}]
        plain = await service.import_products_rows(CO, rows)                      # بلا مزامنة: لا تعطيل
        assert plain["deactivated"] == 0
        async with db.pool().acquire() as c:
            assert await c.fetchval("SELECT is_active FROM products WHERE barcode='900'") is True
        r = await service.import_products_rows(CO, rows, sync=True)
        assert r["deactivated"] == 1 and not r["syncSkipped"]
        async with db.pool().acquire() as c:
            act = {x["barcode"]: x["is_active"] for x in await c.fetch("SELECT barcode, is_active FROM products")}
            cats = {x["barcode"]: x["category"] for x in await c.fetch("SELECT barcode, category FROM products WHERE is_active")}
        assert act == {"900": False, "901": True, "902": True}
        assert cats == {"901": "زيت المحرك", "902": "الفلاتر"}                    # الفئات الجديدة تُنشأ من الملف
        # صف فاشل = لا مزامنة (الملف قد يكون ناقصاً)
        bad = rows + [{"name": "سعر خاطئ", "barcode": "903", "price_vat": "abc", "category": "x"}]
        r2 = await service.import_products_rows(CO, bad, sync=True)
        assert r2["errorsTotal"] == 1 and r2["syncSkipped"] and r2["deactivated"] == 0
    run(go)
