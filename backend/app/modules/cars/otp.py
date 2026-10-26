# modules/cars/otp.py — التحقق برمز OTP لشاشة الحجز العامة (جوال عبر واتساب أو إيميل عبر SMTP)
#
# التصميم:
#   - الرمز 6 أرقام، صالح 5 دقايق، بيتخزّن مُجزَّأ (HMAC) مش نص صريح.
#   - حدود: 3 إرسالات/10 دقايق لكل جهة اتصال + فاصل 45 ثانية + 20 إرسال/ساعة لكل IP
#     + 5 محاولات خاطئة وبعدها الرمز بيتبطّل.
#   - بعد التحقق بيرجع توكن حجز (JWT موقّع بمفتاح منفصل عن توكنات الموظفين)، العميل بيحفظه
#     على جهازه فمايحتاجش رمز جديد كل مرة.
#   - لو الشركة ما ضبطتش واتساب ولا SMTP: التحقق بيتعطّل تلقائياً (otp_enabled=False)
#     والحجز يشتغل بالطريقة القديمة، بدل ما العملاء يتحبسوا بره.
import hashlib
import hmac
import re
import secrets
import time
from collections import defaultdict, deque

import jwt
from fastapi import HTTPException

from ...core import wa
from ...core.config import settings
from ...core.db import execute, fetch, fetchrow
from ...core.email import send_email

OTP_TTL_SECONDS = 300
RESEND_COOLDOWN_SECONDS = 45
MAX_SENDS_PER_WINDOW = 3          # لكل جهة اتصال خلال 10 دقايق
MAX_VERIFY_ATTEMPTS = 5
MAX_SENDS_PER_IP_HOUR = 20
TOKEN_TTL_DAYS = 30

_EMAIL_RE = re.compile(r"^[^@\s]{1,64}@[^@\s]+\.[^@\s]{2,}$")
_ip_hits: dict[str, deque] = defaultdict(deque)


def normalize_phone(raw: str | None) -> str | None:
    """يطبّع لصيغة 05xxxxxxxx — أو None لو مش جوال سعودي صالح"""
    p = re.sub(r"\D", "", raw or "")
    if p.startswith("966") and len(p) == 12:
        p = "0" + p[3:]
    elif p.startswith("5") and len(p) == 9:
        p = "0" + p
    return p if re.fullmatch(r"05\d{8}", p) else None


def normalize_email(raw: str | None) -> str | None:
    e = (raw or "").strip().lower()
    return e if _EMAIL_RE.match(e) else None


def phone_variants(phone: str) -> list[str]:
    """العملاء القدام ممكن يكون جوالهم متخزّن بأكتر من صيغة"""
    return [phone, phone[1:], "966" + phone[1:]]


def _hash_code(code: str, target: str) -> str:
    return hmac.new(settings.JWT_SECRET.encode(), f"otp:{target}:{code}".encode(), hashlib.sha256).hexdigest()


def _token_key() -> str:
    return settings.JWT_SECRET + ":booking"


async def channels(company_id: str) -> dict:
    """القنوات المتاحة فعلياً حسب إعدادات الشركة"""
    if wa.gateway_enabled():     # البوابة المحلية: القناة متاحة بس لو الرقم مربوط فعلاً
        phone_ok = (await wa.gateway_status()).get("state") == "ready"
    else:
        row = await fetchrow("SELECT wa_instance, wa_token FROM companies WHERE id=$1", company_id)
        phone_ok = bool(row and (row["wa_instance"] or "").strip() and (row["wa_token"] or "").strip())
    cfg = {r["key"].removeprefix("email."): r["value"] for r in await fetch(
        "SELECT key, value FROM company_settings WHERE company_id=$1 AND key LIKE 'email.%'", company_id)}
    email_ok = cfg.get("enabled") == "1" and bool(cfg.get("smtpHost")) and bool(cfg.get("fromAddress") or cfg.get("smtpUser"))
    return {"phone": phone_ok, "email": email_ok}


async def otp_enabled(company_id: str) -> bool:
    ch = await channels(company_id)
    return ch["phone"] or ch["email"]


def _check_ip(ip: str | None):
    key = ip or "unknown"
    now = time.time()
    q = _ip_hits[key]
    while q and now - q[0] > 3600:
        q.popleft()
    if len(q) >= MAX_SENDS_PER_IP_HOUR:
        raise HTTPException(429, "محاولات كتير — حاول مرة أخرى بعد قليل")
    q.append(now)


def _parse_target(channel: str, value: str) -> str:
    if channel == "phone":
        t = normalize_phone(value)
        if not t:
            raise HTTPException(422, "أدخل رقم جوال صحيح يبدأ بـ 05")
        return t
    if channel == "email":
        t = normalize_email(value)
        if not t:
            raise HTTPException(422, "أدخل بريد إلكتروني صحيح")
        return t
    raise HTTPException(422, "قناة التحقق غير معروفة")


def _mask(channel: str, target: str) -> str:
    if channel == "phone":
        return target[:3] + "•••••" + target[-2:]
    name, _, dom = target.partition("@")
    return name[:2] + "•••@" + dom


async def send_otp(branch_id: str, channel: str, value: str, ip: str | None) -> dict:
    br = await fetchrow("SELECT company_id, name, is_frozen FROM branches WHERE id=$1", branch_id)
    if not br or br["is_frozen"]:
        raise HTTPException(404, "الفرع غير متاح للحجز حالياً")
    company_id = str(br["company_id"])
    avail = await channels(company_id)
    if not avail.get(channel):
        raise HTTPException(503, "هذه الطريقة غير متاحة حالياً — جرّب الطريقة الأخرى")
    target = _parse_target(channel, value)
    _check_ip(ip)

    recent = await fetch(
        """SELECT created_at FROM booking_otps
           WHERE company_id=$1 AND channel=$2 AND target=$3 AND created_at > now() - interval '10 minutes'
           ORDER BY created_at DESC""", company_id, channel, target)
    if len(recent) >= MAX_SENDS_PER_WINDOW:
        raise HTTPException(429, "وصلت للحد الأقصى من الرموز — حاول بعد 10 دقايق")
    if recent:
        age = time.time() - recent[0]["created_at"].timestamp()
        if age < RESEND_COOLDOWN_SECONDS:
            raise HTTPException(429, f"انتظر {int(RESEND_COOLDOWN_SECONDS - age) + 1} ثانية قبل إعادة الإرسال")

    code = f"{secrets.randbelow(1_000_000):06d}"
    await execute(
        """INSERT INTO booking_otps (company_id, channel, target, code_hash, expires_at)
           VALUES ($1,$2,$3,$4, now() + make_interval(secs => $5))""",
        company_id, channel, target, _hash_code(code, target), float(OTP_TTL_SECONDS))

    brand = br["name"] or "مصدر الزيوت"
    if channel == "phone":
        sent = await wa.send_text(
            company_id, target,
            f"رمز التحقق الخاص بك في {brand}: {code}\nصالح لمدة 5 دقائق. لا تشاركه مع أي شخص.")
    else:
        sent = await send_email(
            company_id, target, f"رمز التحقق — {brand}",
            f"رمز التحقق الخاص بك: {code}\n\nصالح لمدة 5 دقائق. لا تشاركه مع أي شخص.\n"
            f"لو ما طلبت هذا الرمز تجاهل الرسالة.")
    if not sent:
        # الرمز اتسجّل بس ما وصلش — نبطّله ونقول للعميل بوضوح
        await execute("UPDATE booking_otps SET used=TRUE WHERE company_id=$1 AND channel=$2 AND target=$3 AND used=FALSE",
                      company_id, channel, target)
        raise HTTPException(502, "تعذّر إرسال الرمز — تأكد من البيانات أو جرّب الطريقة الأخرى")
    return {"sent": True, "to": _mask(channel, target),
            "expiresIn": OTP_TTL_SECONDS, "resendIn": RESEND_COOLDOWN_SECONDS}


async def verify_otp(branch_id: str, channel: str, value: str, code: str) -> dict:
    br = await fetchrow("SELECT company_id FROM branches WHERE id=$1", branch_id)
    if not br:
        raise HTTPException(404, "الفرع غير موجود")
    company_id = str(br["company_id"])
    target = _parse_target(channel, value)
    code = re.sub(r"\D", "", code or "")
    if len(code) != 6:
        raise HTTPException(422, "أدخل الرمز المكوّن من 6 أرقام")

    row = await fetchrow(
        """SELECT id, code_hash, attempts FROM booking_otps
           WHERE company_id=$1 AND channel=$2 AND target=$3 AND used=FALSE AND expires_at > now()
           ORDER BY created_at DESC LIMIT 1""", company_id, channel, target)
    if not row:
        raise HTTPException(400, "الرمز منتهي أو غير صحيح — اطلب رمز جديد")
    if row["attempts"] >= MAX_VERIFY_ATTEMPTS:
        raise HTTPException(429, "محاولات خاطئة كتير — اطلب رمز جديد")
    if not hmac.compare_digest(row["code_hash"], _hash_code(code, target)):
        await execute("UPDATE booking_otps SET attempts = attempts + 1 WHERE id=$1", row["id"])
        raise HTTPException(400, "الرمز غير صحيح")
    await execute("UPDATE booking_otps SET used=TRUE WHERE id=$1", row["id"])

    now = int(time.time())
    token = jwt.encode(
        {"typ": "booking", "cid": company_id, "ch": channel, "sub": target,
         "iat": now, "exp": now + TOKEN_TTL_DAYS * 86400},
        _token_key(), algorithm="HS256")
    return {"verified": True, "token": token, "channel": channel, "target": target}


def read_token(token: str | None, company_id: str) -> dict:
    """يفك توكن الحجز ويتأكد إنه لنفس الشركة — 401 لو ناقص/منتهي"""
    if not token:
        raise HTTPException(401, "لازم تتحقق من هويتك أولاً")
    try:
        c = jwt.decode(token, _token_key(), algorithms=["HS256"])
    except jwt.PyJWTError:
        raise HTTPException(401, "انتهت صلاحية التحقق — أعد التحقق برمز جديد")
    if c.get("typ") != "booking" or c.get("cid") != str(company_id):
        raise HTTPException(401, "التحقق غير صالح لهذا الفرع")
    return c


async def customer_for_claims(company_id: str, claims: dict) -> dict | None:
    """العميل المسجّل المرتبط بالجهة اللي اتحقق منها (جوال أو إيميل)"""
    if claims["ch"] == "phone":
        return await fetchrow(
            "SELECT id, name, phone, email FROM customers WHERE company_id=$1 AND phone = ANY($2::text[]) LIMIT 1",
            company_id, phone_variants(claims["sub"]))
    return await fetchrow(
        "SELECT id, name, phone, email FROM customers WHERE company_id=$1 AND lower(email)=$2 LIMIT 1",
        company_id, claims["sub"])
