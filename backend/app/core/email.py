# core/email.py — إرسال بريد إلكتروني عبر SMTP الشركة (جزء محرك الإشعارات)
# يقرأ إعدادات SMTP مباشرة من company_settings (بدل استدعاء modules/settings
# حتى نتجنّب استيراداً دائرياً — modules/settings/service.py هو اللي بيدير
# شاشة الإعدادات نفسها، وهذا الملف طبقة التنفيذ الفعلية تحتها).
import smtplib
from email.mime.text import MIMEText

from .db import fetch


async def _get_settings(company_id: str) -> dict:
    rows = await fetch(
        "SELECT key, value FROM company_settings WHERE company_id=$1 AND key LIKE 'email.%'",
        company_id)
    return {r["key"].removeprefix("email."): r["value"] for r in rows}


async def send_email(company_id: str, to_address: str, subject: str, body: str) -> bool:
    """يرسل بريداً فورياً (متزامن — smtplib لا يدعم async، فنُشغّله في thread منفصل
    حتى لا يوقف حلقة asyncio). يرجع False بصمت لو الإرسال غير مفعّل أو غير
    مُهيّأ — الإشعار داخل النظام يفضل يُسجَّل في كل الحالات بغض النظر عن البريد."""
    cfg = await _get_settings(company_id)
    if cfg.get("enabled") != "1":
        return False
    host, user, password = cfg.get("smtpHost"), cfg.get("smtpUser"), cfg.get("smtpPassword")
    from_addr = cfg.get("fromAddress") or user
    if not (host and from_addr and to_address):
        return False
    port = int(cfg.get("smtpPort") or 587)
    from_name = cfg.get("fromName") or "Z8"

    def _send_sync() -> bool:
        try:
            msg = MIMEText(body, "plain", "utf-8")
            msg["Subject"] = subject
            msg["From"] = f"{from_name} <{from_addr}>"
            msg["To"] = to_address
            with smtplib.SMTP(host, port, timeout=10) as smtp:
                smtp.starttls()
                if user and password:
                    smtp.login(user, password)
                smtp.sendmail(from_addr, [to_address], msg.as_string())
            return True
        except Exception as e:
            print(f"⚠ email: فشل إرسال البريد إلى {to_address}: {e}")
            return False

    import asyncio
    return await asyncio.get_event_loop().run_in_executor(None, _send_sync)
