# core/deps.py — تبعيات الحماية: المقابل المعماري لـ middleware/auth.js
# نفس فلسفة النظام القديم بالحرف: التوكن شايل userId فقط، والدور/الصلاحيات/الفرع
# بيتقروا Live من القاعدة على كل طلب — تعطيل موظف أو سحب صلاحية بيسري فوراً.
import jwt as pyjwt
from dataclasses import dataclass, field
from fastapi import Depends, HTTPException, Request
from .security import decode_token
from .db import fetchrow

@dataclass
class CurrentUser:
    user_id: str
    company_id: str
    branch_id: str | None
    email: str
    full_name: str
    role: str                      # 'admin' | 'employee'
    permissions: list[str] = field(default_factory=list)

    def has(self, *keys: str) -> bool:
        """الأدمن يملك كل الصلاحيات ضمنياً — نفس قاعدة hasPerm في النظام القديم"""
        if self.role == "admin":
            return True
        return any(k in self.permissions for k in keys)

    @property
    def branch_scope(self) -> str | None:
        """موظف مربوط بفرع → استعلاماته تتقيّد به. الأدمن/غير المربوط → None (كل الفروع)"""
        return None if self.role == "admin" else self.branch_id

async def get_current_user(request: Request) -> CurrentUser:
    auth = request.headers.get("authorization", "")
    if not auth.startswith("Bearer "):
        raise HTTPException(401, "غير مسجّل الدخول")
    try:
        payload = decode_token(auth[7:])
    except pyjwt.ExpiredSignatureError:
        raise HTTPException(401, "انتهت الجلسة — سجّل الدخول من جديد")
    except pyjwt.PyJWTError:
        raise HTTPException(401, "جلسة غير صالحة")

    row = await fetchrow(
        """SELECT id, company_id, branch_id, email, full_name, role, permissions, is_active
           FROM users WHERE id = $1""",
        payload.get("userId"),
    )
    if not row:
        raise HTTPException(401, "الحساب غير موجود")
    if not row["is_active"]:
        raise HTTPException(403, "هذا الحساب معطّل، تواصل مع الإدارة")

    perms = row["permissions"] if isinstance(row["permissions"], list) else []
    return CurrentUser(
        user_id=str(row["id"]), company_id=str(row["company_id"]),
        branch_id=str(row["branch_id"]) if row["branch_id"] else None,
        email=row["email"], full_name=row["full_name"],
        role=row["role"], permissions=perms,
    )

def require_permission(*keys: str):
    """مصنع تبعية: المقابل لـ requirePermission('branches.manage') — أي مفتاح يكفي"""
    async def checker(user: CurrentUser = Depends(get_current_user)) -> CurrentUser:
        if not user.has(*keys):
            raise HTTPException(403, "ليس لديك صلاحية لهذا الإجراء")
        return user
    return checker


def require_role(*roles: str):
    """مصنع تبعية: المقابل لـ requireRole('admin') — لأفعال أخطر من مجرد صلاحية عادية
    (زي تعديل شجرة الحسابات) يُقصر على دور بعينه بغض النظر عن الصلاحيات الممنوحة"""
    async def checker(user: CurrentUser = Depends(get_current_user)) -> CurrentUser:
        if user.role not in roles:
            raise HTTPException(403, "هذا الإجراء مقصور على مدير النظام")
        return user
    return checker
