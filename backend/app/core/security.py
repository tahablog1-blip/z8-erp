# core/security.py — التوقيع والتحقق: متوافق 100% مع النظام القديم
#   - bcrypt: نفس هاشات bcryptjs ($2a$/$2b$) → كل الموظفين بكلمات مرورهم الحالية
#   - JWT HS256 بنفس السر وبنفس الحمولة {userId} → التوكنات متبادلة بين النظامين
import time
import bcrypt
import jwt
from .config import settings

def verify_password(plain: str, password_hash: str) -> bool:
    try:
        return bcrypt.checkpw(plain.encode("utf-8"), password_hash.encode("utf-8"))
    except (ValueError, TypeError):
        return False

def hash_password(plain: str) -> str:
    return bcrypt.hashpw(plain.encode("utf-8"), bcrypt.gensalt(rounds=10)).decode("utf-8")

def create_token(user_id: str, expire_hours: int | None = None, session_id: str | None = None, extra: dict | None = None) -> str:
    """expire_hours: مدة الجلسة القابلة للتخصيص من الإعدادات ← النظام (إعداد 9) —
    None أو 0 = السلوك الافتراضي الأصلي (JWT_EXPIRES_DAYS الثابت) بلا أي تغيير.
    session_id: معرّف صف user_sessions — يسمح بفصل الجلسة عن بُعد (إدارة الأجهزة).
    توكنات قديمة بلا sid تفضل شغالة لحد ما تنتهي مدتها طبيعياً (deps.py بيتعامل معها)."""
    now = int(time.time())
    ttl = expire_hours * 3600 if expire_hours else settings.JWT_EXPIRES_DAYS * 86400
    payload = {
        "userId": str(user_id),                       # نفس مفتاح النظام القديم بالحرف
        "iat": now,
        "exp": now + ttl,
    }
    if session_id:
        payload["sid"] = str(session_id)
    if extra:
        payload.update({k: v for k, v in extra.items() if k not in ("userId", "iat", "exp", "sid", "purpose")})   # dev / scope لتابلت الكاشير
    return jwt.encode(payload, settings.JWT_SECRET, algorithm="HS256")

def create_totp_pending_token(user_id: str, ttl_seconds: int = 300) -> str:
    """توكن مؤقت (5 دقايق) بين خطوة كلمة السر وخطوة كود المصادقة الثنائية —
    مالوش أي صلاحية دخول عادية (purpose مميّز)، get_current_user بيرفضه تماماً."""
    now = int(time.time())
    payload = {"userId": str(user_id), "purpose": "2fa_pending", "iat": now, "exp": now + ttl_seconds}
    return jwt.encode(payload, settings.JWT_SECRET, algorithm="HS256")

def decode_token(token: str) -> dict:
    """يرفع jwt.PyJWTError لو التوكن غير صالح/منتهي — deps.py بيحوّلها 401"""
    return jwt.decode(token, settings.JWT_SECRET, algorithms=["HS256"])
