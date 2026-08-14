# -*- coding: utf-8 -*-
# Z8-FIX-NOW.py — إصلاح فوري لبق "بتتسجل وما تظهرش" على مستوى البيانات مباشرة.
# بيصلّح قيم NULL اللي بتطرد السيارات من الاستعلامات + بيثبّت الافتراضيات نهائياً.
# ما بيحتاجش إعادة تشغيل — النتيجة بتظهر في تحديث الشاشة التلقائي التالي.
import asyncio, os, sys
from datetime import datetime

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
HERE = os.path.dirname(os.path.abspath(__file__))
REPORT = os.path.join(HERE, "Z8-FIX-REPORT.txt")
lines = []
def log(s=""):
    print(s); lines.append(str(s))

def read_db_url():
    env_path = os.path.join(HERE, "backend", ".env")
    url = "postgresql://postgres:123456@localhost:5432/z8_car_manager"
    if os.path.exists(env_path):
        for raw in open(env_path, encoding="utf-8", errors="replace"):
            raw = raw.strip()
            if raw.startswith("DATABASE_URL="):
                url = raw.split("=", 1)[1].strip().strip('"').strip("'")
    return url

FIXES = [
    ("تطبيع is_deleted: كل NULL تبقى FALSE (ده جذر الاختفاء)",
     "UPDATE cars SET is_deleted = FALSE WHERE is_deleted IS NULL"),
    ("افتراضي دائم لـ is_deleted",
     "ALTER TABLE cars ALTER COLUMN is_deleted SET DEFAULT FALSE"),
    ("منع الـ NULL نهائياً في is_deleted",
     "ALTER TABLE cars ALTER COLUMN is_deleted SET NOT NULL"),
    ("تطبيع created_at الفاضي",
     "UPDATE cars SET created_at = now() WHERE created_at IS NULL"),
    ("افتراضي دائم لـ created_at",
     "ALTER TABLE cars ALTER COLUMN created_at SET DEFAULT now()"),
    ("منع الـ NULL في created_at",
     "ALTER TABLE cars ALTER COLUMN created_at SET NOT NULL"),
    ("تطبيع work_status الفاضي",
     "UPDATE cars SET work_status = 'ready' WHERE work_status IS NULL"),
]

async def main():
    log(f"═══ إصلاح Z8 الفوري — {datetime.now():%Y-%m-%d %H:%M:%S} ═══")
    import asyncpg
    conn = await asyncpg.connect(dsn=read_db_url(), timeout=10)
    try:
        # ── قبل ──
        null_del = await conn.fetchval("SELECT COUNT(*) FROM cars WHERE is_deleted IS NULL")
        total    = await conn.fetchval("SELECT COUNT(*) FROM cars")
        log(f"\nقبل الإصلاح: إجمالي السيارات={total} | مختفية بسبب is_deleted=NULL: {null_del}")

        # ── الإصلاح ──
        log("\n─── تنفيذ الإصلاحات ───")
        for label, sql in FIXES:
            try:
                r = await conn.execute(sql)
                log(f"✅ {label} — {r}")
            except Exception as e:
                log(f"⚠ {label}: {type(e).__name__}: {e}")

        # ── بعد: نفس استعلام قائمة الانتظار بالحرف ──
        log("\n─── السيارات الظاهرة دلوقتي في قائمة الانتظار (نفس استعلام الشاشة) ───")
        rows = await conn.fetch(
            """SELECT c.plate, c.customer_name, c.created_at, b.name AS branch
               FROM cars c LEFT JOIN branches b ON b.id = c.branch_id
               WHERE COALESCE(c.is_deleted, FALSE) = FALSE AND c.exited_at IS NULL
               ORDER BY c.created_at DESC LIMIT 15""")
        if not rows:
            log("⚠ لسه مفيش سيارات نشطة — سجّل سيارة جديدة دلوقتي وهتظهر")
        for r in rows:
            log(f"✅ {r['plate']} | {r['customer_name']} | فرع={r['branch']} | {r['created_at']:%m-%d %H:%M}")
        log(f"\nالنتيجة: {len(rows)} سيارة ظاهرة")
        log("افتح شاشة خط الخدمة — التحديث التلقائي كل 10 ثواني هيعرضهم لوحده (أو اعمل ريفريش)")
    finally:
        await conn.close()

try:
    asyncio.run(main())
except Exception as e:
    log(f"❌ {type(e).__name__}: {e}")

open(REPORT, "w", encoding="utf-8").write("\n".join(lines))
print(f"\nالتقرير: {REPORT}")
