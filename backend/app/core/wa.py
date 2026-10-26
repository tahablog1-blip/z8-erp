"""وحدة واتساب (UltraMsg) — إشعارات العميل وإرسال الفاتورة.
الإعداد يُخزَّن في جدول companies (عمودا wa_instance / wa_token).
كل الإرسال fire-and-forget: فشل الواتساب لا يُفشل العملية الأصلية أبداً."""
from __future__ import annotations
import asyncio, json, urllib.error, urllib.request, urllib.parse
import time
from .config import settings
from .db import fetchrow
from .integration_log import log_event


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


# ══════════════ بوابة واتساب المحلية (whatsapp-web.js) ══════════════

def gateway_enabled() -> bool:
    return bool(settings.WA_GATEWAY_URL and settings.WA_GATEWAY_KEY)


def _gw_call(method: str, path: str, data: dict | None = None, timeout: int = 20) -> tuple[int, dict]:
    body = json.dumps(data).encode() if data is not None else None
    req = urllib.request.Request(settings.WA_GATEWAY_URL.rstrip("/") + path, data=body, method=method,
        headers={"x-api-key": settings.WA_GATEWAY_KEY, "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, json.loads(r.read().decode() or "{}")
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read().decode() or "{}")
        except Exception:
            return e.code, {}


_status_cache: dict = {"at": 0.0, "val": {"state": "unreachable"}}


async def gateway_status(fresh: bool = False) -> dict:
    """حالة البوابة: starting | qr | ready | disconnected | unreachable (مخزّنة 5 ثواني)"""
    if not gateway_enabled():
        return {"state": "disabled"}
    if not fresh and time.time() - _status_cache["at"] < 5:
        return _status_cache["val"]
    try:
        code, d = await asyncio.to_thread(_gw_call, "GET", "/status", None, 4)
        val = d if code == 200 and d.get("state") else {"state": "unreachable"}
    except Exception:
        val = {"state": "unreachable"}
    _status_cache.update(at=time.time(), val=val)
    return val


async def gateway_qr() -> str | None:
    try:
        code, d = await asyncio.to_thread(_gw_call, "GET", "/qr", None, 4)
        return d.get("qr") if code == 200 else None
    except Exception:
        return None


async def gateway_logout() -> bool:
    try:
        code, _ = await asyncio.to_thread(_gw_call, "POST", "/logout", {}, 15)
        _status_cache["at"] = 0.0
        return code == 200
    except Exception:
        return False


async def _gw_send(company_id: str, event: str, label: str, path: str, payload: dict) -> bool:
    try:
        code, d = await asyncio.to_thread(_gw_call, "POST", path, payload, 60)
        ok = code == 200
        reason = {"not_on_whatsapp": "الرقم مالوش واتساب", "not_ready": "واتساب غير مربوط — امسح الـ QR",
                  "daily_limit": "تعدّى الحد اليومي للرسائل"}.get(d.get("error", ""), d.get("error", ""))
        print(f"📲 واتساب (بوابة) → {label}: {'✅' if ok else '⚠ ' + str(code) + ' ' + reason}")
        await log_event(company_id, "whatsapp", event, "success" if ok else "failed",
                        detail=f"إلى {label}" + ("" if ok else f" — {reason or code}"))
        return ok
    except Exception as e:
        print(f"⚠ واتساب (بوابة) فشل ({label}): {type(e).__name__}: {e}")
        await log_event(company_id, "whatsapp", event, "failed", detail=f"إلى {label} — بوابة واتساب لا تستجيب")
        return False


async def _settings(company_id: str) -> tuple[str, str] | None:
    row = await fetchrow(
        "SELECT wa_instance, wa_token FROM companies WHERE id=$1", company_id)
    if not row or not row["wa_instance"] or not row["wa_token"]:
        return None
    instance = row["wa_instance"].strip().strip("/")
    # اسم الـ instance في UltraMsg بيبدأ بكلمة instance — لو اتخزّنت الأرقام بس نكمّلها
    if instance.isdigit():
        instance = "instance" + instance
    return instance, row["wa_token"].strip()


def _post(url: str, data: dict) -> dict:
    body = urllib.parse.urlencode(data).encode()
    # User-Agent صريح: بعض واجهات واتساب (خلف Cloudflare) بتحجب "Python-urllib" الافتراضي بـ 403
    req = urllib.request.Request(url, data=body, headers={
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": "Mozilla/5.0 (compatible; Z8-ERP/1.0)",
        "Accept": "application/json",
    })
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            return json.loads(r.read().decode() or "{}")
    except urllib.error.HTTPError as e:
        # نقرأ جسم الرد عشان السبب الحقيقي (توكن غلط/instance متوقف/اشتراك...) يظهر في السجل
        detail = ""
        try:
            detail = e.read().decode("utf-8", "replace")[:200]
        except Exception:
            pass
        raise RuntimeError(f"HTTP {e.code} {detail}".strip()) from None


async def send_text(company_id: str, phone: str | None, message: str) -> bool:
    """رسالة نصية — بترجع نجاح/فشل وبتطبع السبب، من غير ما ترمي أخطاء"""
    to = normalize_phone(phone)
    if gateway_enabled() and to:
        return await _gw_send(company_id, "send_text", to, "/send", {"to": to, "message": message})
    cfg = await _settings(company_id)
    if not to or not cfg:
        await log_event(company_id, "whatsapp", "send_text", "skipped",
                        detail=("رقم غير صالح" if not to else "لم تُضبط مفاتيح واتساب"))
        return False
    instance, token = cfg
    try:
        res = await asyncio.to_thread(_post,
            f"https://api.ultramsg.com/{instance}/messages/chat",
            {"token": token, "to": to, "body": message})
        ok = str(res.get("sent", "")).lower() == "true" or res.get("message") == "ok"
        print(f"📲 واتساب → {to}: {'✅' if ok else '⚠ ' + str(res)[:120]}")
        await log_event(company_id, "whatsapp", "send_text", "success" if ok else "failed",
                        detail=f"إلى {to}" + ("" if ok else f" — {str(res)[:200]}"))
        return ok
    except Exception as e:
        print(f"⚠ واتساب فشل ({to}): {type(e).__name__}: {e}")
        await log_event(company_id, "whatsapp", "send_text", "failed", detail=f"إلى {to} — {e}")
        return False


async def send_document(company_id: str, phone: str | None,
                        filename: str, b64: str, caption: str = "") -> bool:
    """إرسال مستند (PDF) بترميز base64"""
    to = normalize_phone(phone)
    if gateway_enabled() and to:
        return await _gw_send(company_id, "send_document", f"{to} ({filename})", "/send-document",
                              {"to": to, "filename": filename, "b64": b64, "caption": caption})
    cfg = await _settings(company_id)
    if not to or not cfg:
        await log_event(company_id, "whatsapp", "send_document", "skipped",
                        detail=("رقم غير صالح" if not to else "لم تُضبط مفاتيح واتساب"))
        return False
    instance, token = cfg
    try:
        res = await asyncio.to_thread(_post,
            f"https://api.ultramsg.com/{instance}/messages/document",
            {"token": token, "to": to, "filename": filename,
             "document": b64, "caption": caption})
        ok = str(res.get("sent", "")).lower() == "true" or res.get("message") == "ok"
        print(f"📲 واتساب مستند → {to}: {'✅' if ok else '⚠ ' + str(res)[:120]}")
        await log_event(company_id, "whatsapp", "send_document", "success" if ok else "failed",
                        detail=f"إلى {to} ({filename})" + ("" if ok else f" — {str(res)[:200]}"))
        return ok
    except Exception as e:
        print(f"⚠ واتساب مستند فشل ({to}): {type(e).__name__}: {e}")
        await log_event(company_id, "whatsapp", "send_document", "failed", detail=f"إلى {to} ({filename}) — {e}")
        return False
