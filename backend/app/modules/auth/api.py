# modules/auth/api.py — تسجيل الدخول والهوية
# عقد الرد مطابق حرفياً للنظام القديم: {token, user:{id, email, fullName, ...}}
# عشان أي واجهة قديمة أو جديدة تشتغل على أي باك اند من الاتنين.
import json
import secrets
from datetime import datetime, timezone
import pyotp
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, EmailStr
from ...core.db import fetchrow, execute
from ...core.security import verify_password, hash_password, create_token, create_totp_pending_token, decode_token
from ...core.deps import get_current_user, require_permission, CurrentUser
from ...core.permissions import PERMISSIONS, ALL_KEYS
from ..settings import service as settings_service

router = APIRouter()

class LoginBody(BaseModel):
    email: EmailStr
    password: str


def _client_ip(request: Request) -> str | None:
    fwd = request.headers.get("x-forwarded-for")
    if fwd:
        return fwd.split(",")[0].strip()
    return request.client.host if request.client else None


def _device_label(request: Request) -> str:
    """تبسيط User-Agent لاسم جهاز مقروء — بلا أي مكتبة خارجية جديدة."""
    ua = request.headers.get("user-agent", "") or ""
    os_name = ("Windows" if "Windows" in ua else "macOS" if "Macintosh" in ua
               else "Android" if "Android" in ua else "iPhone" if "iPhone" in ua
               else "iPad" if "iPad" in ua else "Linux" if "Linux" in ua else "جهاز غير معروف")
    browser = ("Edge" if "Edg/" in ua else "Chrome" if "Chrome/" in ua
               else "Firefox" if "Firefox/" in ua else "Safari" if "Safari/" in ua else "")
    return f"{os_name} — {browser}".strip(" —") or "جهاز غير معروف"


async def _start_session(row, sys: dict, request: Request) -> tuple[str, str | None]:
    """ينشئ صف جلسة (شاشة الأجهزة النشطة) ويُرجع (token, landingPath)."""
    is_admin = row["role"] == "admin"
    sess = await fetchrow(
        """INSERT INTO user_sessions (user_id, company_id, device_label, ip)
           VALUES ($1,$2,$3,$4) RETURNING id""",
        row["id"], row["company_id"], _device_label(request), _client_ip(request))
    token = create_token(row["id"], sys["sessionHours"] or None, session_id=str(sess["id"]))
    landing_path = (sys["landingAdmin"] if is_admin else sys["landingEmployee"]) or None
    return token, landing_path

def _user_payload(row_or_user) -> dict:
    if isinstance(row_or_user, CurrentUser):
        u = row_or_user
        return {"id": u.user_id, "email": u.email, "fullName": u.full_name,
                "role": u.role, "companyId": u.company_id,
                "branchId": u.branch_id, "permissions": u.permissions}
    r = row_or_user
    perms = r["permissions"] if isinstance(r["permissions"], list) else []
    return {"id": str(r["id"]), "email": r["email"], "fullName": r["full_name"],
            "role": r["role"], "companyId": str(r["company_id"]),
            "branchId": str(r["branch_id"]) if r["branch_id"] else None,
            "permissions": perms}

@router.post("/login")
async def login(body: LoginBody, request: Request):
    if len(body.password) < 6:
        raise HTTPException(400, "البريد أو كلمة المرور غير صالحة الصيغة")
    row = await fetchrow(
        """SELECT id, company_id, branch_id, email, password_hash, full_name,
                  role, permissions, is_active, failed_login_count, locked_until, totp_enabled
           FROM users WHERE email = $1""",
        body.email.lower().strip(),
    )
    if not row:
        raise HTTPException(401, "البريد الإلكتروني أو كلمة المرور غير صحيحة")
    if not row["is_active"]:
        raise HTTPException(403, "هذا الحساب معطّل، تواصل مع الإدارة")

    company_id = str(row["company_id"])
    is_admin = row["role"] == "admin"
    # قراءة واحدة لإعدادات النظام — وضع الصيانة / القفل المؤقت / مدة الجلسة (إعدادات 9، 11، 14)
    sys = await settings_service.get_system_settings(company_id)

    # وضع الصيانة — لا يحجب حساب admin أبداً
    if not is_admin and sys["maintenanceMode"]:
        raise HTTPException(503, "النظام تحت الصيانة حالياً — حاول مرة أخرى بعد قليل")

    # قفل مؤقت بعد محاولات دخول فاشلة متكررة — لا يُطبَّق على admin أبداً
    if not is_admin and row["locked_until"] and row["locked_until"] > datetime.now(timezone.utc):
        raise HTTPException(423, "الحساب مقفل مؤقتاً بسبب محاولات دخول فاشلة متكررة — حاول بعد قليل")

    if not verify_password(body.password, row["password_hash"]):
        if not is_admin and sys["maxLoginAttempts"] > 0:
            new_count = (row["failed_login_count"] or 0) + 1
            if new_count >= sys["maxLoginAttempts"]:
                await execute(
                    "UPDATE users SET failed_login_count=0, locked_until = now() + ($1 || ' minutes')::interval WHERE id=$2",
                    str(sys["lockoutMinutes"]), row["id"])
            else:
                await execute("UPDATE users SET failed_login_count=$1 WHERE id=$2", new_count, row["id"])
        raise HTTPException(401, "البريد الإلكتروني أو كلمة المرور غير صحيحة")

    await execute(
        "UPDATE users SET last_login_at = now(), failed_login_count=0, locked_until=NULL WHERE id = $1",
        row["id"])

    # مصادقة ثنائية مفعّلة؟ — نوقف هنا بتوكن مؤقت (5 دقايق)، التوكن الحقيقي بعد تأكيد الكود
    if row["totp_enabled"]:
        return {"requiresTotp": True, "tempToken": create_totp_pending_token(row["id"])}

    token, landing_path = await _start_session(row, sys, request)
    # وجهة ما بعد الدخول المخصّصة (إعداد 8) — فاضية/None لو الإدارة ما ضبطتش شيء،
    # والواجهة عندها سلوك اكتشاف تلقائي احتياطي لو المسار ده غير متاح لصلاحيات المستخدم
    return {"token": token, "user": _user_payload(row), "landingPath": landing_path}


class Verify2faLoginBody(BaseModel):
    tempToken: str
    code: str   # كود من تطبيق المصادقة (6 أرقام) أو كود استرجاع احتياطي


@router.post("/2fa/verify-login")
async def verify_2fa_login(body: Verify2faLoginBody, request: Request):
    """الخطوة الثانية من تسجيل الدخول لمستخدم فعّل المصادقة الثنائية."""
    import jwt as _pyjwt
    try:
        payload = decode_token(body.tempToken)
    except _pyjwt.ExpiredSignatureError:
        raise HTTPException(401, "انتهت صلاحية خطوة التحقق — سجّل الدخول من جديد")
    except _pyjwt.PyJWTError:
        raise HTTPException(401, "جلسة تحقق غير صالحة")
    if payload.get("purpose") != "2fa_pending":
        raise HTTPException(401, "جلسة تحقق غير صالحة")

    row = await fetchrow(
        """SELECT id, company_id, branch_id, email, full_name, role, permissions,
                  is_active, totp_secret, totp_backup_codes
           FROM users WHERE id = $1""",
        payload.get("userId"))
    if not row or not row["is_active"]:
        raise HTTPException(401, "الحساب غير موجود أو معطّل")

    code = body.code.strip().replace(" ", "")
    ok = bool(row["totp_secret"]) and pyotp.TOTP(row["totp_secret"]).verify(code, valid_window=1)
    if not ok:
        # جرّب كأكواد استرجاع احتياطية (تُستهلك مرة واحدة)
        codes: list[str] = row["totp_backup_codes"] or []
        remaining = [c for c in codes if not verify_password(code, c)]
        if len(remaining) < len(codes):
            ok = True
            await execute("UPDATE users SET totp_backup_codes=$1::jsonb WHERE id=$2",
                          json.dumps(remaining), row["id"])
    if not ok:
        raise HTTPException(401, "كود التحقق غير صحيح")

    company_id = str(row["company_id"])
    sys = await settings_service.get_system_settings(company_id)
    await execute(
        "UPDATE users SET last_login_at = now(), failed_login_count=0, locked_until=NULL WHERE id = $1",
        row["id"])
    token, landing_path = await _start_session(row, sys, request)
    return {"token": token, "user": _user_payload(row), "landingPath": landing_path}

@router.get("/me")
async def me(user: CurrentUser = Depends(get_current_user)):
    """هوية الجلسة الحالية — الواجهة بتستخدمها لاستعادة الدخول بعد ريفريش"""
    return {"user": _user_payload(user)}

@router.get("/permissions-catalog")
async def permissions_catalog(user: CurrentUser = Depends(get_current_user)):
    """كتالوج الصلاحيات — شاشة إدارة الموظفين بتبني شبكة الاختيارات منه"""
    return {"groups": PERMISSIONS, "allKeys": ALL_KEYS}


class WaSettingsIn(BaseModel):
    waInstance: str = ""
    waToken: str = ""


@router.get("/wa-settings")
async def get_wa(user: CurrentUser = Depends(require_permission("settings.company"))):
    from ...core.db import fetchrow
    row = await fetchrow("SELECT wa_instance, wa_token FROM companies WHERE id=$1", user.company_id)
    return {"waInstance": (row and row["wa_instance"]) or "",
            "waToken": (row and row["wa_token"]) or ""}


@router.put("/wa-settings")
async def set_wa(body: WaSettingsIn,
                 user: CurrentUser = Depends(require_permission("settings.company"))):
    from ...core.db import execute
    await execute("UPDATE companies SET wa_instance=$1, wa_token=$2 WHERE id=$3",
                  body.waInstance.strip() or None, body.waToken.strip() or None, user.company_id)
    print(f"📲 إعداد واتساب اتحدّث — بواسطة {user.email}")
    return {"ok": True}


# ══════════════════ المصادقة الثنائية (2FA) — إعداد كل مستخدم لحسابه ══════════════════

@router.get("/2fa/status")
async def totp_status(user: CurrentUser = Depends(get_current_user)):
    row = await fetchrow("SELECT totp_enabled, totp_backup_codes FROM users WHERE id=$1", user.user_id)
    return {"enabled": bool(row and row["totp_enabled"]),
            "backupCodesLeft": len(row["totp_backup_codes"] or []) if row else 0}


@router.post("/2fa/setup")
async def totp_setup(user: CurrentUser = Depends(get_current_user)):
    """يولّد سرّ جديد (لسه مش مفعّل) ويرجّع otpauth URL لعرضه كـ QR في الواجهة."""
    secret = pyotp.random_base32()
    await execute("UPDATE users SET totp_pending_secret=$1 WHERE id=$2", secret, user.user_id)
    uri = pyotp.TOTP(secret).provisioning_uri(name=user.email, issuer_name="Z8 — مصدر الزيوت")
    return {"secret": secret, "otpauthUrl": uri}


class Confirm2faBody(BaseModel):
    code: str


@router.post("/2fa/confirm")
async def totp_confirm(body: Confirm2faBody, user: CurrentUser = Depends(get_current_user)):
    """تأكيد أول كود من التطبيق — بعدها يتفعّل 2FA فعلياً وتُولَّد أكواد استرجاع تظهر مرة واحدة فقط."""
    row = await fetchrow("SELECT totp_pending_secret FROM users WHERE id=$1", user.user_id)
    secret = row and row["totp_pending_secret"]
    if not secret or not pyotp.TOTP(secret).verify(body.code.strip().replace(" ", ""), valid_window=1):
        raise HTTPException(400, "الكود غير صحيح — تأكد من مزامنة وقت جهازك")
    backup_codes = [f"{secrets.token_hex(2)}-{secrets.token_hex(2)}".upper() for _ in range(8)]
    hashed = [hash_password(c) for c in backup_codes]
    await execute(
        """UPDATE users SET totp_secret=$1, totp_pending_secret=NULL,
                             totp_enabled=TRUE, totp_backup_codes=$2::jsonb
           WHERE id=$3""",
        secret, json.dumps(hashed), user.user_id)
    return {"ok": True, "backupCodes": backup_codes}


class Disable2faBody(BaseModel):
    password: str


@router.post("/2fa/disable")
async def totp_disable(body: Disable2faBody, user: CurrentUser = Depends(get_current_user)):
    row = await fetchrow("SELECT password_hash FROM users WHERE id=$1", user.user_id)
    if not row or not verify_password(body.password, row["password_hash"]):
        raise HTTPException(401, "كلمة المرور غير صحيحة")
    await execute(
        """UPDATE users SET totp_secret=NULL, totp_pending_secret=NULL,
                             totp_enabled=FALSE, totp_backup_codes='[]'::jsonb
           WHERE id=$1""",
        user.user_id)
    return {"ok": True}


# ══════════════════ الجلسات والأجهزة النشطة ══════════════════

@router.get("/sessions")
async def list_sessions(request: Request, user: CurrentUser = Depends(get_current_user)):
    from ...core.db import fetch
    auth = request.headers.get("authorization", "")
    current_sid = None
    if auth.startswith("Bearer "):
        try:
            current_sid = decode_token(auth[7:]).get("sid")
        except Exception:
            current_sid = None
    rows = await fetch(
        """SELECT id, device_label, ip, created_at, last_seen_at
           FROM user_sessions
           WHERE user_id=$1 AND revoked_at IS NULL
           ORDER BY last_seen_at DESC""",
        user.user_id)
    return [{"id": str(r["id"]), "deviceLabel": r["device_label"], "ip": r["ip"],
             "createdAt": r["created_at"], "lastSeenAt": r["last_seen_at"],
             "isCurrent": current_sid == str(r["id"])} for r in rows]


@router.delete("/sessions/{session_id}", status_code=204)
async def revoke_session(session_id: str, user: CurrentUser = Depends(get_current_user)):
    await execute(
        "UPDATE user_sessions SET revoked_at=now() WHERE id=$1 AND user_id=$2 AND revoked_at IS NULL",
        session_id, user.user_id)
