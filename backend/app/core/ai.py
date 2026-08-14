# core/ai.py — وحدة الذكاء المركزية (نداءات نصية ورؤية عبر urllib — بدون اعتماديات)
import asyncio
import json
import urllib.request

from .config import settings

_MODEL = "claude-haiku-4-5-20251001"
_URL = "https://api.anthropic.com/v1/messages"


def _key() -> str:
    key = (settings.ANTHROPIC_API_KEY or "").strip()
    if not key:
        raise RuntimeError("خدمة الذكاء غير مفعّلة — راجع ANTHROPIC_API_KEY في backend/.env")
    return key


def _call(payload: dict) -> str:
    req = urllib.request.Request(
        _URL, data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json",
                 "x-api-key": _key(), "anthropic-version": "2023-06-01"})
    with urllib.request.urlopen(req, timeout=60) as resp:
        data = json.loads(resp.read().decode())
    return "".join(b.get("text", "") for b in data.get("content", []) if b.get("type") == "text")


async def ask_text(prompt: str, max_tokens: int = 700) -> str:
    payload = {"model": _MODEL, "max_tokens": max_tokens,
               "messages": [{"role": "user", "content": prompt}]}
    return await asyncio.to_thread(_call, payload)


def extract_json(text: str):
    """يلقط أول JSON صالح من رد الموديل (كائن أو مصفوفة)"""
    import re
    m = re.search(r"[\[{][\s\S]*[\]}]", text)
    if not m:
        raise ValueError("لم يُرجِع الذكاء صيغة صالحة")
    return json.loads(m.group(0))
