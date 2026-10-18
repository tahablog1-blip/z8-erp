# modules/auth/api.py — تسجيل الدخول والهوية
# عقد الرد مطابق حرفياً للنظام القديم: {token, user:{id, email, fullName, ...}}
# عشان أي واجهة قديمة أو جديدة تشتغل على أي باك اند من الاتنين.
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, EmailStr
from ...core.db import fetchrow, execute
from ...core.security import verify_password, create_token
from ...core.deps import get_current_user, require_permission, CurrentUser
from ...core.permissions import PERMISSIONS, ALL_KEYS
from ..settings import service as settings_service

router = APIRouter()

class LoginBody(BaseModel):
    email: EmailStr
    password: str

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
async def login(body: LoginBody):
    if len(body.password) < 6:
        raise HTTPException(400, "البريد أو كلمة المرور غير صالحة الصيغة")
    row = await fetchrow(
        """SELECT id, company_id, branch_id, email, password_hash, full_name,
                  role, permissions, is_active, failed_login_count, locked_until
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
    token = create_token(row["id"], sys["sessionHours"] or None)
    # وجهة ما بعد الدخول المخصّصة (إعداد 8) — فاضية/None لو الإدارة ما ضبطتش شيء،
    # والواجهة عندها سلوك اكتشاف تلقائي احتياطي لو المسار ده غير متاح لصلاحيات المستخدم
    landing_path = (sys["landingAdmin"] if is_admin else sys["landingEmployee"]) or None
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
