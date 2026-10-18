# modules/settings/service.py — منطق مركز الإعدادات معزول عن طبقة الـ HTTP
import base64 as _b64
from fastapi import HTTPException
from ...core.db import execute, fetch, fetchrow
from ...core.security import hash_password
from ...core.permissions import ALL_KEYS

_COMPANY_COLS = """name, name_en, trade_name, vat_number, cr_number, unified_number,
                   establishment_number, phone, mobile, email, website, address,
                   building_no, street, district, city, postal_code, additional_no,
                   country, currency, default_lang,
                   (logo_base64 IS NOT NULL AND logo_base64 <> '') AS has_logo"""


# ══════════════════ المنشأة ══════════════════

def _with_logo_url(row: dict, company_id: str) -> dict:
    row = dict(row)
    row["logo_url"] = f"/api/settings/company/logo/{company_id}" if row.get("has_logo") else None
    return row


async def get_company(company_id: str) -> dict:
    row = await fetchrow(f"SELECT {_COMPANY_COLS} FROM companies WHERE id=$1", company_id)
    if not row:
        return {"name": "", "has_logo": False, "logo_url": None}
    return _with_logo_url(row, company_id)


async def update_company(company_id: str, body) -> dict:
    row = await fetchrow(
        f"""UPDATE companies SET
              name=$1, name_en=$2, trade_name=$3, vat_number=$4, cr_number=$5,
              unified_number=$6, establishment_number=$7, phone=$8, mobile=$9,
              email=$10, website=$11, address=$12, building_no=$13, street=$14,
              district=$15, city=$16, postal_code=$17, additional_no=$18,
              country=$19, currency=$20, default_lang=$21
            WHERE id=$22
            RETURNING {_COMPANY_COLS}""",
        body.name.strip(), body.name_en, body.trade_name, body.vat_number, body.cr_number,
        body.unified_number, body.establishment_number, body.phone, body.mobile,
        body.email, body.website, body.address, body.building_no, body.street,
        body.district, body.city, body.postal_code, body.additional_no,
        body.country, body.currency, body.default_lang,
        company_id,
    )
    if not row:
        raise HTTPException(404, "المنشأة غير موجودة")
    return _with_logo_url(row, company_id)


async def set_logo(company_id: str, logo_b64: str | None) -> dict:
    clean = (logo_b64 or "").strip() or None
    if clean and len(clean) > 2_000_000:  # ~1.5MB بعد فك التشفير — يكفي لشعار فاتورة
        raise HTTPException(400, "حجم الشعار كبير جداً — استخدم صورة أصغر (أقل من 1.5 ميجابايت)")
    await execute("UPDATE companies SET logo_base64=$1 WHERE id=$2", clean, company_id)
    return {"has_logo": clean is not None}


async def get_logo_bytes(company_id: str) -> dict | None:
    row = await fetchrow("SELECT logo_base64 FROM companies WHERE id=$1", company_id)
    raw = (row or {}).get("logo_base64") or ""
    if not raw:
        return None
    mime, b64 = "image/png", raw
    if raw.startswith("data:"):
        head, _, b64 = raw.partition(",")
        mime = head[5:].split(";")[0] or "image/png"
    try:
        return {"bytes": _b64.b64decode(b64), "mime": mime}
    except Exception:
        return None


# ══════════════════ الأدوار والصلاحيات ══════════════════

def _clean_perms(perms: list[str]) -> list[str]:
    return [p for p in perms if p in ALL_KEYS]


async def list_roles(company_id: str) -> list[dict]:
    rows = await fetch(
        """SELECT r.id, r.name, r.icon, r.description, r.permissions, r.is_system,
                  (SELECT COUNT(*) FROM users u WHERE u.role_id = r.id) AS users_count
           FROM roles r WHERE r.company_id=$1
           ORDER BY r.is_system DESC, r.name""",
        company_id)
    return [{**r, "id": str(r["id"]), "users_count": int(r["users_count"])} for r in rows]


async def create_role(company_id: str, name: str, icon: str, description: str | None,
                      permissions: list[str]) -> dict:
    dup = await fetchrow("SELECT id FROM roles WHERE company_id=$1 AND name=$2", company_id, name.strip())
    if dup:
        raise HTTPException(409, "يوجد دور بنفس الاسم بالفعل")
    row = await fetchrow(
        """INSERT INTO roles (company_id, name, icon, description, permissions, is_system)
           VALUES ($1,$2,$3,$4,$5::jsonb,FALSE)
           RETURNING id, name, icon, description, permissions, is_system, 0 AS users_count""",
        company_id, name.strip(), icon or "🧩", description, _clean_perms(permissions))
    return {**row, "id": str(row["id"])}


async def update_role(company_id: str, role_id: str, name: str, icon: str,
                      description: str | None, permissions: list[str]) -> dict:
    existing = await fetchrow("SELECT is_system FROM roles WHERE id=$1 AND company_id=$2", role_id, company_id)
    if not existing:
        raise HTTPException(404, "الدور غير موجود")
    dup = await fetchrow(
        "SELECT id FROM roles WHERE company_id=$1 AND name=$2 AND id<>$3", company_id, name.strip(), role_id)
    if dup:
        raise HTTPException(409, "يوجد دور بنفس الاسم بالفعل")
    row = await fetchrow(
        """UPDATE roles SET name=$1, icon=$2, description=$3, permissions=$4::jsonb, updated_at=now()
           WHERE id=$5 AND company_id=$6
           RETURNING id, name, icon, description, permissions, is_system,
                     (SELECT COUNT(*) FROM users u WHERE u.role_id = roles.id) AS users_count""",
        name.strip(), icon or "🧩", description, _clean_perms(permissions), role_id, company_id)
    return {**row, "id": str(row["id"]), "users_count": int(row["users_count"])}


async def delete_role(company_id: str, role_id: str) -> None:
    row = await fetchrow("SELECT is_system FROM roles WHERE id=$1 AND company_id=$2", role_id, company_id)
    if not row:
        raise HTTPException(404, "الدور غير موجود")
    if row["is_system"]:
        raise HTTPException(400, "لا يمكن حذف دور أساسي من قوالب النظام")
    in_use = await fetchrow("SELECT id FROM users WHERE role_id=$1 LIMIT 1", role_id)
    if in_use:
        raise HTTPException(400, "لا يمكن حذف دور مُسنَد لموظف — انقل الموظفين لدور آخر أولاً")
    await execute("DELETE FROM roles WHERE id=$1 AND company_id=$2", role_id, company_id)


async def _role_permissions(company_id: str, role_id: str | None) -> list[str]:
    """ترجع مصفوفة صلاحيات الدور عشان تُخزَّن في users.permissions (المسار الوحيد اللي
    core/deps.py بيقرأه فعلياً للتحقق) — role_id نفسه مجرد مؤشر عرض لـ"آخر قالب اتطبّق"."""
    if not role_id:
        return []
    row = await fetchrow("SELECT permissions FROM roles WHERE id=$1 AND company_id=$2", role_id, company_id)
    if not row:
        raise HTTPException(404, "الدور غير موجود")
    return row["permissions"] if isinstance(row["permissions"], list) else []


# ══════════════════ داشبورد الإعدادات ══════════════════

async def dashboard_status(company_id: str) -> dict:
    company = await fetchrow(
        "SELECT name, vat_number, cr_number FROM companies WHERE id=$1", company_id)
    branches = await fetchrow(
        "SELECT COUNT(*) AS n FROM branches WHERE company_id=$1 AND is_active=TRUE", company_id)
    users = await fetchrow(
        "SELECT COUNT(*) AS n, COUNT(*) FILTER (WHERE is_active) AS active FROM users WHERE company_id=$1",
        company_id)
    roles = await fetchrow("SELECT COUNT(*) AS n FROM roles WHERE company_id=$1", company_id)

    company_ok = bool(company and company["name"] and company["vat_number"] and company["cr_number"])
    branches_ok = bool(branches and branches["n"] > 0)
    users_ok = bool(users and users["n"] > 1)  # أكتر من حساب المالك نفسه
    roles_ok = bool(roles and roles["n"] > 0)

    return {
        "companyName": (company or {}).get("name") or "",
        "branchesCount": (branches or {}).get("n", 0),
        "usersCount": (users or {}).get("n", 0),
        "usersActive": (users or {}).get("active", 0),
        "rolesCount": (roles or {}).get("n", 0),
        "setup": [
            {"key": "company", "label": "بيانات المنشأة", "ok": company_ok},
            {"key": "branches", "label": "الفروع", "ok": branches_ok},
            {"key": "users", "label": "المستخدمون", "ok": users_ok},
            {"key": "roles", "label": "الأدوار والصلاحيات", "ok": roles_ok},
        ],
    }


# ══════════════════ مخزن إعدادات عام (key-value) ══════════════════
# إعادة استخدام company_settings الموجود من قبل (كان مخصّصاً لمفتاح ai_supervisor
# وحيد وغير مُستخدَم فعلياً في أي مكان — تأكدنا بالـ grep) كمخزن عام لكل مفاتيح
# print.* و sys.* الجديدة. صفر جدول جديد، صفر خطوة psql يدوية.

async def _get_kv(company_id: str, keys: list[str]) -> dict[str, str]:
    if not keys:
        return {}
    rows = await fetch(
        "SELECT key, value FROM company_settings WHERE company_id=$1 AND key = ANY($2::text[])",
        company_id, keys)
    return {r["key"]: r["value"] for r in rows}


async def _set_kv(company_id: str, kv: dict[str, str]) -> None:
    for k, v in kv.items():
        await execute(
            """INSERT INTO company_settings (company_id, key, value) VALUES ($1,$2,$3)
               ON CONFLICT (company_id, key) DO UPDATE SET value = EXCLUDED.value""",
            company_id, k, v)


# ══════════════════ إعدادات الطباعة ══════════════════

_PRINT_DEFAULTS = {
    "autoPrint": "1",
    "footer": "شكراً لتعاملكم معنا",
    "footerReturn": "نعتذر عن أي إزعاج، نتمنى لكم تجربة أفضل في المرة القادمة",
    "thermalFontSize": "normal",
    "thermalShowLogo": "1",
    "thermalShowQr": "1",
    "copies": "1",
    "previewBeforePrint": "0",
}
_PRINT_BOOL = {"autoPrint", "thermalShowLogo", "thermalShowQr", "previewBeforePrint"}
_PRINT_INT = {"copies"}


async def get_printing_settings(company_id: str) -> dict:
    kv = await _get_kv(company_id, [f"print.{k}" for k in _PRINT_DEFAULTS])
    out: dict = {}
    for k, default in _PRINT_DEFAULTS.items():
        raw = kv.get(f"print.{k}", default)
        if k in _PRINT_BOOL:
            out[k] = raw == "1"
        elif k in _PRINT_INT:
            out[k] = int(raw)
        else:
            out[k] = raw
    return out


async def update_printing_settings(company_id: str, body) -> dict:
    kv = {
        "print.autoPrint": "1" if body.autoPrint else "0",
        "print.footer": body.footer,
        "print.footerReturn": body.footerReturn,
        "print.thermalFontSize": body.thermalFontSize,
        "print.thermalShowLogo": "1" if body.thermalShowLogo else "0",
        "print.thermalShowQr": "1" if body.thermalShowQr else "0",
        "print.copies": str(body.copies),
        "print.previewBeforePrint": "1" if body.previewBeforePrint else "0",
    }
    await _set_kv(company_id, kv)
    return await get_printing_settings(company_id)


async def set_auto_print(company_id: str, enabled: bool) -> dict:
    """تبديل سريع لمفتاح واحد فقط — تستخدمه القائمة السريعة ⚙ في نقطة البيع،
    بصلاحية الدخول العادية فقط (بلا settings.company) لأنه تشغيلي يومي
    مطابق للسلوك القديم (أي موظف كان يقدر يبدّله محلياً)."""
    await _set_kv(company_id, {"print.autoPrint": "1" if enabled else "0"})
    return {"autoPrint": enabled}


# ══════════════════ إعدادات النظام ══════════════════

_SYS_DEFAULTS = {
    "landingAdmin": "",
    "landingEmployee": "",
    "sessionHours": "0",
    "minPasswordLength": "8",
    "maxLoginAttempts": "0",
    "lockoutMinutes": "15",
    "timeFormat": "24",
    "fiscalYearStartMonth": "1",
    "maintenanceMode": "0",
}
_SYS_BOOL = {"maintenanceMode"}
_SYS_INT = {"sessionHours", "minPasswordLength", "maxLoginAttempts", "lockoutMinutes", "fiscalYearStartMonth"}


async def get_system_settings(company_id: str) -> dict:
    kv = await _get_kv(company_id, [f"sys.{k}" for k in _SYS_DEFAULTS])
    out: dict = {}
    for k, default in _SYS_DEFAULTS.items():
        raw = kv.get(f"sys.{k}", default)
        if k in _SYS_BOOL:
            out[k] = raw == "1"
        elif k in _SYS_INT:
            out[k] = int(raw)
        else:
            out[k] = raw or None
    return out


async def update_system_settings(company_id: str, body) -> dict:
    kv = {
        "sys.landingAdmin": body.landingAdmin or "",
        "sys.landingEmployee": body.landingEmployee or "",
        "sys.sessionHours": str(body.sessionHours),
        "sys.minPasswordLength": str(body.minPasswordLength),
        "sys.maxLoginAttempts": str(body.maxLoginAttempts),
        "sys.lockoutMinutes": str(body.lockoutMinutes),
        "sys.timeFormat": body.timeFormat,
        "sys.fiscalYearStartMonth": str(body.fiscalYearStartMonth),
        "sys.maintenanceMode": "1" if body.maintenanceMode else "0",
    }
    await _set_kv(company_id, kv)
    return await get_system_settings(company_id)


# ══════════════════ الخلفية الموحدة للنظام (معرض متعدد) ══════════════════

def _bg_image_url(company_id: str, bg_id: str) -> str:
    return f"/api/settings/backgrounds/{company_id}/{bg_id}/image"


async def list_backgrounds(company_id: str) -> list[dict]:
    rows = await fetch(
        "SELECT id, name, created_at FROM backgrounds WHERE company_id=$1 ORDER BY created_at DESC",
        company_id)
    out = []
    for r in rows:
        bg_id = str(r["id"])
        out.append({"id": bg_id, "name": r["name"], "created_at": r["created_at"],
                    "image_url": _bg_image_url(company_id, bg_id)})
    return out


async def create_background(company_id: str, name: str, image_b64: str) -> dict:
    clean = (image_b64 or "").strip()
    if not clean:
        raise HTTPException(400, "الصورة مطلوبة")
    if len(clean) > 4_000_000:  # ~3 ميجابايت بعد فك التشفير — يكفي لصورة خلفية بجودة عالية
        raise HTTPException(400, "حجم الصورة كبير جداً — استخدم صورة أصغر (أقل من 3 ميجابايت)")
    count = await fetchrow("SELECT COUNT(*) AS n FROM backgrounds WHERE company_id=$1", company_id)
    if count and count["n"] >= 20:
        raise HTTPException(400, "الحد الأقصى 20 خلفية محفوظة — احذف خلفية قديمة أولاً")
    row = await fetchrow(
        """INSERT INTO backgrounds (company_id, name, image_base64) VALUES ($1,$2,$3)
           RETURNING id, name, created_at""",
        company_id, (name or "خلفية").strip()[:100] or "خلفية", clean)
    bg_id = str(row["id"])
    return {"id": bg_id, "name": row["name"], "created_at": row["created_at"],
            "image_url": _bg_image_url(company_id, bg_id)}


async def delete_background(company_id: str, bg_id: str) -> None:
    row = await fetchrow("SELECT id FROM backgrounds WHERE id=$1 AND company_id=$2", bg_id, company_id)
    if not row:
        raise HTTPException(404, "الخلفية غير موجودة")
    await execute("DELETE FROM backgrounds WHERE id=$1 AND company_id=$2", bg_id, company_id)
    # لو كانت هي الفعّالة — نرجع تلقائياً لحالة «بلا خلفية» بدل ما يفضل مؤشر معطوب
    kv = await _get_kv(company_id, ["bg.activeId"])
    if kv.get("bg.activeId") == bg_id:
        await _set_kv(company_id, {"bg.activeId": ""})


async def get_background_bytes(company_id: str, bg_id: str) -> dict | None:
    row = await fetchrow(
        "SELECT image_base64 FROM backgrounds WHERE id=$1 AND company_id=$2", bg_id, company_id)
    raw = (row or {}).get("image_base64") or ""
    if not raw:
        return None
    mime, b64 = "image/jpeg", raw
    if raw.startswith("data:"):
        head, _, b64 = raw.partition(",")
        mime = head[5:].split(";")[0] or "image/jpeg"
    try:
        return {"bytes": _b64.b64decode(b64), "mime": mime}
    except Exception:
        return None


_BG_DEFAULTS = {"activeId": "", "opacity": "100", "overlayDarkness": "0", "blur": "0", "fit": "cover"}
_BG_INT = {"opacity", "overlayDarkness", "blur"}


async def get_background_settings(company_id: str) -> dict:
    kv = await _get_kv(company_id, [f"bg.{k}" for k in _BG_DEFAULTS])
    active_id = kv.get("bg.activeId", "") or None
    out: dict = {
        "activeId": active_id,
        "activeImageUrl": _bg_image_url(company_id, active_id) if active_id else None,
    }
    for k in ("opacity", "overlayDarkness", "blur"):
        out[k] = int(kv.get(f"bg.{k}", _BG_DEFAULTS[k]))
    out["fit"] = kv.get("bg.fit", _BG_DEFAULTS["fit"])
    return out


async def update_background_settings(company_id: str, body) -> dict:
    if body.activeId:
        row = await fetchrow(
            "SELECT id FROM backgrounds WHERE id=$1 AND company_id=$2", body.activeId, company_id)
        if not row:
            raise HTTPException(404, "الخلفية المحددة غير موجودة")
    await _set_kv(company_id, {
        "bg.activeId": body.activeId or "",
        "bg.opacity": str(body.opacity),
        "bg.overlayDarkness": str(body.overlayDarkness),
        "bg.blur": str(body.blur),
        "bg.fit": body.fit,
    })
    return await get_background_settings(company_id)


# ══════════════════ إعدادات التصميم (الألوان/الخط/شكل الأزرار/القائمة الجانبية) ══════════════════
# إعداد واحد موحّد للشركة كاملة — يُحسب في الواجهة إلى متغيرات CSS وقت التشغيل
# (نفس أسلوب bg.* بالظبط: صفر جدول جديد، تخزين في company_settings).

_DESIGN_DEFAULTS = {
    "primaryColor": "", "successColor": "", "warningColor": "", "errorColor": "",
    "fontFamilyAr": "cairo", "fontFamilyEn": "inter", "fontScale": "md",
    "buttonShape": "rounded", "buttonAnimation": "1", "sidebarDefault": "expanded",
}
_DESIGN_BOOL = {"buttonAnimation"}


async def get_design_settings(company_id: str) -> dict:
    kv = await _get_kv(company_id, [f"design.{k}" for k in _DESIGN_DEFAULTS])
    out: dict = {}
    for k, default in _DESIGN_DEFAULTS.items():
        raw = kv.get(f"design.{k}", default)
        if k.endswith("Color"):
            out[k] = raw or None
        elif k in _DESIGN_BOOL:
            out[k] = raw == "1"
        else:
            out[k] = raw
    return out


async def update_design_settings(company_id: str, body) -> dict:
    await _set_kv(company_id, {
        "design.primaryColor": body.primaryColor or "",
        "design.successColor": body.successColor or "",
        "design.warningColor": body.warningColor or "",
        "design.errorColor": body.errorColor or "",
        "design.fontFamilyAr": body.fontFamilyAr,
        "design.fontFamilyEn": body.fontFamilyEn,
        "design.fontScale": body.fontScale,
        "design.buttonShape": body.buttonShape,
        "design.buttonAnimation": "1" if body.buttonAnimation else "0",
        "design.sidebarDefault": body.sidebarDefault,
    })
    return await get_design_settings(company_id)


# ══════════════════ إدارة المستخدمين (منقولة بالحرف من api.py) ══════════════════

def _user_row(r: dict) -> dict:
    r = dict(r)
    r["id"] = str(r["id"])
    r["branch_id"] = str(r["branch_id"]) if r.get("branch_id") else None
    r["role_id"] = str(r["role_id"]) if r.get("role_id") else None
    if not isinstance(r.get("permissions"), list):
        r["permissions"] = []
    return r


async def list_users(company_id: str) -> list[dict]:
    rows = await fetch(
        """SELECT u.id, u.email, u.full_name, u.role, u.branch_id, b.name AS branch_name,
                  u.permissions, u.is_active, u.last_login_at, u.role_id
           FROM users u LEFT JOIN branches b ON b.id = u.branch_id
           WHERE u.company_id=$1 ORDER BY u.is_active DESC, u.full_name""",
        company_id)
    return [_user_row(r) for r in rows]


async def create_user(company_id: str, email: str, password: str, full_name: str, role: str,
                      branch_id: str | None, permissions: list[str], role_id: str | None = None) -> dict:
    email = email.lower().strip()
    min_len = (await get_system_settings(company_id))["minPasswordLength"]
    if "@" not in email or len(password) < min_len:
        raise HTTPException(400, f"بريد صالح وكلمة مرور {min_len} أحرف على الأقل")
    if role not in ("admin", "employee"):
        raise HTTPException(400, "الدور غير صالح")
    dup = await fetchrow("SELECT id FROM users WHERE email=$1", email)
    if dup:
        raise HTTPException(409, "البريد مستخدم بالفعل")
    perms = await _role_permissions(company_id, role_id) if role_id else _clean_perms(permissions)
    row = await fetchrow(
        """INSERT INTO users (company_id, branch_id, email, password_hash, full_name, role, permissions, role_id, is_active)
           VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,TRUE)
           RETURNING id, email, full_name, role, branch_id, NULL AS branch_name,
                     permissions, is_active, last_login_at, role_id""",
        company_id, branch_id, email, hash_password(password),
        full_name.strip(), role, perms, role_id)
    return _user_row(row)


async def update_user(company_id: str, current_user_id: str, user_id: str, full_name: str, role: str,
                      branch_id: str | None, permissions: list[str], is_active: bool,
                      new_password: str | None, role_id: str | None = None) -> dict:
    if role not in ("admin", "employee"):
        raise HTTPException(400, "الدور غير صالح")
    if user_id == current_user_id and not is_active:
        raise HTTPException(400, "لا يمكنك تعطيل حسابك الشخصي")
    if new_password is not None:
        min_len = (await get_system_settings(company_id))["minPasswordLength"]
        if len(new_password) < min_len:
            raise HTTPException(400, f"كلمة المرور الجديدة {min_len} أحرف على الأقل")

    perms = await _role_permissions(company_id, role_id) if role_id else _clean_perms(permissions)
    row = await fetchrow(
        """UPDATE users SET
             full_name=$1, role=$2, branch_id=$3, permissions=$4::jsonb, is_active=$5,
             role_id=$6, password_hash = COALESCE($7, password_hash)
           WHERE id=$8 AND company_id=$9
           RETURNING id, email, full_name, role, branch_id, NULL AS branch_name,
                     permissions, is_active, last_login_at, role_id""",
        full_name.strip(), role, branch_id, perms, is_active,
        role_id, hash_password(new_password) if new_password else None,
        user_id, company_id)
    if not row:
        raise HTTPException(404, "المستخدم غير موجود")
    return _user_row(row)
