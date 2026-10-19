# modules/settings/api.py — طبقة الـ HTTP لمركز الإعدادات: مسارات + صلاحيات + تدقيق فقط
from fastapi import APIRouter, Depends, HTTPException, Query, Response as _Response
from pydantic import BaseModel

from ...core.db import execute, fetchrow
from ...core.deps import CurrentUser, get_current_user, require_permission
from ...core.audit import log_action
from . import service
from .schemas import (
    CompanyOut, CompanyIn, LogoIn, RoleOut, RoleIn, SettingsDashboardOut,
    PrintingSettingsOut, PrintingSettingsIn, SystemSettingsOut, SystemSettingsIn,
    BackgroundOut, BackgroundCreateIn, BackgroundSettingsOut, BackgroundSettingsIn,
    DesignSettingsOut, DesignSettingsIn, LoyaltySettingsOut, LoyaltySettingsIn,
    EmailSettingsOut, EmailSettingsIn,
    WhatsAppSettingsOut, WhatsAppSettingsIn, WhatsAppTestIn, IntegrationLogOut,
    BackupFileOut,
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
    # الرابط بقى فيه ?v=<logo_version> بيتغيّر فعليًا مع كل تحديث للشعار — فآمن نكاشه لفترة
    # طويلة جداً (المتصفح أصلاً مش هيطلب نفس الرابط القديم تاني بعد أي تغيير)
    return _Response(content=img["bytes"], media_type=img["mime"],
                     headers={"Cache-Control": "public, max-age=31536000, immutable"})


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


# ══════════════════ برنامج نقاط الولاء ══════════════════

@router.get("/loyalty", response_model=LoyaltySettingsOut)
async def get_loyalty_settings(user: CurrentUser = Depends(get_current_user)):
    return await service.get_loyalty_settings(user.company_id)


@router.put("/loyalty", response_model=LoyaltySettingsOut)
async def update_loyalty_settings(body: LoyaltySettingsIn,
                                  user: CurrentUser = Depends(require_permission("settings.company"))):
    row = await service.update_loyalty_settings(user.company_id, body)
    await log_action(user, "edit", "settings", details="تحديث إعدادات نقاط الولاء")
    return row


# ══════════════════ إعدادات الطباعة ══════════════════

@router.get("/printing", response_model=PrintingSettingsOut)
async def get_printing_settings(user: CurrentUser = Depends(get_current_user)):
    return await service.get_printing_settings(user.company_id)


@router.put("/printing", response_model=PrintingSettingsOut)
async def update_printing_settings(body: PrintingSettingsIn,
                                   user: CurrentUser = Depends(require_permission("settings.company"))):
    row = await service.update_printing_settings(user.company_id, body)
    await log_action(user, "edit", "settings", details="تحديث إعدادات الطباعة")
    return row


class QuickAutoPrintIn(BaseModel):
    autoPrint: bool


@router.put("/printing/quick-toggle")
async def quick_toggle_auto_print(body: QuickAutoPrintIn,
                                  user: CurrentUser = Depends(get_current_user)):
    """تبديل سريع من القائمة المنبثقة ⚙ في نقطة البيع — بصلاحية الدخول العادية
    فقط (بلا settings.company)، مطابقةً للسلوك القديم لمفتاح z8_print_auto
    المحلي اللي كان أي موظف يقدر يبدّله بنفسه."""
    return await service.set_auto_print(user.company_id, body.autoPrint)


# ══════════════════ إعدادات النظام ══════════════════

@router.get("/system", response_model=SystemSettingsOut)
async def get_system_settings(user: CurrentUser = Depends(get_current_user)):
    return await service.get_system_settings(user.company_id)


@router.put("/system", response_model=SystemSettingsOut)
async def update_system_settings(body: SystemSettingsIn,
                                 user: CurrentUser = Depends(require_permission("settings.company"))):
    row = await service.update_system_settings(user.company_id, body)
    await log_action(user, "edit", "settings", details="تحديث إعدادات النظام")
    return row


# ══════════════════ البريد الإلكتروني (SMTP) — جزء محرك الإشعارات ══════════════════

@router.get("/email", response_model=EmailSettingsOut)
async def get_email_settings(user: CurrentUser = Depends(require_permission("settings.company"))):
    return await service.get_email_settings(user.company_id)


@router.put("/email", response_model=EmailSettingsOut)
async def update_email_settings(body: EmailSettingsIn,
                                 user: CurrentUser = Depends(require_permission("settings.company"))):
    row = await service.update_email_settings(user.company_id, body)
    await log_action(user, "edit", "settings", details="تحديث إعدادات البريد الإلكتروني")
    return row


class TestEmailIn(BaseModel):
    to: str


@router.post("/email/test")
async def send_test_email(body: TestEmailIn,
                          user: CurrentUser = Depends(require_permission("settings.company"))):
    await service.send_test_email(user.company_id, body.to)
    return {"success": True}


# ══════════════════ واتساب (UltraMsg) ══════════════════

@router.get("/whatsapp", response_model=WhatsAppSettingsOut)
async def get_whatsapp_settings(user: CurrentUser = Depends(require_permission("settings.whatsapp"))):
    return await service.get_whatsapp_settings(user.company_id)


@router.put("/whatsapp", response_model=WhatsAppSettingsOut)
async def update_whatsapp_settings(body: WhatsAppSettingsIn,
                                   user: CurrentUser = Depends(require_permission("settings.whatsapp"))):
    row = await service.update_whatsapp_settings(user.company_id, body)
    await log_action(user, "edit", "settings", details="تحديث إعدادات واتساب")
    return row


@router.post("/whatsapp/test")
async def send_test_whatsapp(body: WhatsAppTestIn,
                             user: CurrentUser = Depends(require_permission("settings.whatsapp"))):
    await service.send_test_whatsapp(user.company_id, body.phone)
    return {"success": True}


# ══════════════════ سجل التكاملات الخارجية ══════════════════

@router.get("/integration-log", response_model=list[IntegrationLogOut])
async def list_integration_log(provider: str | None = Query(default=None), limit: int = Query(default=100, ge=1, le=500),
                               user: CurrentUser = Depends(require_permission("settings.whatsapp"))):
    return await service.list_integration_log(user.company_id, provider, limit)


# ══════════════════ النسخ الاحتياطي ══════════════════

@router.get("/backup", response_model=list[BackupFileOut])
async def list_backups(user: CurrentUser = Depends(require_permission("settings.company"))):
    return await service.list_backups(user.company_id)


@router.post("/backup", response_model=BackupFileOut, status_code=201)
async def create_backup(user: CurrentUser = Depends(require_permission("settings.company"))):
    row = await service.create_backup(user.company_id)
    await log_action(user, "create", "backup", details=f"نسخة احتياطية جديدة: {row['filename']}")
    return row


@router.get("/backup/{filename}/download")
async def download_backup(filename: str, user: CurrentUser = Depends(require_permission("settings.company"))):
    from fastapi.responses import FileResponse
    path = service.get_backup_path(user.company_id, filename)
    return FileResponse(path, media_type="application/gzip", filename=filename)


@router.delete("/backup/{filename}")
async def delete_backup(filename: str, user: CurrentUser = Depends(require_permission("settings.company"))):
    await service.delete_backup(user.company_id, filename)
    await log_action(user, "delete", "backup", details=f"حذف نسخة احتياطية: {filename}")
    return {"success": True}


# ══════════════════ الخلفية الموحدة للنظام (معرض متعدد) ══════════════════

@router.get("/backgrounds", response_model=list[BackgroundOut])
async def list_backgrounds(user: CurrentUser = Depends(get_current_user)):
    return await service.list_backgrounds(user.company_id)


@router.post("/backgrounds", response_model=BackgroundOut, status_code=201)
async def create_background(body: BackgroundCreateIn,
                            user: CurrentUser = Depends(require_permission("settings.company"))):
    row = await service.create_background(user.company_id, body.name, body.imageBase64)
    await log_action(user, "edit", "settings", details=f"إضافة خلفية: {body.name}")
    return row


@router.delete("/backgrounds/{bg_id}", status_code=204)
async def delete_background(bg_id: str, user: CurrentUser = Depends(require_permission("settings.company"))):
    await service.delete_background(user.company_id, bg_id)
    await log_action(user, "delete", "settings", details="حذف خلفية")


@router.get("/backgrounds/{company_id}/{bg_id}/image")
async def get_background_image(company_id: str, bg_id: str):
    """بلا توثيق عمداً — الخلفية بتُطبَّق كـ CSS background-image على عنصر ثابت
    خلف كل صفحات التطبيق، والمتصفح بيطلبها مباشرة بلا أي هيدر توثيق، بنفس
    منطق شعار المنشأة العام (public/company/logo)."""
    img = await service.get_background_bytes(company_id, bg_id)
    if not img:
        raise HTTPException(404, "الصورة غير موجودة")
    return _Response(content=img["bytes"], media_type=img["mime"],
                     headers={"Cache-Control": "public, max-age=86400"})


@router.get("/background-settings", response_model=BackgroundSettingsOut)
async def get_background_settings(user: CurrentUser = Depends(get_current_user)):
    return await service.get_background_settings(user.company_id)


@router.put("/background-settings", response_model=BackgroundSettingsOut)
async def update_background_settings(body: BackgroundSettingsIn,
                                      user: CurrentUser = Depends(require_permission("settings.company"))):
    row = await service.update_background_settings(user.company_id, body)
    await log_action(user, "edit", "settings", details="تحديث إعدادات الخلفية")
    return row


# ══════════════════ إعدادات التصميم (الألوان/الخط/الأزرار/القائمة) ══════════════════

@router.get("/design", response_model=DesignSettingsOut)
async def get_design_settings(user: CurrentUser = Depends(get_current_user)):
    return await service.get_design_settings(user.company_id)


@router.put("/design", response_model=DesignSettingsOut)
async def update_design_settings(body: DesignSettingsIn,
                                  user: CurrentUser = Depends(require_permission("settings.company"))):
    row = await service.update_design_settings(user.company_id, body)
    await log_action(user, "edit", "settings", details="تحديث إعدادات التصميم")
    return row


@router.post("/design/undo", response_model=DesignSettingsOut)
async def undo_design_settings(user: CurrentUser = Depends(require_permission("settings.company"))):
    row = await service.undo_design_settings(user.company_id)
    await log_action(user, "edit", "settings", details="تراجع عن آخر تعديل في التصميم")
    return row


# ══════════════════ سجل المراجعة (Audit Log) ══════════════════

@router.get("/audit-log")
async def get_audit_log(page: int = 1, pageSize: int = 50,
                        userId: str | None = None, entity: str | None = None,
                        q: str | None = None, dateFrom: str | None = None, dateTo: str | None = None,
                        user: CurrentUser = Depends(require_permission("audit.view"))):
    return await service.list_audit_log(
        user.company_id, page=page, page_size=pageSize, user_id=userId,
        entity=entity, q=q, date_from=dateFrom, date_to=dateTo)


@router.get("/audit-log/entities")
async def get_audit_log_entities(user: CurrentUser = Depends(require_permission("audit.view"))):
    return await service.audit_log_entities(user.company_id)


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
