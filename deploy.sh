#!/usr/bin/env bash
# deploy.sh — نشر آخر نسخة من main مع فحص صحة وتراجع تلقائي عند الفشل.
#   bash deploy.sh              نشر main
#   bash deploy.sh --rollback   رجوع يدوي للنسخة السابقة المحفوظة
# متغيرات اختيارية (للاختبار): BUILD_CMD RESTART_CMD HEALTH_URL REF
set -euo pipefail
cd "$(dirname "$0")"

HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:3000/login}"
API_HEALTH_URL="${API_HEALTH_URL:-http://127.0.0.1:4001/api/health}"
RESTART_CMD="${RESTART_CMD:-systemctl restart z8-api z8-web}"
BUILD_CMD="${BUILD_CMD:-npm run build}"
REF="${REF:-origin/main}"
STATE=.deploy-prev          # يحفظ commit السابق

healthy() {
  for i in 1 2 3 4 5 6 7 8 9 10; do
    sleep 3
    if curl -fsS -o /dev/null --max-time 5 "$HEALTH_URL"; then return 0; fi
  done
  return 1
}

restore() {   # $1 = commit سابق
  echo "!! تراجع إلى $1"
  git reset -q --hard "$1"
  if [ -d frontend/.next.prev ]; then
    rm -rf frontend/.next
    mv frontend/.next.prev frontend/.next
  fi
  eval "$RESTART_CMD" || true
  if healthy; then echo "==> تم التراجع والخدمة تعمل"; else echo "!! الخدمة لا تستجيب حتى بعد التراجع — افحص: journalctl -u z8-web -u z8-api -n 50"; fi
}

if [ "${1:-}" = "--rollback" ]; then
  [ -f "$STATE" ] || { echo "لا توجد نسخة سابقة محفوظة"; exit 1; }
  restore "$(cat "$STATE")"
  exit 0
fi

PREV="$(git rev-parse HEAD)"
echo "==> سحب آخر تحديث (الحالي: $(git rev-parse --short HEAD))"
git fetch -q origin main
git checkout -q main 2>/dev/null || true
git reset -q --hard "$REF"
echo "    النسخة الجديدة: $(git log --oneline -1)"

echo "==> بناء الواجهة في مجلد منفصل (الموقع الحالي يبقى شغّالاً)"
if ! ( cd frontend
       npm install --no-audit --no-fund
       rm -rf .next-build
       export NEXT_DIST_DIR=.next-build; eval "$BUILD_CMD" ); then
  echo "!! فشل البناء — لم يتغير شيء على الموقع"
  git reset -q --hard "$PREV"
  rm -rf frontend/.next-build
  exit 1
fi

if [ -f backend/requirements.txt ]; then
  echo "==> تحديث تبعيات الباك اند"
  (cd backend && { [ -d .venv ] && . .venv/bin/activate; pip install -q -r requirements.txt; }) || echo "    (تخطّيت pip)"
fi

echo "==> تبديل النسخة وإعادة التشغيل"
echo "$PREV" > "$STATE"
rm -rf frontend/.next.prev
[ -d frontend/.next ] && mv frontend/.next frontend/.next.prev
mv frontend/.next-build frontend/.next
eval "$RESTART_CMD" || true

echo "==> فحص الصحة"
if healthy; then
  curl -fsS -o /dev/null --max-time 5 "$API_HEALTH_URL" 2>/dev/null || echo "    (تنبيه: $API_HEALTH_URL لم يستجب — تأكد يدوياً)"
  echo "==> تم. النسخة = $(git rev-parse --short HEAD) (للرجوع: bash deploy.sh --rollback)"
else
  echo "!! فشل فحص الصحة بعد النشر"
  restore "$PREV"
  exit 1
fi
