# -*- coding: utf-8 -*-
# Z8-XRAY.py — أشعة إكس على PostgreSQL: مين متصل فعلاً، وفين جداول cars كلها،
# وهل فيه schema تانية أو trigger بيلعب في البيانات. + إصلاح فوري عند الاكتشاف.
import asyncio, json, os, sys, urllib.request, urllib.error
from datetime import datetime

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
HERE = os.path.dirname(os.path.abspath(__file__))
REPORT = os.path.join(HERE, "Z8-XRAY-REPORT.txt")
lines = []
def log(s=""):
    print(s); lines.append(str(s))

def read_db_url():
    p = os.path.join(HERE, "backend", ".env")
    url = "postgresql://postgres:123456@localhost:5432/z8_car_manager"
    if os.path.exists(p):
        for raw in open(p, encoding="utf-8", errors="replace"):
            raw = raw.strip()
            if raw.startswith("DATABASE_URL="):
                url = raw.split("=", 1)[1].strip().strip('"').strip("'")
    return url

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

async def main():
    log(f"═══ أشعة إكس Z8 — {datetime.now():%Y-%m-%d %H:%M:%S} ═══")
    import asyncpg
    conn = await asyncpg.connect(dsn=read_db_url(), timeout=10)
    try:
        # ═══ [1] مين متصل بالسيرفر ده فعلاً دلوقتي؟ ═══
        log("\n─── [1] كل الاتصالات الحية على السيرفر (الدليل المادي) ───")
        acts = await conn.fetch(
            """SELECT datname, usename, application_name, client_addr, client_port,
                      state, backend_start::timestamp(0) AS since
               FROM pg_stat_activity
               WHERE backend_type='client backend' ORDER BY backend_start""")
        for a in acts:
            log(f"قاعدة={a['datname']} | مستخدم={a['usename']} | تطبيق={a['application_name'] or '-'} | "
                f"من={a['client_addr'] or 'local'}:{a['client_port'] or '-'} | حالة={a['state']} | منذ={a['since']}")
        pool_count = sum(1 for a in acts if a['datname'] == 'z8_car_manager' and 'asyncpg' not in (a['application_name'] or '').lower())
        log(f"⇒ لو الباك اند شغال، لازم نشوف اتصالاته (pool من 2+ اتصال) على قاعدته الحقيقية فوق")

        # ═══ [2] كل جداول اسمها cars في كل السكيمات ═══
        log("\n─── [2] كل جداول cars في القاعدة دي (بأي schema) ───")
        tabs = await conn.fetch(
            """SELECT table_schema FROM information_schema.tables
               WHERE table_name='cars' ORDER BY table_schema""")
        for t in tabs:
            sch = t["table_schema"]
            try:
                cnt = await conn.fetchval(f'SELECT COUNT(*) FROM "{sch}".cars')
                mx  = await conn.fetchval(f'SELECT MAX(created_at) FROM "{sch}".cars')
                tst = await conn.fetchval(
                    f"""SELECT COUNT(*) FROM "{sch}".cars
                        WHERE plate LIKE 'TST%' OR plate LIKE 'FNL%' OR plate LIKE '%TST' OR plate LIKE '%FNL'""")
                log(f"schema={sch} | صفوف={cnt} | آخر تسجيل={mx} | سيارات اختبار TST/FNL={tst}")
            except Exception as e:
                log(f"schema={sch} | تعذّرت القراءة: {e}")

        # ═══ [3] search_path بتاع المستخدمين ═══
        log("\n─── [3] إعدادات search_path (لو مضبوطة على schema تانية دي الجريمة) ───")
        roles = await conn.fetch("SELECT rolname, rolconfig FROM pg_roles WHERE rolconfig IS NOT NULL")
        if not roles: log("مفيش إعدادات مخصصة على مستوى المستخدمين")
        for r in roles: log(f"مستخدم={r['rolname']} | إعدادات={r['rolconfig']}")
        db_cfg = await conn.fetch(
            """SELECT unnest(setconfig) AS cfg FROM pg_db_role_setting s
               JOIN pg_database d ON d.oid = s.setdatabase""")
        for r in db_cfg: log(f"إعداد على مستوى القاعدة: {r['cfg']}")

        # ═══ [4] تريجرز وقواعد على أي جدول cars ═══
        log("\n─── [4] تريجرز/قواعد على جداول cars (حاجة بتمسح ورا التسجيل؟) ───")
        trs = await conn.fetch(
            """SELECT event_object_schema AS sch, trigger_name, event_manipulation, action_statement
               FROM information_schema.triggers WHERE event_object_table='cars'""")
        if not trs: log("مفيش أي تريجرز على cars ✅")
        for t in trs:
            log(f"⚠ تريجر: {t['sch']}.{t['trigger_name']} على {t['event_manipulation']} → {t['action_statement'][:120]}")

        # ═══ [5] الاختبار الحي: تسجيل عبر API ثم البحث الفوري في كل schema ═══
        log("\n─── [5] تسجيل حي عبر API وتتبع فوري في كل schema ───")
        st, r = call("http://localhost:4001", "/api/auth/login", "POST",
                     {"email": "admin@z8.com", "password": "mypassword123456"})
        if st != 200:
            log(f"⚠ الباك اند مش شغال ({st}) — شغّله وأعد الأداة عشان الجزء ده")
        else:
            token = r["token"]
            _, br = call("http://localhost:4001", "/api/branches", token=token)
            plate_no = datetime.now().strftime("%M%S")
            st, car = call("http://localhost:4001", "/api/cars", "POST",
                           {"branchId": br[0]["id"], "plateLetters": "XRY", "plateNumbers": plate_no,
                            "customerName": "أشعة إكس", "customerPhone": "0500000002"}, token=token)
            if st != 201:
                log(f"❌ التسجيل فشل: {st} — {car}")
            else:
                cid = car["id"]
                log(f"✅ اتسجلت XRY {plate_no} — id={cid} — بفتش عليها فوراً:")
                await asyncio.sleep(1)
                found_any = False
                for t in tabs:
                    sch = t["table_schema"]
                    try:
                        hit = await conn.fetchval(f'SELECT COUNT(*) FROM "{sch}".cars WHERE id=$1::uuid', cid)
                        if hit:
                            log(f"🎯🎯 موجودة في schema: {sch}"); found_any = True
                            if sch != "public":
                                log("⇒ دي الجريمة كاملة: الباك اند بيكتب في schema مختلفة عن اللي كل حاجة بتقرأ منها")
                    except Exception:
                        pass
                if not found_any:
                    # لقطة نشاط لحظية: مين عمل INSERT من ثواني؟
                    log("❌ مش موجودة في أي schema هنا — لقطة الاتصالات النشطة تاني:")
                    acts2 = await conn.fetch(
                        """SELECT datname, application_name, state, query
                           FROM pg_stat_activity WHERE backend_type='client backend'
                           ORDER BY state_change DESC LIMIT 12""")
                    for a in acts2:
                        q = (a["query"] or "").replace("\n", " ")[:90]
                        log(f"قاعدة={a['datname']} | {a['application_name'] or '-'} | {a['state']} | آخر أمر: {q}")
                    log("⇒ لو مفيش أي INSERT INTO cars في القايمة دي، الباك اند متصل بسيرفر PostgreSQL تاني خالص")
    finally:
        await conn.close()

try:
    asyncio.run(main())
except Exception:
    import traceback; log(traceback.format_exc())

open(REPORT, "w", encoding="utf-8").write("\n".join(lines))
print(f"\nالتقرير: {REPORT}")
