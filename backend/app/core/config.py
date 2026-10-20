# core/config.py — الإعدادات المركزية من ملف .env
from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    DATABASE_URL: str = "postgresql://postgres:123@localhost:5432/z8_car_manager"
    JWT_SECRET: str = "z8SecretKey2026XyzAbc123456789QwErTy"
    JWT_EXPIRES_DAYS: int = 7
    PORT: int = 4001
    CORS_ORIGINS: str = "http://localhost:3000"
    # مفتاح Claude Vision — لقراءة اللوحات بدقة قصوى وتحليل الكاميرات (اختياري)
    ANTHROPIC_API_KEY: str = ""
    # مفتاح حماية نقطة /api/shortage-overrides العامة (بدون تسجيل دخول موظفين) —
    # يستخدمه تطبيق ماسح النواقص على الموبايل عبر هيدر X-API-Key. لو تُرك فاضي
    # تبقى النقطة مفتوحة بدون حماية (غير مستحسن في الإنتاج).
    SHORTAGE_API_KEY: str = ""

    class Config:
        env_file = ".env"
        extra = "ignore"

settings = Settings()
