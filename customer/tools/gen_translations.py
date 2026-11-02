#!/usr/bin/env python3
"""يولّد lib/core/translations.dart من tools/translations_data.py ويتحقق من التغطية والمتغيرات {0}{1}."""
import json, os, re, sys, glob
here = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, here)
from translations_data import T

LANGS = ("en", "bn", "hi", "ur")
bad = []
for k, v in T.items():
    if len(v) != 4:
        bad.append(("عدد الترجمات", k))
    for tv in v:
        if sorted(re.findall(r"\{\d\}", k)) != sorted(re.findall(r"\{\d\}", tv)):
            bad.append(("المتغيرات", k, tv))
used = set()
for f in glob.glob(os.path.join(here, "..", "lib", "**", "*.dart"), recursive=True):
    if f.endswith("translations.dart"):
        continue
    s = open(f, encoding="utf-8").read()
    for m in re.finditer(r"tr\('((?:[^'\\]|\\.)*)'", s):
        k = m.group(1).replace("\\'", "'").replace("\\$", "$")
        if re.search(r"[؀-ۿ]", k):
            used.add(k)
missing = sorted(used - set(T))
if bad or missing:
    print("أخطاء:", bad, "\nغير مترجم:", missing)
    sys.exit(1)

def q(s):
    return "'" + s.replace("\\", "\\\\").replace("'", "\\'").replace("$", "\\$") + "'"

lines = ["// مولَّد من tools/translations_data.py — لا تعدّله يدوياً (python3 tools/gen_translations.py)",
         "const Map<String, Map<String, String>> kTranslations = {"]
for k in sorted(T):
    lines.append("  %s: {%s}," % (q(k), ", ".join("'%s': %s" % (l, q(t)) for l, t in zip(LANGS, T[k]))))
lines.append("};\n")
open(os.path.join(here, "..", "lib", "core", "translations.dart"), "w", encoding="utf-8").write("\n".join(lines))
print("تم:", len(T), "قالب،", len(used), "مستخدم")
