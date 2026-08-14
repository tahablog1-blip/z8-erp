# core/db.py — اتصال PostgreSQL عبر asyncpg
# ملاحظة معمارية مهمة: asyncpg بيستخدم نفس صيغة $1, $2 بتاعة مكتبة pg في Node،
# فاستعلامات النظام القديم بتتنقل هنا بالحرف الواحد بدون أي إعادة كتابة.
import asyncpg
import json
from .config import settings

_pool: asyncpg.Pool | None = None

async def _init_conn(conn: asyncpg.Connection):
    # jsonb (زي عمود صلاحيات المستخدم) يرجع dict/list جاهز بدل نص
    await conn.set_type_codec("jsonb", encoder=json.dumps, decoder=json.loads, schema="pg_catalog")
    await conn.set_type_codec("json",  encoder=json.dumps, decoder=json.loads, schema="pg_catalog")

async def init_pool():
    global _pool
    _pool = await asyncpg.create_pool(
        dsn=settings.DATABASE_URL, min_size=2, max_size=20,
        command_timeout=30, init=_init_conn,
    )
    return _pool

async def close_pool():
    if _pool:
        await _pool.close()

def pool() -> asyncpg.Pool:
    assert _pool is not None, "قاعدة البيانات لم تُهيأ — تأكد من إقلاع التطبيق عبر main.py"
    return _pool

# ── واجهة مبسطة موازية لـ query() في النظام القديم ──
async def fetch(sql: str, *args):
    """صفوف متعددة كقائمة dicts"""
    rows = await pool().fetch(sql, *args)
    return [dict(r) for r in rows]

async def fetchrow(sql: str, *args):
    """صف واحد أو None"""
    row = await pool().fetchrow(sql, *args)
    return dict(row) if row else None

async def execute(sql: str, *args) -> str:
    return await pool().execute(sql, *args)

def transaction():
    """للاستخدام: async with transaction() as conn: — نفس دور getClient()+BEGIN/COMMIT"""
    return pool().acquire()
