# core/integration_log.py — سجل أحداث التكاملات الخارجية (واتساب، بوابة الدفع...)
# إدراج فقط، best-effort — فشل التسجيل نفسه لا يوقف أو يغيّر مصير العملية الأصلية أبداً
# (نفس فلسفة core/notify.py). الشاشة المقابلة: settings.whatsapp → GET /settings/integration-log
from .db import execute


async def log_event(company_id: str, provider: str, event: str, status: str, detail: str | None = None) -> None:
    try:
        await execute(
            """INSERT INTO integration_log (company_id, provider, event, status, detail)
               VALUES ($1,$2,$3,$4,$5)""",
            company_id, provider, event, status, detail)
    except Exception as e:
        print(f"⚠ integration_log: فشل تسجيل الحدث ({provider}/{event}): {e}")
