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
