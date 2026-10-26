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
    # مسار ملف مفتاح حساب خدمة فايربيز (Firebase Admin SDK) - خطة بديلة لما سيرفر
    # هذا الجهاز نفسه يقع: تطبيق الموبايل يبعت الطلبية لفايربيز بدل ما تفشل، وهذا
    # المسار هو اللي بيخلي الباك إند يقدر يسحبها منه ويحطها في قاعدة البيانات
    # الحقيقية أول ما يرجع يشتغل. فاضي = الميزة متوقفة تمامًا (سلوك افتراضي آمن).
    FIREBASE_SERVICE_ACCOUNT_PATH: str = ""
    # بوابة واتساب المحلية (whatsapp-web.js) — مجانية بدون اشتراك. لو الاتنين متعبّيين،
    # كل رسائل واتساب (OTP، فواتير، إشعارات) بتروح من خلالها بدل UltraMsg.
    # رابط الموقع العام (مثال: https://z8masdr.duckdns.org) — بيتحط في رسائل واتساب للعملاء
    PUBLIC_BASE_URL: str = ""
    WA_GATEWAY_URL: str = ""      # مثال: http://127.0.0.1:4100
    WA_GATEWAY_KEY: str = ""

    class Config:
        env_file = ".env"
        extra = "ignore"

settings = Settings()
