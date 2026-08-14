# modules/auth/api.py — تسجيل الدخول والهوية
# عقد الرد مطابق حرفياً للنظام القديم: {token, user:{id, email, fullName, ...}}
# عشان أي واجهة قديمة أو جديدة تشتغل على أي باك اند من الاتنين.
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, EmailStr
from ...core.db import fetchrow, execute
from ...core.security import verify_password, create_token
from ...core.deps import get_current_user, require_permission, CurrentUser
from ...core.permissions import PERMISSIONS, ALL_KEYS

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
                  role, permissions, is_active
           FROM users WHERE email = $1""",
        body.email.lower().strip(),
    )
    if not row:
        raise HTTPException(401, "البريد الإلكتروني أو كلمة المرور غير صحيحة")
    if not row["is_active"]:
        raise HTTPException(403, "هذا الحساب معطّل، تواصل مع الإدارة")
    if not verify_password(body.password, row["password_hash"]):
        raise HTTPException(401, "البريد الإلكتروني أو كلمة المرور غير صحيحة")

    await execute("UPDATE users SET last_login_at = now() WHERE id = $1", row["id"])
    return {"token": create_token(row["id"]), "user": _user_payload(row)}

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
