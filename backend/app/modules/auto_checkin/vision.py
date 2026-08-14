"""
Z8 - قراءة لوحة السيارة عبر Claude Vision
==========================================
نظام من مرحلتين لتوفير التكلفة مع الحفاظ على الدقة:
  1. Haiku  — سريع ورخيص، يقرأ 90% من اللقطات
  2. Sonnet — يُستدعى فقط لو ثقة Haiku أقل من الحد الأدنى
"""

import os
import json
import base64
import logging
from typing import Optional, Dict, Any

import httpx

log = logging.getLogger("z8.gate.vision")

ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY", "")
ANTHROPIC_URL = "https://api.anthropic.com/v1/messages"

FAST_MODEL = os.getenv("Z8_VISION_FAST_MODEL", "claude-haiku-4-5-20251001")
ACCURATE_MODEL = os.getenv("Z8_VISION_ACCURATE_MODEL", "claude-sonnet-5")

# لو ثقة النموذج السريع أقل من كده، نعيد المحاولة بالنموذج الأدق
ESCALATE_BELOW = float(os.getenv("Z8_VISION_ESCALATE_BELOW", "0.80"))

PROMPT = """أنت نظام قراءة لوحات مركبات سعودية في مركز خدمة سيارات.

اقرأ لوحة المركبة الظاهرة في الصورة.

قواعد مهمة:
- اللوحة السعودية = 3 حروف عربية + من 1 إلى 4 أرقام.
- الحروف العربية المسموحة فقط: أ ب ح د ر س ص ط ع ق ك ل م ن هـ و ي
- اقرأ الجزء العربي من اللوحة (الأعلى) والجزء الإنجليزي (الأسفل) وتحقق أنهما متطابقان.
- تجاهل كلمة KSA والعلم والإطار.
- لو الصورة غير واضحة أو لا توجد لوحة، أرجع confidence منخفضة جداً.

أرجع JSON فقط بدون أي نص إضافي وبدون علامات markdown:
{
  "plate_ar": "الحروف والأرقام كما تظهر بالعربي، مثال: أ ب ح 1234",
  "plate_en": "المقابل الإنجليزي، مثال: ABJ 1234",
  "letters_ar": "الحروف الثلاثة فقط",
  "digits": "الأرقام فقط",
  "confidence": 0.0,
  "plate_found": true,
  "issues": "أي ملاحظة عن وضوح الصورة أو الإضاءة"
}"""


class VisionError(Exception):
    pass


def _guess_media_type(image_bytes: bytes, filename: str = "") -> str:
    if image_bytes[:3] == b"\xff\xd8\xff":
        return "image/jpeg"
    if image_bytes[:8] == b"\x89PNG\r\n\x1a\n":
        return "image/png"
    if image_bytes[:4] == b"RIFF" and image_bytes[8:12] == b"WEBP":
        return "image/webp"
    ext = (filename.rsplit(".", 1)[-1] or "").lower()
    return {"png": "image/png", "webp": "image/webp"}.get(ext, "image/jpeg")


async def _call_model(model: str, image_b64: str, media_type: str) -> Dict[str, Any]:
    headers = {
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
    }
    payload = {
        "model": model,
        "max_tokens": 400,
        "messages": [{
            "role": "user",
            "content": [
                {"type": "image", "source": {
                    "type": "base64", "media_type": media_type, "data": image_b64}},
                {"type": "text", "text": PROMPT},
            ],
        }],
    }

    async with httpx.AsyncClient(timeout=30.0) as client:
        r = await client.post(ANTHROPIC_URL, headers=headers, json=payload)

    if r.status_code != 200:
        raise VisionError(f"Vision API {r.status_code}: {r.text[:300]}")

    data = r.json()
    text = "".join(b.get("text", "") for b in data.get("content", []) if b.get("type") == "text")
    clean = text.replace("```json", "").replace("```", "").strip()

    try:
        parsed = json.loads(clean)
    except json.JSONDecodeError:
        start, end = clean.find("{"), clean.rfind("}")
        if start == -1 or end == -1:
            raise VisionError(f"رد غير قابل للقراءة: {clean[:200]}")
        parsed = json.loads(clean[start:end + 1])

    parsed["_model"] = model
    parsed["_raw"] = clean[:1000]
    return parsed


async def read_plate(image_bytes: bytes, filename: str = "") -> Dict[str, Any]:
    """
    يقرأ اللوحة من صورة. يرجع dict فيه plate_ar / confidence / _model
    """
    if not ANTHROPIC_API_KEY:
        raise VisionError("ANTHROPIC_API_KEY غير مضبوط في متغيرات البيئة")

    media_type = _guess_media_type(image_bytes, filename)
    image_b64 = base64.b64encode(image_bytes).decode("ascii")

    # المرحلة 1: النموذج السريع
    try:
        result = await _call_model(FAST_MODEL, image_b64, media_type)
    except Exception as e:
        log.warning("فشل النموذج السريع (%s)، التحويل للنموذج الأدق", e)
        return await _call_model(ACCURATE_MODEL, image_b64, media_type)

    conf = float(result.get("confidence") or 0)
    found = bool(result.get("plate_found", True))

    # المرحلة 2: تصعيد عند ضعف الثقة
    if found and conf < ESCALATE_BELOW:
        log.info("ثقة منخفضة %.2f — تصعيد إلى %s", conf, ACCURATE_MODEL)
        try:
            better = await _call_model(ACCURATE_MODEL, image_b64, media_type)
            if float(better.get("confidence") or 0) >= conf:
                better["_escalated"] = True
                return better
        except Exception as e:
            log.warning("فشل التصعيد: %s", e)

    return result
