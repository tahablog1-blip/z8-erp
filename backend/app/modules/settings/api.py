# modules/settings/api.py — بيانات الشركة (تُستخدم في ترويسات الطباعة أيضاً)
from fastapi import HTTPException, APIRouter, Depends
from pydantic import BaseModel

from ...core.db import execute, fetch, fetchrow
from ...core.deps import CurrentUser, get_current_user, require_permission
from ...core.permissions import ALL_KEYS
from ...core.security import hash_password

router = APIRouter()


class CompanyOut(BaseModel):
    name: str
    vat_number: str | None = None
    cr_number: str | None = None
    address: str | None = None
    phone: str | None = None


class CompanyIn(BaseModel):
    name: str
    vat_number: str | None = None
    cr_number: str | None = None
    address: str | None = None
    phone: str | None = None


@router.get("/company", response_model=CompanyOut)
async def get_company(user: CurrentUser = Depends(get_current_user)):
    row = await fetchrow(
        "SELECT name, vat_number, cr_number, address, phone FROM companies WHERE id=$1",
        user.company_id)
    return dict(row) if row else CompanyOut(name="")


@router.put("/company", response_model=CompanyOut)
async def update_company(body: CompanyIn,
                         user: CurrentUser = Depends(require_permission("settings.company"))):
    row = await fetchrow(
        """UPDATE companies SET name=$1, vat_number=$2, cr_number=$3, address=$4, phone=$5
           WHERE id=$6
           RETURNING name, vat_number, cr_number, address, phone""",
        body.name.strip(), body.vat_number, body.cr_number, body.address, body.phone,
        user.company_id)
    return dict(row)


# ══════════════════ إدارة المستخدمين والصلاحيات ══════════════════

_USERS_PERM = "settings.users"


class UserRowOut(BaseModel):
    id: str
    email: str
    full_name: str
    role: str
    branch_id: str | None = None
    branch_name: str | None = None
    permissions: list[str] = []
    is_active: bool
    last_login_at: object | None = None


class UserCreateIn(BaseModel):
    email: str
    password: str
    fullName: str
    role: str = "employee"               # admin | employee
    branchId: str | None = None
    permissions: list[str] = []


class UserUpdateIn(BaseModel):
    fullName: str
    role: str = "employee"
    branchId: str | None = None
    permissions: list[str] = []
    isActive: bool = True
    newPassword: str | None = None      # اختياري: إعادة تعيين كلمة المرور


def _clean_perms(perms: list[str]) -> list[str]:
    return [p for p in perms if p in ALL_KEYS]


def _user_row(r: dict) -> dict:
    r = dict(r)
    r["id"] = str(r["id"])
    r["branch_id"] = str(r["branch_id"]) if r.get("branch_id") else None
    if not isinstance(r.get("permissions"), list):
        r["permissions"] = []
    return r


@router.get("/users", response_model=list[UserRowOut])
async def list_users(user: CurrentUser = Depends(require_permission(_USERS_PERM))):
    rows = await fetch(
        """SELECT u.id, u.email, u.full_name, u.role, u.branch_id, b.name AS branch_name,
                  u.permissions, u.is_active, u.last_login_at
           FROM users u LEFT JOIN branches b ON b.id = u.branch_id
           WHERE u.company_id=$1 ORDER BY u.is_active DESC, u.full_name""",
        user.company_id)
    return [_user_row(r) for r in rows]


@router.post("/users", response_model=UserRowOut, status_code=201)
async def create_user(body: UserCreateIn,
                      user: CurrentUser = Depends(require_permission(_USERS_PERM))):
    email = body.email.lower().strip()
    if "@" not in email or len(body.password) < 8:
        raise HTTPException(400, "بريد صالح وكلمة مرور 8 أحرف على الأقل")
    if body.role not in ("admin", "employee"):
        raise HTTPException(400, "الدور غير صالح")
    dup = await fetchrow("SELECT id FROM users WHERE email=$1", email)
    if dup:
        raise HTTPException(409, "البريد مستخدم بالفعل")
    row = await fetchrow(
        """INSERT INTO users (company_id, branch_id, email, password_hash, full_name, role, permissions, is_active)
           VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,TRUE)
           RETURNING id, email, full_name, role, branch_id, NULL AS branch_name,
                     permissions, is_active, last_login_at""",
        user.company_id, body.branchId, email, hash_password(body.password),
        body.fullName.strip(), body.role, _clean_perms(body.permissions))
    return _user_row(row)


@router.put("/users/{user_id}", response_model=UserRowOut)
async def update_user(user_id: str, body: UserUpdateIn,
                      user: CurrentUser = Depends(require_permission(_USERS_PERM))):
    if body.role not in ("admin", "employee"):
        raise HTTPException(400, "الدور غير صالح")
    if user_id == user.user_id and not body.isActive:
        raise HTTPException(400, "لا يمكنك تعطيل حسابك الشخصي")
    if body.newPassword is not None and len(body.newPassword) < 8:
        raise HTTPException(400, "كلمة المرور الجديدة 8 أحرف على الأقل")

    row = await fetchrow(
        """UPDATE users SET
             full_name=$1, role=$2, branch_id=$3, permissions=$4::jsonb, is_active=$5,
             password_hash = COALESCE($6, password_hash)
           WHERE id=$7 AND company_id=$8
           RETURNING id, email, full_name, role, branch_id, NULL AS branch_name,
                     permissions, is_active, last_login_at""",
        body.fullName.strip(), body.role, body.branchId, _clean_perms(body.permissions),
        body.isActive, hash_password(body.newPassword) if body.newPassword else None,
        user_id, user.company_id)
    if not row:
        raise HTTPException(404, "المستخدم غير موجود")
    return _user_row(row)


# ══════════════════ مفتاح المراقبة الذكية بالكاميرات ══════════════════
class AiSupervisorIn(BaseModel):
    enabled: bool


@router.get("/ai-supervisor")
async def get_ai_supervisor(user: CurrentUser = Depends(get_current_user)):
    row = await fetchrow(
        "SELECT COALESCE(ai_supervisor_enabled, TRUE) AS enabled FROM companies WHERE id=$1",
        user.company_id)
    return {"enabled": bool(row["enabled"]) if row else True}


@router.put("/ai-supervisor")
async def set_ai_supervisor(body: AiSupervisorIn,
                            user: CurrentUser = Depends(require_permission("settings.manage"))):
    await execute("UPDATE companies SET ai_supervisor_enabled=$1 WHERE id=$2",
                  body.enabled, user.company_id)
    return {"enabled": body.enabled}
