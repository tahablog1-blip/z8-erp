#!/usr/bin/env python3
"""يبني خط الأيقونات المحلي (Material Symbols Rounded) من الأيقونات المستخدمة فعلاً في الكود.

يُشغَّل عند إضافة أيقونة جديدة لم تكن في frontend/public/fonts/icons.json:
    python3 tools/build-icon-font.py

المتطلبات: python3 + fonttools + brotli (pip install fonttools brotli) واتصال بالإنترنت وقت البناء فقط.
يقرأ قائمة أسماء الأيقونات الرسمية من بيانات جوجل، ويحصر المستخدم منها
(أي نص بين علامتي اقتباس في frontend/src أو backend/app يطابق اسم أيقونة)، ثم يجلب الخط الجزئي من خدمة جوجل
بنسختين: عادي (FILL=0) وممتلئ (FILL=1)، ويحوّلهما إلى woff2 داخل frontend/public/fonts.
بعد التشغيل ارفع رقم ?v= في globals.css و layout.tsx ليتجدد الكاش.
"""
import json, os, re, subprocess, sys, tempfile, urllib.error, urllib.parse, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "frontend", "public", "fonts")
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120 Safari/537.36"
COMMON = ("add close check search menu home settings person edit delete save refresh download upload print share info warning error done "
          "arrow_back arrow_forward arrow_drop_down expand_more expand_less chevron_left chevron_right more_vert more_horiz visibility visibility_off "
          "lock lock_open star favorite call mail notifications schedule event calendar_today directions_car build oil_barrel local_gas_station receipt_long "
          "inventory_2 payments account_balance_wallet shopping_cart sell category tune filter_list sort list grid_view dashboard bar_chart pie_chart "
          "trending_up trending_down photo_camera videocam qr_code qr_code_scanner badge group groups apartment store storefront local_shipping cloud sync "
          "wifi location_on near_me map directions help").split()


def official_names() -> set[str]:
    """قائمة جوجل الرسمية لكل أيقونات Material Symbols (أكمل من حزمة npm التي تنقصها أسماء صحيحة مثل expand_less)"""
    raw = urllib.request.urlopen(urllib.request.Request(
        "https://fonts.google.com/metadata/icons?key=material_symbols&incomplete=true", headers={"User-Agent": UA}), timeout=60).read().decode()
    return {x["name"] for x in json.loads(raw[raw.index("{"):])["icons"]}


def used_names(valid: set[str]) -> set[str]:
    lit: set[str] = set()
    explicit: set[str] = set()   # أسماء مكتوبة صراحة في <MIcon name="…"> تُضمَّن دائماً (قائمة الحزمة ناقصة لبعض الأسماء الصحيحة)
    for base, exts in (("frontend/src", (".tsx", ".ts", ".json", ".css")), ("backend/app", (".py",))):
        for root, _, files in os.walk(os.path.join(ROOT, base)):
            for f in files:
                if f.endswith(exts):
                    t = open(os.path.join(root, f), encoding="utf-8", errors="ignore").read()
                    lit |= set(re.findall(r"[\"'`>]([a-z][a-z0-9_]{1,40})[\"'`<]", t))
                    explicit |= set(re.findall(r'MIcon name="([a-z0-9_]+)"', t))
    return ((lit | set(COMMON)) & valid) | explicit


def _css(names: list[str], fill: int) -> str:
    q = urllib.parse.quote(",".join(names), safe=",_")
    css_url = f"https://fonts.googleapis.com/css2?family=Material+Symbols+Rounded:opsz,wght,FILL,GRAD@24,400,{fill},0&icon_names={q}&display=block"
    return urllib.request.urlopen(urllib.request.Request(css_url, headers={"User-Agent": UA}), timeout=30).read().decode()


def drop_unknown(names: list[str]) -> list[str]:
    """جوجل يرفض الطلب كله لو فيه اسم غير موجود — نحدّد الأسماء الخاطئة فردياً ونستبعدها"""
    try:
        _css(names, 0)
        return names
    except urllib.error.HTTPError:
        good = []
        for n in names:
            try:
                _css([n], 0)
                good.append(n)
            except urllib.error.HTTPError:
                print("اسم غير معروف لدى جوجل (استُبعد):", n)
        return good


def fetch_font(names: list[str], fill: int) -> bytes:
    css = _css(names, fill)
    url = re.search(r"url\((https://fonts\.gstatic[^)]*)\)", css).group(1)
    return urllib.request.urlopen(url, timeout=60).read()


def to_woff2(ttf: bytes, path: str):
    from fontTools.ttLib import TTFont
    import io
    f = TTFont(io.BytesIO(ttf))
    f.flavor = "woff2"
    f.save(path)


def main():
    names = sorted(drop_unknown(sorted(used_names(official_names()))))
    print(f"{len(names)} أيقونة مستخدمة")
    os.makedirs(OUT, exist_ok=True)
    to_woff2(fetch_font(names, 0), os.path.join(OUT, "material-symbols-rounded.woff2"))
    to_woff2(fetch_font(names, 1), os.path.join(OUT, "material-symbols-rounded-fill.woff2"))
    json.dump(names, open(os.path.join(OUT, "icons.json"), "w", encoding="utf-8"))
    print("تم: ارفع رقم ?v= في frontend/src/app/globals.css و layout.tsx")


if __name__ == "__main__":
    sys.exit(main())
