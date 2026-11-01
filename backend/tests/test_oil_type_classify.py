# التصنيف الذكي لنوع الزيت من الاسم: قواعد الأولوية، الأرقام العربية، درجات اللزوجة، والمعاينة/التطبيق على القاعدة
import uuid

import httpx
import pytest

from app.modules.products.service import classify_oil_type as c


@pytest.mark.parametrize("text,expected", [
    ("زيت فرامل DOT 4", "brake"), ("Brake Fluid DOT3", "brake"),
    ("زيت دركسيون هيدروليك", "steering"), ("Power Steering Fluid", "steering"),
    ("زيت دبل ناقل حركة أمامي", "transfer"), ("Transfer Case Fluid", "transfer"),
    ("زيت دفرنس 80W-90 GL-5", "differential"), ("Differential Oil", "differential"),
    ("زيت قير أوتوماتيك ATF", "gearbox"), ("Gear Oil 75W-90", "gearbox"), ("CVT Fluid", "gearbox"),
    ("زيت ماكينة 5W-30", "engine"), ("Shell Helix 10W-40", "engine"), ("موبيل 1 0W-20", "engine"),
    ("زيت محرك ديزل 15W-40", "engine"),
    ("كاسترول زيت ماجينتك كلكس 5-30 فلتر 12*", "engine"), ("زيت 10/40 سينثتك", "engine"), ("زيت 20-50", "engine"), ("زيت 15W40", "engine"),
    ("شل هيلكس الترا", "engine"), ("زيت اي تي اف دكسرون", "gearbox"), ("زيت ATF Dexron VI", "gearbox"),
])
def test_rules(text, expected):
    assert c(text) == expected


def test_priority_specific_over_generic():
    assert c("زيت قير ودفرنس 75W-90 GL-5") == "differential"     # GL-5 يسبق «قير»
    assert c("زيت فرامل 5W-30") == "brake"                       # الأخص يسبق درجة اللزوجة
    assert c("زيت ماكينة دبل") == "transfer"                      # «دبل» أخص من «ماكينة»


def test_ambiguous_returns_none():
    assert c("زيت 75-90") is None and c("زيت 85-140") is None   # درجات قير/دفرنس بلا W
    assert c("زيت 75W-90") is None                               # درجة قير/دفرنس بلا كلمة تحدد النوع
    assert c("زيت عام") is None
    assert c("") is None


def test_arabic_letter_variants():
    assert c("زيت ماكينه") == "engine" and c("زيت الماكينة") == "engine"
    assert c("زيت أوتوماتيك") == "gearbox"


@pytest.mark.db
def test_preview_apply_and_redo(db_ready):
    from conftest import CO, run
    from app.core import db
    from app.main import app
    CID = uuid.UUID(CO)

    async def go():
        async with db.pool().acquire() as c:
            await c.execute("TRUNCATE products RESTART IDENTITY CASCADE")
            await c.execute("""INSERT INTO products (company_id, name, spec, is_oil, is_service, is_oil_filter, oil_type) VALUES
              ($1,'شل هيلكس','5W-30',true,false,false,NULL), ($1,'كاسترول','75W-90 GL-5 دفرنس',true,false,false,NULL),
              ($1,'زيت غامض','',true,false,false,NULL), ($1,'تغيير زيت قير',NULL,false,true,false,NULL),
              ($1,'فلتر زيت تويوتا',NULL,false,false,true,NULL), ($1,'زيت فرامل','DOT4',true,false,false,'engine')""", CID)
        from app.core.deps import get_current_user, CurrentUser  # noqa: F401
        from app.modules.products import service
        pre = await service.auto_classify_oil_types(CO, apply=False)
        assert not pre["applied"] and pre["scanned"] == 4 and pre["matched"] == 3 and pre["unmatched"] == 1
        assert {t["type"] for t in pre["byType"]} == {"engine", "differential", "gearbox"}
        gb = next(t for t in pre["byType"] if t["type"] == "gearbox")
        assert gb["services"] == 1 and gb["oils"] == 0                     # «تغيير زيت قير» خدمة
        async with db.pool().acquire() as c:                                # المعاينة لا تكتب
            assert await c.fetchval("SELECT count(*) FROM products WHERE oil_type IS NOT NULL") == 1
        done = await service.auto_classify_oil_types(CO, apply=True)
        assert done["applied"]
        async with db.pool().acquire() as c:
            got = {r["name"]: r["oil_type"] for r in await c.fetch("SELECT name, oil_type FROM products")}
        assert got["شل هيلكس"] == "engine" and got["كاسترول"] == "differential" and got["تغيير زيت قير"] == "gearbox"
        assert got["زيت غامض"] is None and got["فلتر زيت تويوتا"] is None   # الغامض والفلاتر لا تُمس
        assert got["زيت فرامل"] == "engine"                                 # المصنّف لا يُغيَّر بلا redo
        redo = await service.auto_classify_oil_types(CO, apply=True, redo=True)
        assert redo["matched"] >= 1
        async with db.pool().acquire() as c:
            assert await c.fetchval("SELECT oil_type FROM products WHERE name='زيت فرامل'") == "brake"
    run(go)
