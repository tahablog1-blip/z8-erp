# modules/terminal/service.py — تابلت الكاشير
# التدفق: الجهاز يُدخل رمزاً من 9 أرقام → (رمز الكاشير) بطاقات كاشيري الفرع ثم رمز الكاشير الخاص → توكن مستخدم عادي مقيَّد بنطاق pos،
#         أو (رموز الأقسام) توكن مقيَّد بنطاقه يعمل باسم مستخدم يحدّده المدير. كل الصلاحيات الحالية تبقى سارية.
import hashlib
import hmac
import re
import secrets
import time

import jwt
from fastapi import HTTPException

from ...core.config import settings
from ...core.db import execute, fetch, fetchrow
from ...core.security import create_token, hash_password, verify_password

KINDS = ("cashier", "service_notes", "cars", "workorder")
KIND_LABEL = {"cashier": "كاشير", "service_notes": "ملاحظات الخدمة", "cars": "تسجيل السيارات", "workorder": "أمر عمل"}
KIND_SCOPE = {"cashier": "pos", "service_notes": "service_notes", "cars": "cars", "workorder": "workorder"}
# صلاحية أي مفتاح منها تكفي ليصلح المستخدم لهذا القسم
KIND_PERMS = {
    "cashier": ("invoices.create", "invoices.create_direct", "invoices.create_service"),
    "service_notes": ("service_notes.view", "service_notes.create", "service_notes.manage"),
    "cars": ("cars.create", "cars.confirm_entry", "cars.confirm_exit"),
    "workorder": ("invoices.prepare",),
}
DEVICE_TOKEN_DAYS = 30
TABLET_SESSION_HOURS = 12
PIN_MAX_FAILS, PIN_LOCK_MINUTES = 5, 5
CODE_RE = re.compile(r"^\d{9}$")
PIN_RE = re.compile(r"^\d{4,8}$")

# ── تحديد المحاولات الفاشلة (في الذاكرة: عملية واحدة) — بالـ IP وبمفتاح الجهاز ──
_FAILS: dict[str, list[float]] = {}
_WINDOW, _LIMIT = 600, 8


def _throttle_check(*keys: str) -> None:
    now = time.time()
    for k in keys:
        _FAILS[k] = [t for t in _FAILS.get(k, []) if now - t < _WINDOW]
        if len(_FAILS[k]) >= _LIMIT:
            raise HTTPException(429, "محاولات كثيرة خاطئة — انتظر بضع دقائق ثم حاول مجدداً")


def _throttle_fail(*keys: str) -> None:
    now = time.time()
    for k in keys:
        _FAILS.setdefault(k, []).append(now)


def code_hash(code: str) -> str:
    return hmac.new(settings.JWT_SECRET.encode(), ("z8-pos-code:" + code).encode(), hashlib.sha256).hexdigest()


def generate_code() -> str:
    while True:
        c = "".join(secrets.choice("0123456789") for _ in range(9))
        if len(set(c)) >= 4 and c not in "0123456789" and c != c[::-1]:      # لا أرقام متكررة أو متسلسلة أو متناظرة
            return c


# ══════════════════ توكن الجهاز ══════════════════

def _device_token(device_id: str, company_id: str, branch_id: str) -> str:
    now = int(time.time())
    return jwt.encode({"purpose": "terminal-device", "dev": device_id, "co": company_id, "br": branch_id,
                       "iat": now, "exp": now + DEVICE_TOKEN_DAYS * 86400}, settings.JWT_SECRET, algorithm="HS256")


async def _device_from_token(device_token: str) -> dict:
    try:
        p = jwt.decode(device_token, settings.JWT_SECRET, algorithms=["HS256"])
    except jwt.PyJWTError:
        raise HTTPException(401, "انتهى تفعيل هذا الجهاز — أدخل رمز التفعيل من جديد")
    if p.get("purpose") != "terminal-device":
        raise HTTPException(401, "رمز جهاز غير صالح")
    row = await fetchrow("SELECT * FROM pos_devices WHERE id=$1 AND company_id=$2", p["dev"], p["co"])
    if not row or row["revoked_at"] is not None:
        raise HTTPException(403, "هذا الجهاز موقوف — تواصل مع الإدارة")
    await execute("UPDATE pos_devices SET last_seen_at=now() WHERE id=$1 AND last_seen_at < now() - interval '1 minute'", row["id"])
    return dict(row)


# ══════════════════ الكاشيرون ══════════════════

async def list_cashiers(company_id: str, branch_id: str) -> list[dict]:
    rows = await fetch(
        """SELECT id, full_name, (pos_pin_hash IS NOT NULL) AS has_pin
           FROM users
           WHERE company_id=$1 AND branch_id=$2 AND is_active=TRUE AND permissions ?| $3::text[]
           ORDER BY full_name""",
        company_id, branch_id, list(KIND_PERMS["cashier"]))
    return [{"id": str(r["id"]), "fullName": r["full_name"], "hasPin": r["has_pin"]} for r in rows]


async def _open_user_session(user_row, device: dict, ip: str | None, kind: str) -> str:
    sess = await fetchrow(
        """INSERT INTO user_sessions (user_id, company_id, device_label, ip, pos_device_id) VALUES ($1,$2,$3,$4,$5) RETURNING id""",
        user_row["id"], user_row["company_id"], f"تابلت: {device.get('name') or 'جهاز'} — {KIND_LABEL[kind]}", ip, device["id"])
    return create_token(str(user_row["id"]), TABLET_SESSION_HOURS, session_id=str(sess["id"]),
                        extra={"dev": str(device["id"]), "scope": KIND_SCOPE[kind]})


def _user_payload(r) -> dict:
    perms = r["permissions"] if isinstance(r["permissions"], list) else []
    return {"id": str(r["id"]), "email": r["email"], "fullName": r["full_name"], "role": r["role"],
            "companyId": str(r["company_id"]), "branchId": str(r["branch_id"]) if r["branch_id"] else None, "permissions": perms}


# ══════════════════ الدخول بالرمز ══════════════════

async def enter(code: str, device_key: str, device_name: str | None, ip: str | None) -> dict:
    code = (code or "").strip()
    device_key = (device_key or "").strip()[:80]
    if not CODE_RE.match(code) or len(device_key) < 8:
        raise HTTPException(400, "أدخل رمزاً من 9 أرقام")
    tk = ("ip:" + (ip or "?"), "dev:" + device_key)
    _throttle_check(*tk)
    ac = await fetchrow("SELECT * FROM pos_access_codes WHERE code_hash=$1", code_hash(code))
    if not ac:
        _throttle_fail(*tk)
        raise HTTPException(401, "الرمز غير صحيح")
    branch = await fetchrow("SELECT id, name FROM branches WHERE id=$1 AND company_id=$2 AND is_active=TRUE", ac["branch_id"], ac["company_id"])
    if not branch:
        raise HTTPException(403, "الفرع غير فعّال")

    dev = await fetchrow(
        """INSERT INTO pos_devices (company_id, branch_id, device_key, name) VALUES ($1,$2,$3,$4)
           ON CONFLICT (company_id, device_key) DO UPDATE SET branch_id=EXCLUDED.branch_id, name=COALESCE(EXCLUDED.name, pos_devices.name), last_seen_at=now()
           RETURNING *""", ac["company_id"], ac["branch_id"], device_key, (device_name or "")[:60] or None)
    if dev["revoked_at"] is not None:
        raise HTTPException(403, "هذا الجهاز موقوف — تواصل مع الإدارة")
    company_id, branch_id, kind = str(ac["company_id"]), str(ac["branch_id"]), ac["kind"]
    out = {"kind": kind, "kindLabel": KIND_LABEL[kind], "branch": {"id": branch_id, "name": branch["name"]},
           "deviceToken": _device_token(str(dev["id"]), company_id, branch_id), "deviceId": str(dev["id"])}
    if kind == "cashier":
        out["cashiers"] = await list_cashiers(company_id, branch_id)
        return out
    # أقسام بلا كاشير: تعمل باسم مستخدم حدّده المدير
    if not ac["acts_as_user_id"]:
        raise HTTPException(409, "لم يُربط هذا الرمز بمستخدم — اطلب من المدير ضبطه من الإعدادات")
    u = await fetchrow("""SELECT id, company_id, branch_id, email, full_name, role, permissions, is_active FROM users
                          WHERE id=$1 AND company_id=$2""", ac["acts_as_user_id"], ac["company_id"])
    if not u or not u["is_active"]:
        raise HTTPException(403, "المستخدم المرتبط بهذا الرمز معطّل")
    out["token"] = await _open_user_session(u, dev, ip, kind)
    out["user"] = _user_payload(u)
    return out


async def cashiers_for_device(device_token: str) -> dict:
    dev = await _device_from_token(device_token)
    ac = await fetchrow("SELECT 1 FROM pos_access_codes WHERE branch_id=$1 AND kind='cashier'", dev["branch_id"])
    if not ac:
        raise HTTPException(409, "لا يوجد رمز كاشير لهذا الفرع")
    br = await fetchrow("SELECT id, name FROM branches WHERE id=$1", dev["branch_id"])
    return {"branch": {"id": str(br["id"]), "name": br["name"]}, "cashiers": await list_cashiers(str(dev["company_id"]), str(dev["branch_id"]))}


async def cashier_login(device_token: str, user_id: str, pin: str, ip: str | None) -> dict:
    dev = await _device_from_token(device_token)
    tk = ("ip:" + (ip or "?"), "dev:" + str(dev["id"]))
    _throttle_check(*tk)
    u = await fetchrow(
        """SELECT id, company_id, branch_id, email, full_name, role, permissions, is_active, pos_pin_hash, pos_pin_failed, pos_pin_locked_until,
                  (pos_pin_locked_until IS NOT NULL AND pos_pin_locked_until > now()) AS locked
           FROM users WHERE id=$1 AND company_id=$2 AND branch_id=$3 AND is_active=TRUE AND permissions ?| $4::text[]""",
        user_id, dev["company_id"], dev["branch_id"], list(KIND_PERMS["cashier"]))
    if not u:
        _throttle_fail(*tk)
        raise HTTPException(404, "الكاشير غير موجود في هذا الفرع")
    if not u["pos_pin_hash"]:
        raise HTTPException(403, "لم يُضبط رمز لهذا الكاشير — اطلب من المدير ضبطه")
    if u["locked"]:
        raise HTTPException(429, f"الحساب مقفل مؤقتاً بسبب محاولات خاطئة — حاول بعد {PIN_LOCK_MINUTES} دقائق")
    if not PIN_RE.match(pin or "") or not verify_password(pin, u["pos_pin_hash"]):
        fails = (u["pos_pin_failed"] or 0) + 1
        if fails >= PIN_MAX_FAILS:
            await execute("UPDATE users SET pos_pin_failed=0, pos_pin_locked_until=now() + ($2 || ' minutes')::interval WHERE id=$1", u["id"], str(PIN_LOCK_MINUTES))
        else:
            await execute("UPDATE users SET pos_pin_failed=$2 WHERE id=$1", u["id"], fails)
        _throttle_fail(*tk)
        raise HTTPException(401, "الرمز غير صحيح")
    await execute("UPDATE users SET pos_pin_failed=0, pos_pin_locked_until=NULL, last_login_at=now() WHERE id=$1", u["id"])
    token = await _open_user_session(u, dev, ip, "cashier")
    return {"token": token, "user": _user_payload(u), "deviceId": str(dev["id"])}


# ══════════════════ إدارة المدير (من إعدادات النظام) ══════════════════

async def admin_overview(company_id: str) -> dict:
    branches = await fetch("SELECT id, name FROM branches WHERE company_id=$1 AND is_active=TRUE ORDER BY name", company_id)
    codes = await fetch("""SELECT c.branch_id, c.kind, c.rotated_at, c.acts_as_user_id, u.full_name AS acts_as_name
                           FROM pos_access_codes c LEFT JOIN users u ON u.id=c.acts_as_user_id WHERE c.company_id=$1""", company_id)
    by = {(str(c["branch_id"]), c["kind"]): c for c in codes}
    users = await fetch("SELECT id, full_name, branch_id, role, permissions FROM users WHERE company_id=$1 AND is_active=TRUE ORDER BY full_name", company_id)

    def candidates(kind: str, branch_id: str) -> list[dict]:
        """مستخدمون يصلحون ليعمل القسم باسمهم: يملكون صلاحية القسم (أو مدير) وفرعهم هذا الفرع أو بلا فرع"""
        out = []
        for u in users:
            if u["branch_id"] is not None and str(u["branch_id"]) != branch_id:
                continue
            perms = u["permissions"] if isinstance(u["permissions"], list) else []
            if u["role"] == "admin" or any(p in perms for p in KIND_PERMS[kind]):
                out.append({"id": str(u["id"]), "fullName": u["full_name"]})
        return out
    out = []
    for b in branches:
        items = []
        for k in KINDS:
            c = by.get((str(b["id"]), k))
            items.append({"kind": k, "label": KIND_LABEL[k], "hasCode": bool(c), "rotatedAt": c["rotated_at"] if c else None,
                          "actsAsUserId": str(c["acts_as_user_id"]) if c and c["acts_as_user_id"] else None,
                          "actsAsName": c["acts_as_name"] if c else None})
        bid = str(b["id"])
        out.append({"branchId": bid, "branchName": b["name"], "codes": items,
                    "cashiers": await list_cashiers(company_id, bid),
                    "candidates": {k: candidates(k, bid) for k in KINDS if k != "cashier"}})
    return {"branches": out}


async def admin_set_code(company_id: str, branch_id: str, kind: str, acts_as_user_id: str | None) -> dict:
    if kind not in KINDS:
        raise HTTPException(400, "نوع الرمز غير معروف")
    if not await fetchrow("SELECT 1 FROM branches WHERE id=$1 AND company_id=$2", branch_id, company_id):
        raise HTTPException(404, "الفرع غير موجود")
    if kind != "cashier":
        if not acts_as_user_id:
            raise HTTPException(422, "اختر المستخدم الذي يعمل هذا القسم باسمه")
        u = await fetchrow("SELECT id, is_active, permissions, role FROM users WHERE id=$1 AND company_id=$2", acts_as_user_id, company_id)
        if not u or not u["is_active"]:
            raise HTTPException(404, "المستخدم غير موجود أو معطّل")
        perms = u["permissions"] if isinstance(u["permissions"], list) else []
        if u["role"] != "admin" and not any(p in perms for p in KIND_PERMS[kind]):
            raise HTTPException(422, "هذا المستخدم لا يملك صلاحية هذا القسم")
    else:
        acts_as_user_id = None
    for _ in range(20):
        code = generate_code()
        try:
            await execute(
                """INSERT INTO pos_access_codes (company_id, branch_id, kind, code_hash, acts_as_user_id) VALUES ($1,$2,$3,$4,$5)
                   ON CONFLICT (branch_id, kind) DO UPDATE SET code_hash=EXCLUDED.code_hash, acts_as_user_id=EXCLUDED.acts_as_user_id, rotated_at=now()""",
                company_id, branch_id, kind, code_hash(code), acts_as_user_id)
            return {"kind": kind, "code": code}          # يظهر هذه المرة فقط
        except Exception as e:                           # تصادم نادر في code_hash الفريد
            if "code_hash" not in str(e):
                raise
    raise HTTPException(500, "تعذّر توليد رمز فريد — حاول مجدداً")


async def admin_delete_code(company_id: str, branch_id: str, kind: str) -> None:
    await execute("DELETE FROM pos_access_codes WHERE company_id=$1 AND branch_id=$2 AND kind=$3", company_id, branch_id, kind)


async def admin_set_pin(company_id: str, user_id: str, pin: str) -> None:
    if not PIN_RE.match(pin or ""):
        raise HTTPException(422, "الرمز من 4 إلى 8 أرقام")
    r = await fetchrow("SELECT id FROM users WHERE id=$1 AND company_id=$2", user_id, company_id)
    if not r:
        raise HTTPException(404, "المستخدم غير موجود")
    await execute("UPDATE users SET pos_pin_hash=$2, pos_pin_failed=0, pos_pin_locked_until=NULL WHERE id=$1", user_id, hash_password(pin))


async def admin_devices(company_id: str) -> list[dict]:
    rows = await fetch("""SELECT d.id, d.name, d.created_at, d.last_seen_at, d.revoked_at, b.name AS branch_name
                          FROM pos_devices d JOIN branches b ON b.id=d.branch_id WHERE d.company_id=$1 ORDER BY d.last_seen_at DESC""", company_id)
    return [{"id": str(r["id"]), "name": r["name"] or "جهاز", "branchName": r["branch_name"], "createdAt": r["created_at"],
             "lastSeenAt": r["last_seen_at"], "revoked": r["revoked_at"] is not None} for r in rows]


async def admin_revoke_device(company_id: str, device_id: str, revoke: bool = True) -> None:
    await execute("UPDATE pos_devices SET revoked_at=CASE WHEN $3 THEN now() ELSE NULL END WHERE id=$1 AND company_id=$2", device_id, company_id, revoke)
    if revoke:        # أنهِ كل جلسات هذا الجهاز فوراً
        await execute("UPDATE user_sessions SET revoked_at=now() WHERE revoked_at IS NULL AND company_id=$1 AND pos_device_id=$2", company_id, device_id)
