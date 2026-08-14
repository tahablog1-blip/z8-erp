"""
Z8 - أدوات توحيد لوحات السيارات السعودية
=========================================
الهدف: تحويل أي شكل للوحة (عربي / إنجليزي / أرقام هندية / مسافات / شرطات)
إلى مفتاح موحّد ثابت يمكن البحث به في قاعدة البيانات بدقة.

اللوحة السعودية = 3 حروف + (1 إلى 4) أرقام
"""

from dataclasses import dataclass, asdict
from typing import Optional, Dict, Any

# ---------------------------------------------------------------------------
# خرائط الحروف الرسمية المعتمدة من المرور السعودي
# ---------------------------------------------------------------------------
AR_TO_EN: Dict[str, str] = {
    "ا": "A", "أ": "A", "إ": "A", "آ": "A",
    "ب": "B",
    "ح": "J",
    "د": "D",
    "ر": "R",
    "س": "S",
    "ص": "X",
    "ط": "T",
    "ع": "E",
    "ق": "G",
    "ك": "K",
    "ل": "L",
    "م": "Z",
    "ن": "N",
    "ه": "H", "هـ": "H", "ة": "H",
    "و": "U", "ؤ": "U",
    "ي": "V", "ى": "V", "ئ": "V",
}

EN_TO_AR: Dict[str, str] = {
    "A": "أ", "B": "ب", "J": "ح", "D": "د", "R": "ر", "S": "س",
    "X": "ص", "T": "ط", "E": "ع", "G": "ق", "K": "ك", "L": "ل",
    "Z": "م", "N": "ن", "H": "هـ", "U": "و", "V": "ي",
}

VALID_EN_LETTERS = set(EN_TO_AR.keys())

# أرقام هندية / فارسية -> عربية غربية
DIGIT_MAP = str.maketrans(
    "٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹",
    "01234567890123456789",
)


@dataclass
class PlateKey:
    """نتيجة توحيد اللوحة"""
    raw: str            # النص الأصلي كما ورد
    digits: str         # الأرقام فقط  مثال: 1234
    letters_en: str     # الحروف بالإنجليزي مثال: ABJ
    letters_ar: str     # الحروف بالعربي   مثال: أبح
    canonical: str      # المفتاح الأساسي  مثال: 1234-ABJ
    loose: str          # مفتاح متساهل (حروف مرتبة) مثال: 1234-ABJ
    display_ar: str     # للعرض: أ ب ح 1234
    display_en: str     # للعرض: ABJ 1234
    is_valid: bool      # مطابقة للشكل السعودي (3 حروف + أرقام)

    def dict(self) -> Dict[str, Any]:
        return asdict(self)


def normalize_plate(raw: Optional[str]) -> PlateKey:
    """
    يحوّل أي صيغة للوحة إلى مفتاح موحّد.

    أمثلة تعطي نفس النتيجة:
        "أ ب ح 1234"
        "1234 ABJ"
        "ABJ-1234"
        "أ‌بح ١٢٣٤"
    """
    raw = (raw or "").strip()
    if not raw:
        return PlateKey("", "", "", "", "", "", "", "", False)

    text = raw.translate(DIGIT_MAP)

    digits_out = []
    letters_out = []

    i = 0
    while i < len(text):
        ch = text[i]

        # معالجة "هـ" كحرف واحد
        if ch == "ه" and i + 1 < len(text) and text[i + 1] == "ـ":
            letters_out.append("H")
            i += 2
            continue

        if ch.isdigit():
            digits_out.append(ch)
        elif ch in AR_TO_EN:
            letters_out.append(AR_TO_EN[ch])
        elif ch.upper() in VALID_EN_LETTERS:
            letters_out.append(ch.upper())
        # أي شيء آخر (مسافات، شرطات، KSA، رموز) يتم تجاهله
        i += 1

    digits = "".join(digits_out)[:4]
    letters_en = "".join(letters_out)[:3]
    letters_ar = "".join(EN_TO_AR.get(c, c) for c in letters_en)

    canonical = f"{digits}-{letters_en}" if (digits or letters_en) else ""
    loose = f"{digits}-{''.join(sorted(letters_en))}" if (digits or letters_en) else ""

    display_ar = f"{' '.join(letters_ar)} {digits}".strip()
    display_en = f"{letters_en} {digits}".strip()

    is_valid = len(letters_en) == 3 and 1 <= len(digits) <= 4

    return PlateKey(
        raw=raw,
        digits=digits,
        letters_en=letters_en,
        letters_ar=letters_ar,
        canonical=canonical,
        loose=loose,
        display_ar=display_ar,
        display_en=display_en,
        is_valid=is_valid,
    )


def letters_overlap(a: str, b: str) -> int:
    """عدد الحروف المشتركة بين لوحتين (لمقارنة تقريبية)"""
    a_list = list(a)
    count = 0
    for ch in b:
        if ch in a_list:
            a_list.remove(ch)
            count += 1
    return count


def plate_similarity(p1: PlateKey, p2: PlateKey) -> float:
    """
    نسبة تشابه بين لوحتين من 0 إلى 1.
    الأرقام لها وزن 60% والحروف 40% (الأرقام أدق في القراءة الآلية).
    """
    if not p1.canonical or not p2.canonical:
        return 0.0

    # تشابه الأرقام
    d1, d2 = p1.digits, p2.digits
    if d1 == d2:
        digit_score = 1.0
    elif len(d1) == len(d2) and d1 and d2:
        same = sum(1 for x, y in zip(d1, d2) if x == y)
        digit_score = same / len(d1)
    else:
        digit_score = 0.0

    # تشابه الحروف
    l1, l2 = p1.letters_en, p2.letters_en
    letter_score = (letters_overlap(l1, l2) / 3.0) if (l1 and l2) else 0.0

    return round(digit_score * 0.6 + letter_score * 0.4, 3)


if __name__ == "__main__":
    tests = ["أ ب ح 1234", "1234 ABJ", "ABJ-1234", "ب أ ح ١٢٣٤", "هـ ل م 987"]
    for t in tests:
        k = normalize_plate(t)
        print(f"{t:20} -> canonical={k.canonical:12} loose={k.loose:12} valid={k.is_valid}")
