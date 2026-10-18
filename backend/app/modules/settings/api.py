# modules/settings/api.py — طبقة الـ HTTP لمركز الإعدادات: مسارات + صلاحيات + تدقيق فقط
from fastapi import APIRouter, Depends, HTTPException, Response as _Response
from pydantic import BaseModel

from ...core.db import execute, fetchrow
from ...core.deps import CurrentUser, get_current_user, require_permission
from ...core.audit import log_action
from . import service
from .schemas import (
    CompanyOut, CompanyIn, LogoIn, RoleOut, RoleIn, SettingsDashboardOut,
)

router = APIRouter()


# ══════════════════ المنشأة ══════════════════

@router.get("/company", response_model=CompanyOut)
async def get_company(user: CurrentUser = Depends(get_current_user)):
    return await service.get_company(user.company_id)


@router.put("/company", response_model=CompanyOut)
async def update_company(body: CompanyIn,
                         user: CurrentUser = Depends(require_permission("settings.company"))):
    row = await service.update_company(user.company_id, body)
    await log_action(user, "edit", "settings", details="تحديث بيانات المنشأة")
    return row


@router.put("/company/logo")
async def set_company_logo(body: LogoIn,
                           user: CurrentUser = Depends(require_permission("settings.company"))):
    result = await service.set_logo(user.company_id, body.logoBase64)
    await log_action(user, "edit", "settings", details="تحديث شعار المنشأة")
    return result


@router.get("/company/logo/{company_id}")
async def get_company_logo(company_id: str):
    """بلا توثيق عمداً — بيُستخدم من نافذة الطباعة اللي مالهاش جلسة دخول،
    بنفس منطق شعار شركة الزيت العام (public/brand-logo)."""
    img = await service.get_logo_bytes(company_id)
    if not img:
        raise HTTPException(404, "لا يوجد شعار")
    return _Response(content=img["bytes"], media_type=img["mime"],
                     headers={"Cache-Control": "public, max-age=3600"})


# ══════════════════ الأدوار والصلاحيات ══════════════════

_ROLES_PERM = "settings.users"


@router.get("/roles", response_model=list[RoleOut])
async def list_roles(user: CurrentUser = Depends(require_permission(_ROLES_PERM))):
    return await service.list_roles(user.company_id)


@router.post("/roles", response_model=RoleOut, status_code=201)
async def create_role(body: RoleIn, user: CurrentUser = Depends(require_permission(_ROLES_PERM))):
    row = await service.create_role(user.company_id, body.name, body.icon, body.description, body.permissions)
    await log_action(user, "edit", "settings", details=f"إنشاء دور: {body.name}")
    return row


@router.put("/roles/{role_id}", response_model=RoleOut)
async def update_role(role_id: str, body: RoleIn, user: CurrentUser = Depends(require_permission(_ROLES_PERM))):
    row = await service.update_role(user.company_id, role_id, body.name, body.icon, body.description, body.permissions)
    await log_action(user, "edit", "settings", details=f"تعديل دور: {body.name}")
    return row


@router.delete("/roles/{role_id}", status_code=204)
async def delete_role(role_id: str, user: CurrentUser = Depends(require_permission(_ROLES_PERM))):
    await service.delete_role(user.company_id, role_id)
    await log_action(user, "delete", "settings", details="حذف دور")


# ══════════════════ داشبورد الإعدادات ══════════════════

@router.get("/dashboard", response_model=SettingsDashboardOut)
async def settings_dashboard(user: CurrentUser = Depends(get_current_user)):
    return await service.dashboard_status(user.company_id)


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
    role_id: str | None = None
    is_active: bool
    last_login_at: object | None = None


class UserCreateIn(BaseModel):
    email: str
    password: str
    fullName: str
    role: str = "employee"               # admin | employee
    branchId: str | None = None
    permissions: list[str] = []
    roleId: str | None = None


class UserUpdateIn(BaseModel):
    fullName: str
    role: str = "employee"
    branchId: str | None = None
    permissions: list[str] = []
    isActive: bool = True
    newPassword: str | None = None      # اختياري: إعادة تعيين كلمة المرور
    roleId: str | None = None


@router.get("/users", response_model=list[UserRowOut])
async def list_users(user: CurrentUser = Depends(require_permission(_USERS_PERM))):
    return await service.list_users(user.company_id)


@router.post("/users", response_model=UserRowOut, status_code=201)
async def create_user(body: UserCreateIn,
                      user: CurrentUser = Depends(require_permission(_USERS_PERM))):
    row = await service.create_user(
        user.company_id, body.email, body.password, body.fullName, body.role,
        body.branchId, body.permissions, body.roleId)
    await log_action(user, "edit", "settings", details=f"إنشاء موظف: {body.fullName}")
    return row


@router.put("/users/{user_id}", response_model=UserRowOut)
async def update_user(user_id: str, body: UserUpdateIn,
                      user: CurrentUser = Depends(require_permission(_USERS_PERM))):
    row = await service.update_user(
        user.company_id, user.user_id, user_id, body.fullName, body.role,
        body.branchId, body.permissions, body.isActive, body.newPassword, body.roleId)
    await log_action(user, "edit", "settings", details=f"تعديل موظف: {row['full_name']}")
    return row


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
