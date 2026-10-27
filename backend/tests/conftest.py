# tests/conftest.py — إعداد الاختبارات.
# اختبارات العلامة db تحتاج قاعدة PostgreSQL فارغة مخصّصة للاختبار: TEST_DATABASE_URL (اسمها لازم يحتوي "test").
# يُعاد إنشاء مخطط public فيها من الصفر عند كل تشغيل — لا تشِر بها أبداً لقاعدة حقيقية.
import asyncio
import os
import sys
import uuid
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
TEST_DB = os.environ.get("TEST_DATABASE_URL", "")
if TEST_DB:
    os.environ["DATABASE_URL"] = TEST_DB     # قبل استيراد app.core.config

CO = str(uuid.UUID(int=1))


def pytest_collection_modifyitems(config, items):
    if TEST_DB:
        return
    skip = pytest.mark.skip(reason="TEST_DATABASE_URL غير معرّف")
    for it in items:
        if "db" in it.keywords:
            it.add_marker(skip)


@pytest.fixture(scope="session")
def db_ready():
    """يجهّز قاعدة الاختبار مرة واحدة (مخطط نظيف + المخطط الأدنى)"""
    if not TEST_DB:
        pytest.skip("TEST_DATABASE_URL غير معرّف")
    dbname = TEST_DB.rsplit("/", 1)[-1].split("?")[0]
    assert "test" in dbname, f"رفض: اسم قاعدة الاختبار «{dbname}» لازم يحتوي test"
    import asyncpg

    async def setup():
        c = await asyncpg.connect(TEST_DB)
        await c.execute("DROP SCHEMA public CASCADE; CREATE SCHEMA public; CREATE EXTENSION IF NOT EXISTS pgcrypto")
        await c.execute((Path(__file__).parent / "schema_min.sql").read_text(encoding="utf-8"))
        await c.close()
    asyncio.run(setup())
    return True


def run(coro_fn):
    """يشغّل coroutine مع pool جديد (event loop لكل اختبار) ثم يغلقه"""
    from app.core import db

    async def go():
        await db.init_pool()
        try:
            return await coro_fn()
        finally:
            await db.close_pool()
    return asyncio.run(go())


@pytest.fixture
def admin():
    from app.core.deps import CurrentUser
    return CurrentUser(user_id="1", company_id=CO, branch_id=None, email="a@x", full_name="admin", role="admin")
