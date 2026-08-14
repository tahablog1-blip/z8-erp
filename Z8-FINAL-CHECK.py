# -*- coding: utf-8 -*-
# Z8-FINAL-CHECK.py — يسجّل سيارة عبر API الحقيقي ويطارد الصف في كل قاعدة محتملة
# لحد ما يلاقي القاعدة اللي الباك اند بيكتب فيها فعلاً — وبيصلّح الـNULL فيها فوراً.
import asyncio, json, os, sys, urllib.request, urllib.error
from datetime import datetime

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
HERE = os.path.dirname(os.path.abspath(__file__))
REPORT = os.path.join(HERE, "Z8-FINAL-REPORT.txt")
lines = []
def log(s=""):
    print(s); lines.append(str(s))

EMAIL, PASSWORD = "admin@z8.com", "mypassword123456"

def call(base, path, method="GET", body=None, token=None, timeout=15):
    req = urllib.request.Request(base + path, method=method)
    req.add_header("Content-Type", "application/json")
    if token: req.add_header("Authorization", f"Bearer {token}")
    data = json.dumps(body).encode() if body is not None else None
    try:
        with urllib.request.urlopen(req, data=data, timeout=timeout) as r:
            return r.status, json.loads(r.read().decode("utf-8", "replace"))
    except urllib.error.HTTPError as e:
        try: return e.code, json.loads(e.read().decode("utf-8", "replace"))
        except Exception: return e.code, {}
    except Exception as e:
        return None, f"{type(e).__name__}: {e}"

def env_file_url():
    p = os.path.join(HERE, "backend", ".env")
    url = None
    if os.path.exists(p):
        for raw in open(p, encoding="utf-8", errors="replace"):
            raw = raw.strip()
            if raw.startswith("DATABASE_URL="):
                url = raw.split("=", 1)[1].strip().strip('"').strip("'")
    return url

FIXES = [
    "UPDATE cars SET is_deleted = FALSE WHERE is_deleted IS NULL",
    "ALTER TABLE cars ALTER COLUMN is_deleted SET DEFAULT FALSE",
    "ALTER TABLE cars ALTER COLUMN is_deleted SET NOT NULL",
    "UPDATE cars SET created_at = now() WHERE created_at IS NULL",
    "ALTER TABLE cars ALTER COLUMN created_at SET DEFAULT now()",
    "ALTER TABLE cars ALTER COLUMN created_at SET NOT NULL",
]

async def hunt_and_fix(car_id: str):
    import asyncpg
    file_url = env_file_url()
    env_url = os.environ.get("DATABASE_URL")
    log(f"\n─── مصادر الاتصال ───")
    log(f".env: {file_url or 'غير موجود — هيستخدم الافتراضي'}")
    log(f"متغير بيئة ويندوز DATABASE_URL: {env_url or 'غير مضبوط في جلستي (ممكن يكون مضبوط لجلسة الباك اند)'}")

    # كل عناوين الاتصال المرشحة
    candidates = []
    for u in (env_url, file_url, "postgresql://postgres:123456@localhost:5432/z8_car_manager"):
        if u and u not in candidates:
            candidates.append(u)
    # نفس السيرفرات بس منافذ تانية شائعة
    extra = []
    for u in list(candidates):
        for port_pair in ((":5432/", ":5433/"), (":5433/", ":5432/")):
            if port_pair[0] in u:
                v = u.replace(*port_pair)
                if v not in candidates and v not in extra: extra.append(v)
    candidates += extra

    found_dsn = None
    for dsn in candidates:
        server = dsn.split("@")[-1]
        try:
            conn = await asyncpg.connect(dsn=dsn, timeout=6)
        except Exception as e:
            log(f"— {server}: مش متاح ({type(e).__name__})")
            continue
        try:
            # فتّش في كل قاعدة z8/car على السيرفر ده
            dbs = [r["datname"] for r in await conn.fetch(
                "SELECT datname FROM pg_database WHERE datname ILIKE '%z8%' OR datname ILIKE '%car%'")]
            await conn.close()
            base = dsn.rsplit("/", 1)[0]
            for db in dbs:
                try:
                    c2 = await asyncpg.connect(dsn=f"{base}/{db}", timeout=6)
                except Exception:
                    continue
                try:
                    hit = await c2.fetchval("SELECT COUNT(*) FROM cars WHERE id=$1::uuid", car_id)
                except Exception:
                    hit = 0
                if hit:
                    log(f"🎯🎯 لقيتها! الباك اند بيكتب في: {server.rsplit('/',1)[0]}/{db}")
                    found_dsn = f"{base}/{db}"
                    # ── الإصلاح فوراً على القاعدة الحقيقية ──
                    log("─── إصلاح الـNULL على القاعدة الحقيقية ───")
                    for sql in FIXES:
                        try:
                            r = await c2.execute(sql); log(f"✅ {sql.split(' WHERE')[0][:60]} — {r}")
                        except Exception as e:
                            log(f"⚠ {type(e).__name__}: {e}")
                    rows = await c2.fetch(
                        """SELECT plate, customer_name FROM cars
                           WHERE COALESCE(is_deleted,FALSE)=FALSE AND exited_at IS NULL
                           ORDER BY created_at DESC LIMIT 10""")
                    log(f"─── السيارات النشطة الظاهرة دلوقتي ({len(rows)}) ───")
                    for r in rows: log(f"✅ {r['plate']} | {r['customer_name']}")
                await c2.close()
                if found_dsn: return found_dsn
        except Exception as e:
            log(f"— {server}: {type(e).__name__}: {e}")
    return found_dsn

async def main():
    log(f"═══ الفحص النهائي — {datetime.now():%Y-%m-%d %H:%M:%S} ═══")
    st, r = call("http://localhost:4001", "/api/auth/login", "POST",
                 {"email": EMAIL, "password": PASSWORD})
    if st != 200:
        log(f"❌ الباك اند مش شغال أو الدخول فشل: {st} — {r}")
        log("⇒ شغّل START-Z8.bat الأول وبعدين أعد تشغيل الأداة دي")
        return
    token = r["token"]
    stb, br = call("http://localhost:4001", "/api/branches", token=token)
    branch_id = br[0]["id"]
    plate_no = datetime.now().strftime("%M%S")
    st, car = call("http://localhost:4001", "/api/cars", "POST",
                   {"branchId": branch_id, "plateLetters": "FNL", "plateNumbers": plate_no,
                    "customerName": "فحص نهائي", "customerPhone": "0500000001"}, token=token)
    if st != 201:
        log(f"❌ التسجيل عبر API فشل: {st} — {car}")
        return
    car_id = car["id"]
    log(f"✅ سيارة اتسجلت عبر API: FNL {plate_no} — id={car_id}")
    log("دلوقتي بطاردها في كل قاعدة بيانات محتملة...")

    found = await hunt_and_fix(car_id)
    log("\n═══════════ الخلاصة ═══════════")
    if found:
        safe = found.split("@")[-1]
        log(f"القاعدة الحقيقية: {safe} — واتصلحت ✅")
        env_file = env_file_url() or "(الافتراضي)"
        if safe not in env_file:
            log(f"⚠ ملف backend\\.env بيشاور على قاعدة مختلفة ({env_file.split('@')[-1] if '@' in env_file else env_file})")
            log("⇒ ده معناه متغير بيئة ويندوز DATABASE_URL متضبط — الأفضل توحيدهم لاحقاً، بس النظام هيشتغل دلوقتي")
        log("افتح شاشة خط الخدمة — السيارات هتظهر خلال 10 ثواني")
    else:
        log("❌ السيارة اتسجلت بـ201 ومش موجودة في أي قاعدة اتفحصت — ابعت التقرير ده فوراً")

try:
    asyncio.run(main())
except Exception as e:
    import traceback; log(traceback.format_exc())

open(REPORT, "w", encoding="utf-8").write("\n".join(lines))
print(f"\nالتقرير: {REPORT}")
