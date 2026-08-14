# -*- coding: utf-8 -*-
# Z8-TEST-API.py — الاختبار الحاسم: بيسجّل سيارة حقيقية بنفس طريق المتصفح بالحرف
# مرة على الباك اند مباشرة (4001) ومرة عبر بوابة الواجهة (3000/api) — الفرق بينهم بيحدد الطبقة الفاشلة.
# بيستخدم مكتبات بايثون الأساسية بس — بيشتغل على أي بايثون من غير تثبيت أي حاجة.
import json, os, sys, urllib.request, urllib.error
from datetime import datetime

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
HERE = os.path.dirname(os.path.abspath(__file__))
REPORT = os.path.join(HERE, "Z8-API-TEST.txt")
lines = []
def log(s=""):
    print(s); lines.append(str(s))

EMAIL, PASSWORD = "admin@z8.com", "mypassword123456"

def call(base, path, method="GET", body=None, token=None, timeout=15):
    """نداء HTTP بسيط — بيرجع (status, json_or_text) ومستحيل يرمي استثناء"""
    req = urllib.request.Request(base + path, method=method)
    req.add_header("Content-Type", "application/json")
    if token:
        req.add_header("Authorization", f"Bearer {token}")
    data = json.dumps(body).encode() if body is not None else None
    try:
        with urllib.request.urlopen(req, data=data, timeout=timeout) as r:
            txt = r.read().decode("utf-8", "replace")
            try: return r.status, json.loads(txt)
            except Exception: return r.status, txt[:500]
    except urllib.error.HTTPError as e:
        txt = e.read().decode("utf-8", "replace")
        try: return e.code, json.loads(txt)
        except Exception: return e.code, txt[:500]
    except Exception as e:
        return None, f"{type(e).__name__}: {e}"

def test_layer(name, base):
    log(f"\n═══ {name} — {base} ═══")
    st, r = call(base, "/api/auth/login", "POST", {"email": EMAIL, "password": PASSWORD})
    if st != 200:
        log(f"❌ تسجيل الدخول فشل: status={st} — {r}")
        if st is None:
            log("⇒ الخدمة دي مش شغالة أو البورت مقفول — دي الطبقة الفاشلة غالباً")
        return None
    token = r["token"]
    log(f"✅ دخول ناجح — المستخدم: {r['user'].get('email')} | فرع={r['user'].get('branchId')}")

    st, br = call(base, "/api/branches", token=token)
    if st != 200 or not br:
        log(f"❌ قائمة الفروع فشلت أو فاضية: status={st} — {br}")
        log("⇒ لو الفروع فاضية، المودال بيبعت فرع فاضي والتسجيل بيترفض — دي المشكلة")
        return None
    branch_id = br[0]["id"]
    log(f"✅ الفروع: {len(br)} — هنستخدم: {br[0]['name']}")

    plate_no = datetime.now().strftime("%M%S")
    body = {
        "branchId": branch_id, "plateLetters": "TST", "plateNumbers": plate_no,
        "plateType": "saudi", "name": "اختبار", "brand": "تجربة",
        "customerName": "عميل اختبار الأداة", "customerPhone": "0500000000",
        "odometerCurrent": 12345,
    }
    st, car = call(base, "/api/cars", "POST", body, token=token)
    if st != 201:
        log(f"❌❌ تسجيل السيارة فشل: status={st}")
        log(f"   الرد بالحرف: {car}")
        log("⇒ دي رسالة الفشل الحقيقية اللي المتصفح بيشوفها — ابعتها زي ما هي")
        return None
    car_id = car.get("id")
    log(f"✅✅ سيارة اتسجلت فعلاً: لوحة {car.get('plate')} — id={car_id}")

    st, cars = call(base, "/api/cars?activeOnly=true", token=token)
    if st == 200 and any(c.get("id") == car_id for c in (cars if isinstance(cars, list) else [])):
        log(f"✅✅✅ والسيارة ظاهرة في القائمة ({len(cars)} سيارة) — الطريق ده سليم 100%")
    else:
        log(f"⚠ السيارة اتسجلت بس مش ظاهرة في القائمة: status={st}, عدد={len(cars) if isinstance(cars, list) else cars}")
    return car_id

log(f"═══ اختبار Z8 API — {datetime.now():%Y-%m-%d %H:%M:%S} ═══")
log("بيسجّل سيارة اختبار حقيقية (لوحة TST) — تقدر تحذفها بعدين من شاشة خط الخدمة")

direct = test_layer("الطبقة 1: الباك اند مباشرة (اللي المفروض يشتغل دايماً)", "http://localhost:4001")
proxy  = test_layer("الطبقة 2: عبر بوابة الواجهة (نفس طريق المتصفح بالحرف)", "http://localhost:3000")

log("\n═══════════ الخلاصة ═══════════")
if direct and proxy:
    log("الطريقين شغالين ✅ — يبقى المشكلة في متصفحك نفسه:")
    log("1) جلسة قديمة: اعمل تسجيل خروج ثم دخول من جديد")
    log("2) كاش المتصفح: Ctrl+Shift+R — أو جرّب متصفح تاني/نافذة خفية")
    log("3) افتح خط الخدمة دلوقتي — هتلاقي سيارتين لوحة TST اتسجلوا من الاختبار ده")
elif direct and not proxy:
    log("الباك اند سليم ✅ لكن بوابة الواجهة (3000) هي الفاشلة ❌")
    log("⇒ المشكلة في Next.js: امسح مجلد .next كاملاً وأعد تشغيل الواجهة")
elif not direct:
    log("الباك اند نفسه بيرفض ❌ — رسالة الفشل فوق هي السبب الحقيقي بالحرف")
log("\nابعت الملف Z8-API-TEST.txt زي ما هو")

open(REPORT, "w", encoding="utf-8").write("\n".join(lines))
print(f"\nالتقرير: {REPORT}")
