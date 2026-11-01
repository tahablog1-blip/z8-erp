#!/usr/bin/env bash
# يفحص التزام الواجهة بنظام التصميم الموحد (docs/DESIGN-SYSTEM.md). يُشغَّل في CI وقبل الدمج.
# يفشل عند: ألوان Tailwind الخام، أحجام خطوط مطلقة text-[Npx] (غير الأيقونات !text-)، انحناءات خارج السلم، رموز تعبيرية.
# الاستثناءات: حركات/رسوم خاصة (طباعة متحركة، ثلاثية الأبعاد، لوحة السيارة)، ترجمة i18n، وأيقونة الدور المخزّنة كبيانات.
set -u
cd "$(dirname "$0")/../frontend/src"
EXCL='InvoicePrintAnimation|ServiceBay3D|PlateBadge|lib/i18n|settings/roles/page'
fail=0
check() {  # $1=وصف $2=نمط
  local out; out=$(grep -rnE --include=*.tsx "$2" . 2>/dev/null | grep -Ev "$EXCL" || true)
  if [ -n "$out" ]; then echo "✗ $1"; echo "$out" | head -8; fail=1; fi
}
check "لون Tailwind خام — استخدم رموز النظام (petrol/emerald/brass/ember/ink/text)" '(^|[^A-Za-z0-9_-])(bg|text|border|ring|from|to|via|divide|placeholder)-(slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-[0-9]{2,3}'
check "حجم خط مطلق — استخدم text-t-xs/sm/md/lg/xl/2xl/3xl" '(^|[^A-Za-z0-9_!-])text-\[[0-9.]+px\]'
check "انحناء خارج السلم — استخدم rounded-md/lg/card/full" '(^|[^A-Za-z0-9_-])rounded-(xl|2xl|3xl)([^A-Za-z0-9_-]|$)'
EMO='[\x{1F300}-\x{1FAFF}\x{2600}-\x{27BF}\x{231A}\x{231B}\x{23E9}-\x{23F3}\x{2B50}\x{2B55}\x{25B6}]'
out=$(grep -rnP --include=*.tsx "$EMO" . 2>/dev/null | grep -Ev "$EXCL" | grep -Ev '^\S+:[0-9]+:\s*(//|\*|/\*)' | grep -v 'startsWith(' || true)
if [ -n "$out" ]; then echo "✗ رموز تعبيرية (Emoji) — استخدم MIcon"; echo "$out" | head -8; fail=1; fi
# أيقونات MIcon الثابتة يجب أن تكون ضمن خط الأيقونات المحلي (وإلا ظهر اسمها نصاً) — الإصلاح: python3 tools/build-icon-font.py
ICONS=../public/fonts/icons.json
if [ -f "$ICONS" ]; then
  missing=$(grep -rhoP --include=*.tsx 'MIcon name="\K[a-z0-9_]+' . | sort -u | grep -vxF -f <(tr -d '[]" ' < "$ICONS" | tr ',' '\n') || true)
  if [ -n "$missing" ]; then echo "✗ أيقونات غير موجودة في الخط المحلي (شغّل tools/build-icon-font.py):"; echo "$missing" | head -10; fail=1; fi
fi
[ $fail -eq 0 ] && echo "✓ نظام التصميم: لا مخالفات" || exit 1
