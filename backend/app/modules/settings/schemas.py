# modules/settings/schemas.py — عقود مركز الإعدادات (Pydantic)
import re
from pydantic import BaseModel, Field, field_validator

_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
_KSA_PHONE_RE = re.compile(r"^(05\d{8}|9665\d{8}|\+9665\d{8})$")
_VAT_RE = re.compile(r"^3\d{14}$")  # الرقم الضريبي السعودي: 15 رقم يبدأ بـ3


class CompanyOut(BaseModel):
    name: str
    name_en: str | None = None
    trade_name: str | None = None
    vat_number: str | None = None
    cr_number: str | None = None
    unified_number: str | None = None
    establishment_number: str | None = None
    phone: str | None = None
    mobile: str | None = None
    email: str | None = None
    website: str | None = None
    address: str | None = None
    building_no: str | None = None
    street: str | None = None
    district: str | None = None
    city: str | None = None
    postal_code: str | None = None
    additional_no: str | None = None
    country: str = "SA"
    currency: str = "SAR"
    default_lang: str = "ar"
    has_logo: bool = False
    logo_url: str | None = None


class CompanyIn(BaseModel):
    name: str = Field(min_length=2, max_length=200)
    name_en: str | None = Field(default=None, max_length=200)
    trade_name: str | None = Field(default=None, max_length=200)
    vat_number: str | None = None
    cr_number: str | None = Field(default=None, max_length=50)
    unified_number: str | None = Field(default=None, max_length=50)
    establishment_number: str | None = Field(default=None, max_length=50)
    phone: str | None = None
    mobile: str | None = None
    email: str | None = None
    website: str | None = None
    address: str | None = Field(default=None, max_length=500)
    building_no: str | None = Field(default=None, max_length=20)
    street: str | None = Field(default=None, max_length=150)
    district: str | None = Field(default=None, max_length=150)
    city: str | None = Field(default=None, max_length=100)
    postal_code: str | None = Field(default=None, max_length=10)
    additional_no: str | None = Field(default=None, max_length=10)
    country: str = Field(default="SA", max_length=2)
    currency: str = Field(default="SAR", max_length=3)
    default_lang: str = Field(default="ar", max_length=5)

    @field_validator("vat_number")
    @classmethod
    def _vat(cls, v: str | None) -> str | None:
        v = (v or "").strip()
        if not v:
            return None
        if not _VAT_RE.match(v):
            raise ValueError("الرقم الضريبي يجب أن يكون 15 رقماً ويبدأ بـ3")
        return v

    @field_validator("email")
    @classmethod
    def _email(cls, v: str | None) -> str | None:
        v = (v or "").strip()
        if not v:
            return None
        if not _EMAIL_RE.match(v):
            raise ValueError("بريد إلكتروني غير صالح")
        return v

    @field_validator("phone", "mobile")
    @classmethod
    def _phone(cls, v: str | None) -> str | None:
        v = (v or "").strip()
        if not v:
            return None
        if not _KSA_PHONE_RE.match(v.replace(" ", "")):
            raise ValueError("رقم جوال سعودي غير صالح (05xxxxxxxx)")
        return v

    @field_validator("website")
    @classmethod
    def _website(cls, v: str | None) -> str | None:
        v = (v or "").strip()
        if not v:
            return None
        if not v.startswith(("http://", "https://")):
            v = "https://" + v
        return v


class LogoIn(BaseModel):
    logoBase64: str | None = None  # None/فاضي = حذف الشعار


# ══════════════════ الأدوار والصلاحيات ══════════════════

class RoleOut(BaseModel):
    id: str
    name: str
    icon: str
    description: str | None = None
    permissions: list[str] = []
    is_system: bool
    users_count: int = 0


class RoleIn(BaseModel):
    name: str = Field(min_length=2, max_length=80)
    icon: str = Field(default="🧩", max_length=8)
    description: str | None = Field(default=None, max_length=300)
    permissions: list[str] = []


# ══════════════════ داشبورد الإعدادات ══════════════════

class SetupStatus(BaseModel):
    key: str
    label: str
    ok: bool


class SettingsDashboardOut(BaseModel):
    companyName: str
    branchesCount: int
    usersCount: int
    usersActive: int
    rolesCount: int
    setup: list[SetupStatus]


# ══════════════════ إعدادات الطباعة (7 إعدادات جديدة) ══════════════════

class PrintingSettingsOut(BaseModel):
    autoPrint: bool = True
    footer: str = "شكراً لتعاملكم معنا"
    footerReturn: str = "نعتذر عن أي إزعاج، نتمنى لكم تجربة أفضل في المرة القادمة"
    thermalFontSize: str = "normal"      # normal | large
    thermalShowLogo: bool = True
    thermalShowQr: bool = True           # الحرارية فقط — QR فاتورة A4 الضريبي لا يُعطَّل أبداً
    copies: int = 1
    previewBeforePrint: bool = False


class PrintingSettingsIn(BaseModel):
    autoPrint: bool = True
    footer: str = Field(default="شكراً لتعاملكم معنا", max_length=200)
    footerReturn: str = Field(default="نعتذر عن أي إزعاج، نتمنى لكم تجربة أفضل في المرة القادمة", max_length=200)
    thermalFontSize: str = "normal"
    thermalShowLogo: bool = True
    thermalShowQr: bool = True
    copies: int = Field(default=1, ge=1, le=5)
    previewBeforePrint: bool = False

    @field_validator("thermalFontSize")
    @classmethod
    def _font(cls, v: str) -> str:
        if v not in ("normal", "large"):
            raise ValueError("حجم خط غير صالح")
        return v

    @field_validator("footer", "footerReturn")
    @classmethod
    def _footer(cls, v: str) -> str:
        return v.strip() or "—"


# ══════════════════ إعدادات النظام (7 إعدادات جديدة) ══════════════════

class SystemSettingsOut(BaseModel):
    landingAdmin: str | None = None
    landingEmployee: str | None = None
    sessionHours: int = 0            # 0 = الافتراضي الأصلي للنظام (JWT_EXPIRES_DAYS)
    minPasswordLength: int = 8
    maxLoginAttempts: int = 0        # 0 = القفل التلقائي معطّل
    lockoutMinutes: int = 15
    timeFormat: str = "24"           # 24 | 12
    fiscalYearStartMonth: int = 1    # 1..12
    maintenanceMode: bool = False    # لا يحجب حساب admin أبداً


class SystemSettingsIn(BaseModel):
    landingAdmin: str | None = None
    landingEmployee: str | None = None
    sessionHours: int = Field(default=0, ge=0, le=720)
    minPasswordLength: int = Field(default=8, ge=6, le=32)
    maxLoginAttempts: int = Field(default=0, ge=0, le=20)
    lockoutMinutes: int = Field(default=15, ge=1, le=1440)
    timeFormat: str = "24"
    fiscalYearStartMonth: int = Field(default=1, ge=1, le=12)
    maintenanceMode: bool = False

    @field_validator("landingAdmin", "landingEmployee")
    @classmethod
    def _landing(cls, v: str | None) -> str | None:
        v = (v or "").strip()
        if not v:
            return None
        if not v.startswith("/") or len(v) > 100:
            raise ValueError("مسار صفحة غير صالح")
        return v

    @field_validator("timeFormat")
    @classmethod
    def _tf(cls, v: str) -> str:
        if v not in ("24", "12"):
            raise ValueError("صيغة وقت غير صالحة")
        return v

    @field_validator("maxLoginAttempts")
    @classmethod
    def _attempts(cls, v: int) -> int:
        if v != 0 and v < 3:
            raise ValueError("عدد المحاولات المسموح به: 0 (تعطيل القفل) أو 3 فأكثر")
        return v


# ══════════════════ الخلفية الموحدة للنظام (معرض متعدد) ══════════════════

class BackgroundOut(BaseModel):
    id: str
    name: str
    image_url: str
    created_at: object | None = None


class BackgroundCreateIn(BaseModel):
    name: str = Field(default="خلفية", max_length=100)
    imageBase64: str


class BackgroundSettingsOut(BaseModel):
    activeId: str | None = None
    activeImageUrl: str | None = None
    opacity: int = 100          # شفافية لوحة المحتوى الرئيسية — 100 = بلا أي تغيير بصري (الوضع الافتراضي الآمن)
    overlayDarkness: int = 0    # تعتيم فوق الصورة نفسها
    blur: int = 0                # تمويه الصورة نفسها (px)
    fit: str = "cover"          # cover | contain | repeat


class BackgroundSettingsIn(BaseModel):
    activeId: str | None = None
    opacity: int = Field(default=100, ge=0, le=100)
    overlayDarkness: int = Field(default=0, ge=0, le=100)
    blur: int = Field(default=0, ge=0, le=20)
    fit: str = "cover"

    @field_validator("fit")
    @classmethod
    def _fit(cls, v: str) -> str:
        if v not in ("cover", "contain", "repeat"):
            raise ValueError("طريقة عرض غير صالحة")
        return v


_HEX_RE = re.compile(r"^#[0-9A-Fa-f]{6}$")
# خطوط عربية — تُستخدم لما واجهة النظام عربي
_FONT_FAMILIES_AR = {
    "cairo", "tajawal", "ibm-plex-arabic", "almarai", "noto-kufi-arabic", "changa",
    "el-messiri", "readex-pro", "reem-kufi", "markazi-text", "lalezar", "harmattan",
}
# خطوط إنجليزية — تُستخدم لما واجهة النظام English
_FONT_FAMILIES_EN = {
    "inter", "roboto", "poppins", "montserrat", "lato", "open-sans",
    "nunito", "work-sans", "source-sans", "manrope", "dm-sans", "outfit", "arial",
}
_BUTTON_SHAPES = {"sharp", "rounded", "pill"}
_SIDEBAR_DEFAULTS = {"expanded", "collapsed"}


class DesignSettingsOut(BaseModel):
    primaryColor: str | None = None   # لون أساسي مخصص (hex) — فارغ = اللون الافتراضي
    successColor: str | None = None
    warningColor: str | None = None
    errorColor: str | None = None
    fontFamilyAr: str = "cairo"       # يُستخدم تلقائياً لما لغة الواجهة عربي
    fontFamilyEn: str = "inter"       # يُستخدم تلقائياً لما لغة الواجهة English
    buttonShape: str = "rounded"      # sharp | rounded | pill
    buttonAnimation: bool = True      # حركة عند التحويم/الضغط — الأزرار فقط (مش القوائم)
    sidebarDefault: str = "expanded"  # expanded | collapsed


class DesignSettingsIn(BaseModel):
    primaryColor: str | None = None
    successColor: str | None = None
    warningColor: str | None = None
    errorColor: str | None = None
    fontFamilyAr: str = "cairo"
    fontFamilyEn: str = "inter"
    buttonShape: str = "rounded"
    buttonAnimation: bool = True
    sidebarDefault: str = "expanded"

    @field_validator("primaryColor", "successColor", "warningColor", "errorColor")
    @classmethod
    def _hex(cls, v: str | None) -> str | None:
        if v is None or v == "":
            return None
        v = v.strip()
        if not _HEX_RE.match(v):
            raise ValueError("لون غير صالح — استخدم صيغة #RRGGBB")
        return v

    @field_validator("fontFamilyAr")
    @classmethod
    def _font_ar(cls, v: str) -> str:
        if v not in _FONT_FAMILIES_AR:
            raise ValueError("خط عربي غير مدعوم")
        return v

    @field_validator("fontFamilyEn")
    @classmethod
    def _font_en(cls, v: str) -> str:
        if v not in _FONT_FAMILIES_EN:
            raise ValueError("خط إنجليزي غير مدعوم")
        return v

    @field_validator("buttonShape")
    @classmethod
    def _shape(cls, v: str) -> str:
        if v not in _BUTTON_SHAPES:
            raise ValueError("شكل أزرار غير صالح")
        return v

    @field_validator("sidebarDefault")
    @classmethod
    def _sidebar(cls, v: str) -> str:
        if v not in _SIDEBAR_DEFAULTS:
            raise ValueError("وضع قائمة غير صالح")
        return v
