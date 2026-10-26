#!/usr/bin/env bash
# deploy.sh — تحديث السيرفر بآخر نسخة من main بخطوة واحدة (شغّله من مجلد المشروع: bash deploy.sh)
set -euo pipefail
cd "$(dirname "$0")"

echo "==> سحب آخر تحديث"
git fetch origin main
git checkout -q main 2>/dev/null || true
git reset --hard origin/main
echo "    النسخة: $(git log --oneline -1)"

echo "==> تثبيت وبناء الواجهة"
cd frontend
npm install --no-audit --no-fund
rm -rf .next
npm run build
cd ..

echo "==> تحديث تبعيات الباك اند"
if [ -f backend/requirements.txt ]; then
  (cd backend && { [ -d .venv ] && . .venv/bin/activate; pip install -q -r requirements.txt; }) || echo "    (تخطّيت pip)"
fi

echo "==> إعادة تشغيل الخدمات"
systemctl restart z8-api z8-web
sleep 4
systemctl is-active z8-api z8-web

echo "==> تم. افتح الموقع (Ctrl+Shift+R) وتأكد أن رقم النسخة أسفل القائمة الجانبية = $(git rev-parse --short HEAD)"
