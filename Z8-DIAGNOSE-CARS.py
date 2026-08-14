# -*- coding: utf-8 -*-
# Z8-DIAGNOSE-CARS.py — تشخيص ذاتي حاسم لمشكلة "سجلت سيارة وما ظهرتش"
# بيتشغل على جهازك بنفس بيئة الباك اند وبيكتب تقرير كامل في Z8-DIAGNOSIS.txt
# ما بيغيّرش أي بيانات نهائياً — أي إدخال تجريبي بيتلغي بـ ROLLBACK مضمون.
import asyncio, os, sys, traceback
from datetime import datetime

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
HERE = os.path.dirname(os.path.abspath(__file__))
REPORT = os.path.join(HERE, "Z8-DIAGNOSIS.txt")
lines = []

def log(s=""):
    print(s)
    lines.append(str(s))

# ── قراءة DATABASE_URL من backend/.env بنفس منطق الباك اند ──
def read_db_url():
    env_path = os.path.join(HERE, "backend", ".env")
    url = "postgresql://postgres:123456@localhost:5432/z8_car_manager"  # نفس افتراضي config.py
    if os.path.exists(env_path):
        for raw in open(env_path, encoding="utf-8", errors="replace"):
            raw = raw.strip()
            if raw.startswith("DATABASE_URL="):
                url = raw.split("=", 1)[1].strip().strip('"').strip("'")
    return url

# الأعمدة اللي INSERT التسجيل بيكتب فيها بالظبط (من create_car)
INSERT_COLS = ["company_id","branch_id","plate","plate_type","name","model_year","brand",
               "car_category","cylinders","color","chassis_number","customer_name",
               "customer_phone","customer_id","station","odometer_current",
               "odometer_previous","notes","registrar_name","created_by"]

async def main():
    log(f"═══ تشخيص Z8 — {datetime.now():%Y-%m-%d %H:%M:%S} ═══")

    # 0) نسخ الملفات المركّبة فعلاً
    log("\n─── [0] هل ملفات v4 متركبة فعلاً؟ ───")
    checks = [
        (os.path.join(HERE, "backend", "app", "main.py"), "تحصين جذري", "main.py فيه التحصين الذاتي"),
        (os.path.join(HERE, "backend", "app", "modules", "cars", "api.py"), "سيارة اتسجلت", "api.py فيه التشخيص الذاتي"),
    ]
    for path, marker, label in checks:
        if not os.path.exists(path):
            log(f"❌ الملف مش موجود أصلاً: {path}")
        else:
            ok = marker in open(path, encoding="utf-8", errors="replace").read()
            log(f"{'✅' if ok else '❌ نسخة قديمة!'} {label} — {path}")

    url = read_db_url()
    safe_url = url.split("@")[-1] if "@" in url else url
    log(f"\n─── [1] الاتصال بقاعدة البيانات: {safe_url} ───")
    import asyncpg
    try:
        conn = await asyncpg.connect(dsn=url, timeout=10)
        db = await conn.fetchval("SELECT current_database()")
        log(f"✅ متصل — قاعدة البيانات الفعلية: {db}")
    except Exception as e:
        log(f"❌ فشل الاتصال: {type(e).__name__}: {e}")
        log("⇒ الباك اند بيتكلم مع قاعدة تانية أو الخدمة واقفة — دي المشكلة كلها.")
        return

    try:
        # 2) الشركات والمستخدمين والفروع — كشف عدم التطابق
        log("\n─── [2] الشركات والمستخدم والفروع (كشف عدم تطابق company_id) ───")
        for r in await conn.fetch("SELECT id, name FROM companies ORDER BY created_at"):
            log(f"شركة: {r['id']} — {r['name']}")
        for r in await conn.fetch("SELECT email, role, company_id, branch_id FROM users ORDER BY created_at LIMIT 10"):
            log(f"مستخدم: {r['email']} | دور={r['role']} | شركة={r['company_id']} | فرع={r['branch_id']}")
        for r in await conn.fetch("SELECT id, name, company_id, is_active, is_frozen FROM branches ORDER BY name"):
            log(f"فرع: {r['name']} | id={r['id']} | شركة={r['company_id']} | نشط={r['is_active']} | مجمّد={r['is_frozen']}")

        # 3) أعمدة جدول cars الفعلية مقابل المطلوبة
        log("\n─── [3] أعمدة جدول cars الفعلية ───")
        cols = {r["column_name"] for r in await conn.fetch(
            "SELECT column_name FROM information_schema.columns WHERE table_name='cars'")}
        if not cols:
            log("❌ جدول cars مش موجود خالص!")
        else:
            missing = [c for c in INSERT_COLS if c not in cols]
            log(f"عدد الأعمدة: {len(cols)}")
            log(f"{'✅ كل أعمدة التسجيل موجودة' if not missing else '❌ أعمدة ناقصة: ' + ', '.join(missing)}")

        # 4) محتوى الجدول فعلياً — هل التسجيلات بتتكتب في مكان تاني؟
        log("\n─── [4] آخر 10 سيارات في الجدول (بأي شركة وأي فرع) ───")
        rows = await conn.fetch(
            """SELECT c.plate, c.customer_name, c.company_id, c.branch_id,
                      COALESCE(c.is_deleted, FALSE) AS is_deleted, c.exited_at, c.created_at,
                      b.name AS branch_name
               FROM cars c LEFT JOIN branches b ON b.id=c.branch_id
               ORDER BY c.created_at DESC LIMIT 10""")
        if not rows:
            log("⚠ الجدول فاضي تماماً — يعني التسجيل بيفشل قبل الكتابة (شوف [5])")
        for r in rows:
            log(f"لوحة={r['plate']} | عميل={r['customer_name']} | شركة={r['company_id']} | "
                f"فرع={r['branch_name'] or r['branch_id']} | محذوفة={r['is_deleted']} | "
                f"خرجت={r['exited_at']} | سُجلت={r['created_at']:%m-%d %H:%M}")

        # 5) الاختبار الحاسم: نفس INSERT التسجيل بالحرف — مع ROLLBACK مضمون
        log("\n─── [5] محاكاة التسجيل الفعلي (بتتلغي فوراً — صفر أثر) ───")
        comp = await conn.fetchval("SELECT id FROM companies ORDER BY created_at LIMIT 1")
        br = await conn.fetchval("SELECT id FROM branches WHERE company_id=$1 LIMIT 1", comp)
        if not br:
            log("❌ مفيش أي فرع تابع لأول شركة — التسجيل مستحيل ينجح. أنشئ فرعاً من شاشة الفروع.")
        else:
            tr = conn.transaction()
            await tr.start()
            try:
                row = await conn.fetchrow(
                    """INSERT INTO cars
                         (company_id, branch_id, plate, plate_type, name, model_year, brand, car_category,
                          cylinders, color, chassis_number, customer_name, customer_phone, customer_id,
                          station, odometer_current, odometer_previous, notes, registrar_name, created_by)
                       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
                       RETURNING id, plate""",
                    comp, br, "TEST 9999", "saudi", None, None, None, None,
                    None, None, None, "عميل تجريبي", "0500000000", None,
                    None, None, None, None, "تشخيص ذاتي", None)
                log(f"✅✅ INSERT نجح تماماً (id={row['id']}) — يعني قاعدة البيانات سليمة")
                log("⇒ لو التسجيل من الواجهة لسه فاشل، المشكلة في الطلب نفسه مش القاعدة —")
                log("   افتح المتصفح F12 → تبويب Network → سجّل سيارة → دوس على سطر cars الأحمر → ابعت الرد")
            except Exception as e:
                log(f"❌❌ INSERT فشل — دي المشكلة الحقيقية بالحرف:")
                log(f"   {type(e).__name__}: {e}")
            finally:
                await tr.rollback()
                log("(اتلغى الإدخال التجريبي — صفر أثر)")

        # 6) هل فيه قاعدة بيانات تانية شبيهة على نفس السيرفر؟ (لغم النسختين)
        log("\n─── [6] قواعد بيانات شبيهة على نفس PostgreSQL ───")
        for r in await conn.fetch(
            "SELECT datname FROM pg_database WHERE datname ILIKE '%z8%' OR datname ILIKE '%car%'"):
            mark = " ← دي اللي متصلين بيها" if r["datname"] == db else ""
            log(f"قاعدة: {r['datname']}{mark}")
        log("⚠ لو فيه قاعدتين، اتأكد إن backend\\.env بيشاور على الصح")

    finally:
        await conn.close()

try:
    asyncio.run(main())
except Exception:
    log("❌ خطأ غير متوقع في التشخيص نفسه:")
    log(traceback.format_exc())

open(REPORT, "w", encoding="utf-8").write("\n".join(lines))
print(f"\n═══ التقرير اتحفظ في: {REPORT} ═══")
print("ابعت الملف ده زي ما هو — فيه الإجابة الحاسمة")
