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

def _load_api_key() -> str:
    """المفتاح من البيئة، ولو غايب يُقرأ من backend/.env مباشرة — حل جذري لكل طرق التشغيل"""
    key = os.getenv("ANTHROPIC_API_KEY", "")
    if key:
        return key
    try:
        from pathlib import Path
        env_path = Path(__file__).resolve().parents[3] / ".env"
        for line in env_path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if line.startswith("ANTHROPIC_API_KEY="):
                return line.split("=", 1)[1].strip().strip(chr(34)).strip(chr(39))
    except Exception:
        pass
    return ""


ANTHROPIC_API_KEY = _load_api_key()
ANTHROPIC_URL = "https://api.anthropic.com/v1/messages"


def _load_env_key(name: str) -> str:
    """قراءة أي مفتاح من البيئة أو backend/.env — نفس منطق مفتاح أنثروبيك"""
    val = os.getenv(name, "")
    if val:
        return val
    try:
        from pathlib import Path
        env_path = Path(__file__).resolve().parents[3] / ".env"
        for line in env_path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if line.startswith(name + "="):
                return line.split("=", 1)[1].strip().strip(chr(34)).strip(chr(39))
    except Exception:
        pass
    return ""


# ═══ Plate Recognizer — واجهة متخصصة تقرأ رقم اللوحة فقط (لا علاقة لها بنوع السيارة) ═══
PLATE_RECOGNIZER_URL = "https://api.platerecognizer.com/v1/plate-reader/"
PLATE_RECOGNIZER_TOKEN = _load_env_key("PLATE_RECOGNIZER_TOKEN")

# ═══ Google Cloud Vision — قراءة نص عامة (OCR)؛ نستخرج اللوحة من النص بأنفسنا ═══
GOOGLE_VISION_URL = "https://vision.googleapis.com/v1/images:annotate"
GOOGLE_VISION_API_KEY = _load_env_key("GOOGLE_VISION_API_KEY")

# نموذج كلود المستخدم كقراءة احتياطية فقط لو فشل الاتصال بالمتخصص
CLAUDE_FALLBACK_MODEL = os.getenv("Z8_PR_FALLBACK_MODEL", "claude-fable-5")

# خريطة حروف اللوحة السعودية: اللاتيني → العربي (الاعتماد الرسمي)
_SA_LETTERS = {
    "A": "أ", "B": "ب", "J": "ح", "D": "د", "R": "ر", "S": "س", "X": "ص",
    "T": "ط", "E": "ع", "G": "ق", "K": "ك", "L": "ل", "Z": "م", "N": "ن",
    "H": "هـ", "U": "و", "V": "ي",
}

# ═══ نموذج القراءة — قابل للاختيار من الإعدادات ويُحفظ بشكل دائم ═══
AVAILABLE_MODELS = {
    "google-vision":              "Google Cloud Vision — قراءة نص عامة (بديل)",
    "plate-recognizer":          "Plate Recognizer — متخصص قراءة اللوحات فقط (موصى به)",
    "claude-fable-5":            "Fable 5 — ذكاء عام، الأقوى والأدق",
    "claude-opus-4-8":           "Opus 4.8 — دقة عالية",
    "claude-sonnet-4-6":         "Sonnet 4.6 — متوازن",
    "claude-haiku-4-5-20251001": "Haiku 4.5 — الأسرع والأوفر",
}
_MODEL_FILE = os.path.join(os.path.dirname(__file__), "vision_model.txt")


def _load_saved_model() -> str:
    try:
        with open(_MODEL_FILE, encoding="utf-8") as f:
            m = f.read().strip()
            if m in AVAILABLE_MODELS:
                return m
    except Exception:
        pass
    return os.getenv("Z8_VISION_MODEL", "plate-recognizer")


def set_model(model_id: str) -> bool:
    """تغيير نموذج القراءة فوراً + حفظه بشكل دائم"""
    global FAST_MODEL, ACCURATE_MODEL
    if model_id not in AVAILABLE_MODELS:
        return False
    FAST_MODEL = ACCURATE_MODEL = model_id
    try:
        with open(_MODEL_FILE, "w", encoding="utf-8") as f:
            f.write(model_id)
    except Exception:
        pass
    print(f"🧠 نموذج قراءة اللوحات: {AVAILABLE_MODELS[model_id]}", flush=True)
    return True


def get_model() -> str:
    return FAST_MODEL


FAST_MODEL = ACCURATE_MODEL = _load_saved_model()

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
  "issues": "جملة واحدة قصيرة جداً — في سطر واحد، بلا علامات تنصيص وبلا أسطر جديدة"
}"""


class VisionError(Exception):
    pass


def _split_plate_text(raw: str):
    """يفصل حروف اللوحة عن أرقامها مهما كان ترتيبهم في النص الخام.
    اللوحة السعودية = 3 حروف + حتى 4 أرقام؛ الترتيب في رد أي قارئ غير مضمون
    (رأينا حالات بالأرقام أولاً)، لذا نجمع كل نوع على حدة."""
    s = raw.lower()
    letters = "".join(ch for ch in s if ch.isalpha())
    digits = "".join(ch for ch in s if ch.isdigit())
    return letters, digits


def _fix3_letters(letters: str) -> str:
    """اللوحة السعودية 3 حروف دائماً. بعض القرّاءات تلتقط العلم/الرمز كحرف رابع
    (مثال حقيقي: hjxj)، فنُسقط أي تكرار متجاور ثم نأخذ أول 3."""
    out = []
    for ch in letters:
        if out and out[-1] == ch:   # حرف مكرر ملاصق = ضوضاء غالباً
            continue
        out.append(ch)
    cleaned = "".join(out)
    return (cleaned or letters)[:3]


def _valid_plate(letters: str, digits: str) -> bool:
    return (len(letters) == 3 and all(c.upper() in _SA_LETTERS for c in letters)
            and 1 <= len(digits) <= 4)


def _best_candidate(tries):
    """من قائمة (نص_خام, ثقة) يرجع (letters_en, digits, score, noisy) لأفضل
    مرشح صالح — الأطول أرقاماً أولاً ثم الأعلى ثقة. تُستخدم من كل القرّاءات
    (Plate Recognizer وGoogle Vision) لضمان نفس منطق الاختيار والتحقق."""
    valid = []
    for raw, score in tries:
        letters, digits = _split_plate_text(raw)
        fixed = _fix3_letters(letters)
        if _valid_plate(fixed, digits):
            valid.append((fixed, digits, score, len(letters) != 3))
    if valid:
        valid.sort(key=lambda t: (len(t[1]), t[2]), reverse=True)
        return valid[0]
    if tries:
        raw, score = tries[0]
        letters, digits = _split_plate_text(raw)
        return _fix3_letters(letters), digits[:4], score, True
    return "", "", 0.0, True


def _plate_result(letters_en: str, digits: str, score: float, noisy: bool,
                  model: str, raw_debug: str = "") -> Dict[str, Any]:
    """يبني قاموس النتيجة الموحّد (نفس الشكل من أي قارئ)."""
    issues = "قراءة غير مؤكدة — راجع الرقم إن لزم" if noisy else ""
    letters_ar = " ".join(_SA_LETTERS.get(ch.upper(), "") for ch in letters_en).strip()
    return {
        "plate_ar": f"{letters_ar} {digits}".strip(),
        "plate_en": f"{letters_en.upper()} {digits}".strip(),
        "letters_ar": letters_ar.replace(" ", ""),
        "digits": digits,
        "confidence": score,
        "plate_found": bool(letters_en and digits),
        "issues": issues,
        "_model": model,
        "_raw": raw_debug[:1000],
    }


async def _call_plate_recognizer(image_bytes: bytes, media_type: str, filename: str) -> Dict[str, Any]:
    """قراءة متخصصة: ترجع رقم اللوحة فقط بنفس شكل مخرجات كلود — باقي النظام لا يتغير"""
    if not PLATE_RECOGNIZER_TOKEN:
        raise VisionError("PLATE_RECOGNIZER_TOKEN غير مضبوط في backend/.env")
    # config يوجّه المحرك لصيغة اللوحة السعودية: 3-4 أرقام + 3 حروف.
    # text_formats قوائم regex تمنع إسقاط الرقم الرابع (1777 بدل 177)؛
    # zoom_in_vehicles يكبّر السيارة لقراءة أدق للوحة.
    # ── لماذا لا يوجد region:strict هنا؟ ──
    # كان مفعّلاً سابقاً، لكنه يفرض التزاماً بقالب الشركة الرسمي للمنطقة بدل
    # تنسيقنا المخصص (text_formats) — ورأينا حالة متكررة وثابتة (نفس اللوحة،
    # نفس النتيجة الناقصة كل مرة): "1288" تُقرأ "128" باستمرار. الاحتمال الأقوى
    # أن القالب الصارم كان يفضّل القراءة الأكثر توافقاً معه (3 أرقام) على القراءة
    # الأدق (4 أرقام). التحقق من الصيغة الصحيحة بقي بأيدينا في _valid() أدناه،
    # فلا حاجة لصرامة إضافية من الخادم قد تُسقط قراءة صحيحة.
    # threshold_o: عتبة ثقة قراءة الحروف/الأرقام (افتراضي أعلى من هذا) — خفضناها
    # فيحتفظ المحرك بحرف/رقم ضعيف الوضوح (كرقم مكرر باهت) بدل تجاهله تماماً،
    # وهو ما يفسّر إسقاط الرقم الرابع بثبات في نفس اللوحة تحديداً.
    pr_config = ('{"text_formats":["[0-9]{3,4}[a-z]{3}","[a-z]{3}[0-9]{3,4}"],'
                 '"zoom_in_vehicles":4,"threshold_o":0.3}')
    async with httpx.AsyncClient(timeout=30.0) as client:
        r = await client.post(
            PLATE_RECOGNIZER_URL,
            headers={"Authorization": f"Token {PLATE_RECOGNIZER_TOKEN}"},
            # camera_id يظهر في لوحة تحكم Plate Recognizer — إحصائيات لكل كاميرا
            data={"regions": "sa", "config": pr_config,
                  "camera_id": (filename or "gate").rsplit(".", 1)[0][:60]},
            files={"upload": (filename or "gate.jpg", image_bytes, media_type)},
        )
    if r.status_code not in (200, 201):
        raise VisionError(f"Plate Recognizer {r.status_code}: {r.text[:300]}")
    data = r.json()
    results = data.get("results") or []
    if not results:
        return {"plate_ar": "", "plate_en": "", "letters_ar": "", "digits": "",
                "confidence": 0.0, "plate_found": False,
                "issues": "لم تُرصد لوحة في اللقطة",
                "_model": "plate-recognizer", "_raw": str(data)[:1000]}

    # نبني قائمة المرشحين: أفضل نتيجة أولاً ثم بدائلها، ونختار أفضلهم عبر
    # نفس منطق الاختيار المشترك (_best_candidate) المستخدم في كل القرّاءات.
    best = max(results, key=lambda x: float(x.get("score") or 0))
    tries = []
    for c in (best.get("candidates") or [{"plate": best.get("plate"), "score": best.get("score")}]):
        tries.append((c.get("plate") or "", float(c.get("score") or 0)))
    if not tries:
        tries = [(best.get("plate") or "", float(best.get("score") or 0))]

    letters_en, digits, score, noisy = _best_candidate(tries)
    return _plate_result(letters_en, digits, score, noisy, "plate-recognizer", str(data))


async def _call_google_vision(image_bytes: bytes, media_type: str, filename: str) -> Dict[str, Any]:
    """قراءة عبر Google Cloud Vision (TEXT_DETECTION) — محرك OCR عام، يرجع كل
    النص في الصورة (اسم الشركة المصنّعة، KSA، أرقام هيكل... إلخ)، فنفلتر
    نحن السطر/الكلمة التي تطابق شكل اللوحة السعودية (3 حروف + حتى 4 أرقام)
    من بين كل النصوص المكتشفة، بنفس منطق الاختيار المشترك مع Plate Recognizer.
    """
    import base64
    import re as _re2

    if not GOOGLE_VISION_API_KEY:
        raise VisionError("GOOGLE_VISION_API_KEY غير مضبوط في backend/.env")

    image_b64 = base64.b64encode(image_bytes).decode("ascii")
    payload = {
        "requests": [{
            "image": {"content": image_b64},
            "features": [{"type": "TEXT_DETECTION"}],
            "imageContext": {"languageHints": ["en"]},  # نريد الصف الإنجليزي من اللوحة
        }]
    }
    async with httpx.AsyncClient(timeout=30.0) as client:
        r = await client.post(
            f"{GOOGLE_VISION_URL}?key={GOOGLE_VISION_API_KEY}",
            json=payload,
        )
    if r.status_code not in (200, 201):
        raise VisionError(f"Google Vision {r.status_code}: {r.text[:300]}")

    data = r.json()
    resp0 = (data.get("responses") or [{}])[0]
    if resp0.get("error"):
        raise VisionError(f"Google Vision: {resp0['error'].get('message', '')[:300]}")

    annotations = resp0.get("textAnnotations") or []
    if not annotations:
        return {"plate_ar": "", "plate_en": "", "letters_ar": "", "digits": "",
                "confidence": 0.0, "plate_found": False,
                "issues": "لم يُرصد أي نص في اللقطة",
                "_model": "google-vision", "_raw": str(data)[:1000]}

    # العنصر الأول هو النص الكامل المدموج؛ الباقي كلمات/أسطر مفردة بمواقعها.
    # نبحث بين كل هذه القطع (مجتمعة وبمفردها) عن أفضل نص يطابق شكل اللوحة.
    full_text = annotations[0].get("description", "") or ""
    pieces = [full_text] + [a.get("description", "") for a in annotations[1:]]

    # أنماط محتملة: تسلسل متلاصق (KUR4733) أو مسافة/شرطة بين الحروف والأرقام
    pattern = _re2.compile(r"([A-Za-z]{3})[\s\-]?(\d{1,4})|(\d{1,4})[\s\-]?([A-Za-z]{3})")
    tries = []
    for piece in pieces:
        for m in pattern.finditer(piece):
            if m.group(1):
                tries.append((f"{m.group(1)}{m.group(2)}", 0.9))
            else:
                tries.append((f"{m.group(4)}{m.group(3)}", 0.9))
    if not tries:
        # لا نمط واضح — نمرر النص الكامل لمحاولة أخيرة عبر منطق الفصل العام
        tries = [(full_text, 0.4)]

    letters_en, digits, score, noisy = _best_candidate(tries)
    return _plate_result(letters_en, digits, score, noisy, "google-vision", str(data))


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
        "max_tokens": 2500,  # Fable 5 يفكر داخلياً قبل الإجابة — التفكير يُحسب من الحد،
        # فالحد الصغير كان يستنفد قبل كتابة الرد ويرجع فارغاً
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

    # قراءة أول كائن JSON صحيح فقط — يتجاهل أي نص/كائن زائد بعده مهما كان شكله
    # (سبب "Extra data": Claude أحياناً يضيف شرح أو كائن ثانٍ بعد الرد المطلوب)
    start = clean.find("{")
    if start == -1:
        stop = data.get("stop_reason", "?")
        raise VisionError(f"رد غير قابل للقراءة (stop={stop}): {clean[:200]}")
    try:
        parsed, _end_index = json.JSONDecoder().raw_decode(clean, start)
    except json.JSONDecodeError:
        # ═══ محلّل احتياطي: لو JSON مكسور (اقتباس داخل نص مثلاً)
        #     نستخرج الحقول المهمة بالـregex — لا تضيع قراءة بسبب صياغة ═══
        import re as _re3

        def _grab(field, default=""):
            m = _re3.search(rf'"{field}"\s*:\s*"([^"]*)"', clean)
            return m.group(1) if m else default

        def _grab_num(field, default=0.0):
            m = _re3.search(rf'"{field}"\s*:\s*([0-9.]+)', clean)
            try:
                return float(m.group(1)) if m else default
            except ValueError:
                return default

        digits_v = _grab("digits")
        if digits_v or _grab("plate_en"):
            parsed = {
                "plate_ar": _grab("plate_ar"),
                "plate_en": _grab("plate_en"),
                "letters_ar": _grab("letters_ar"),
                "digits": digits_v,
                "confidence": _grab_num("confidence", 0.0),
                "plate_found": '"plate_found": true' in clean.replace(" ", ""),
                "issues": "أُنقذ بالمحلل الاحتياطي",
            }
            print("🩹 JSON مكسور — أُنقذت القراءة بالمحلل الاحتياطي", flush=True)
            return parsed
        raise VisionError(f"فشل تحليل الصورة (JSON مكسور بلا حقول): {clean[:150]}")
    except Exception as e:
        raise VisionError(f"فشل تحليل الصورة: {e}\nالرد: {clean[:300]}")

    parsed["_model"] = model
    parsed["_raw"] = clean[:1000]
    return parsed


async def read_plate(image_bytes: bytes, filename: str = "") -> Dict[str, Any]:
    """
    يقرأ اللوحة من صورة. يرجع dict فيه plate_ar / confidence / _model
    """
    media_type = _guess_media_type(image_bytes, filename)

    # ═══ المسار المتخصص: Plate Recognizer — رقم اللوحة فقط ═══
    if FAST_MODEL == "plate-recognizer":
        try:
            return await _call_plate_recognizer(image_bytes, media_type, filename)
        except Exception as e:
            # فشل اتصال/مفتاح/حصة → قراءة احتياطية بكلود لو مفتاحه موجود، والحدث يوضّح ذلك
            log.warning("فشل Plate Recognizer (%s) — التحويل للقراءة الاحتياطية", e)
            if not ANTHROPIC_API_KEY:
                return {"plate_ar": "", "plate_en": "", "letters_ar": "", "digits": "",
                        "confidence": 0.0, "plate_found": False,
                        "issues": f"تعذّرت القراءة: {e}", "_model": "plate-recognizer"}
            image_b64 = base64.b64encode(image_bytes).decode("ascii")
            fb = await _call_model(CLAUDE_FALLBACK_MODEL, image_b64, media_type)
            fb["issues"] = ((fb.get("issues") or "").strip() + " (قراءة احتياطية بكلود)").strip()
            return fb

    # ═══ مسار Google Cloud Vision (لما يكون هو القارئ المختار) ═══
    if FAST_MODEL == "google-vision":
        try:
            return await _call_google_vision(image_bytes, media_type, filename)
        except Exception as e:
            log.warning("فشل Google Vision (%s) — التحويل للقراءة الاحتياطية", e)
            if not ANTHROPIC_API_KEY:
                return {"plate_ar": "", "plate_en": "", "letters_ar": "", "digits": "",
                        "confidence": 0.0, "plate_found": False,
                        "issues": f"تعذّرت القراءة: {e}", "_model": "google-vision"}
            image_b64 = base64.b64encode(image_bytes).decode("ascii")
            fb = await _call_model(CLAUDE_FALLBACK_MODEL, image_b64, media_type)
            fb["issues"] = ((fb.get("issues") or "").strip() + " (قراءة احتياطية بكلود)").strip()
            return fb

    # ═══ مسار كلود (لما يكون هو القارئ المختار) ═══
    if not ANTHROPIC_API_KEY:
        raise VisionError("ANTHROPIC_API_KEY غير مضبوط في متغيرات البيئة")

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
