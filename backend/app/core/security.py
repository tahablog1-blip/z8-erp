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

def create_token(user_id: str) -> str:
    now = int(time.time())
    payload = {
        "userId": str(user_id),                       # نفس مفتاح النظام القديم بالحرف
        "iat": now,
        "exp": now + settings.JWT_EXPIRES_DAYS * 86400,
    }
    return jwt.encode(payload, settings.JWT_SECRET, algorithm="HS256")

def decode_token(token: str) -> dict:
    """يرفع jwt.PyJWTError لو التوكن غير صالح/منتهي — deps.py بيحوّلها 401"""
    return jwt.decode(token, settings.JWT_SECRET, algorithms=["HS256"])
