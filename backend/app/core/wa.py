"""وحدة واتساب (UltraMsg) — إشعارات العميل وإرسال الفاتورة.
الإعداد يُخزَّن في جدول companies (عمودا wa_instance / wa_token).
كل الإرسال fire-and-forget: فشل الواتساب لا يُفشل العملية الأصلية أبداً."""
from __future__ import annotations
import asyncio, json, urllib.request, urllib.parse
from .db import fetchrow


def normalize_phone(phone: str | None) -> str | None:
    """05xxxxxxxx → 9665xxxxxxxx — صيغة واتساب الدولية السعودية"""
    if not phone:
        return None
    p = "".join(ch for ch in str(phone) if ch.isdigit())
    if p.startswith("05") and len(p) == 10:
        return "966" + p[1:]
    if p.startswith("9665") and len(p) == 12:
        return p
    if p.startswith("5") and len(p) == 9:
        return "966" + p
    return p if len(p) >= 11 else None


async def _settings(company_id: str) -> tuple[str, str] | None:
    row = await fetchrow(
        "SELECT wa_instance, wa_token FROM companies WHERE id=$1", company_id)
    if not row or not row["wa_instance"] or not row["wa_token"]:
        return None
    return row["wa_instance"].strip(), row["wa_token"].strip()


def _post(url: str, data: dict) -> dict:
    body = urllib.parse.urlencode(data).encode()
    req = urllib.request.Request(url, data=body,
        headers={"Content-Type": "application/x-www-form-urlencoded"})
    with urllib.request.urlopen(req, timeout=15) as r:
        return json.loads(r.read().decode() or "{}")


async def send_text(company_id: str, phone: str | None, message: str) -> bool:
    """رسالة نصية — بترجع نجاح/فشل وبتطبع السبب، من غير ما ترمي أخطاء"""
    to = normalize_phone(phone)
    cfg = await _settings(company_id)
    if not to or not cfg:
        return False
    instance, token = cfg
    try:
        res = await asyncio.to_thread(_post,
            f"https://api.ultramsg.com/{instance}/messages/chat",
            {"token": token, "to": to, "body": message})
        ok = str(res.get("sent", "")).lower() == "true" or res.get("message") == "ok"
        print(f"📲 واتساب → {to}: {'✅' if ok else '⚠ ' + str(res)[:120]}")
        return ok
    except Exception as e:
        print(f"⚠ واتساب فشل ({to}): {type(e).__name__}: {e}")
        return False


async def send_document(company_id: str, phone: str | None,
                        filename: str, b64: str, caption: str = "") -> bool:
    """إرسال مستند (PDF) بترميز base64"""
    to = normalize_phone(phone)
    cfg = await _settings(company_id)
    if not to or not cfg:
        return False
    instance, token = cfg
    try:
        res = await asyncio.to_thread(_post,
            f"https://api.ultramsg.com/{instance}/messages/document",
            {"token": token, "to": to, "filename": filename,
             "document": b64, "caption": caption})
        ok = str(res.get("sent", "")).lower() == "true" or res.get("message") == "ok"
        print(f"📲 واتساب مستند → {to}: {'✅' if ok else '⚠ ' + str(res)[:120]}")
        return ok
    except Exception as e:
        print(f"⚠ واتساب مستند فشل ({to}): {type(e).__name__}: {e}")
        return False
