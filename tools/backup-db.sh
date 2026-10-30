#!/usr/bin/env bash
# tools/backup-db.sh — نسخة احتياطية يومية لقاعدة بيانات Z8 (pg_dump بصيغة custom مضغوطة) مع تدوير النسخ القديمة.
#
# الاستخدام:   bash tools/backup-db.sh                # يقرأ DATABASE_URL من البيئة أو من backend/.env
# متغيرات اختيارية:
#   BACKUP_DIR      مجلد الحفظ            (الافتراضي: /var/backups/z8)
#   KEEP_DAYS       مدة الاحتفاظ بالأيام   (الافتراضي: 14)
#   DATABASE_URL    postgresql://user:pass@host:5432/dbname
#
# النسخة تُتحقَّق فوراً بـ pg_restore --list (تفشل العملية لو الملف تالف) ولا تُحذف القديمة إلا بعد نجاح الجديدة.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/z8}"
KEEP_DAYS="${KEEP_DAYS:-14}"

if [ -z "${DATABASE_URL:-}" ] && [ -f "$ROOT/backend/.env" ]; then
  DATABASE_URL="$(grep -E '^DATABASE_URL=' "$ROOT/backend/.env" | head -1 | cut -d= -f2- | tr -d '"'"'")"
fi
[ -n "${DATABASE_URL:-}" ] || { echo "✗ DATABASE_URL غير معرّف (متغير بيئة أو backend/.env)" >&2; exit 2; }
command -v pg_dump >/dev/null || { echo "✗ pg_dump غير مثبّت (apt install postgresql-client)" >&2; exit 2; }

mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"
STAMP="$(date +%Y%m%d-%H%M%S)"
OUT="$BACKUP_DIR/z8-$STAMP.dump"
TMP="$OUT.partial"
trap 'rm -f "$TMP" "$TMP.err"' EXIT

echo "==> نسخ احتياطي إلى $OUT"
if ! pg_dump --format=custom --compress=6 --no-owner --no-privileges --dbname="$DATABASE_URL" --file="$TMP" 2>"$TMP.err"; then
  # مستخدم التطبيق قد لا يملك صلاحية قراءة كل الجداول (permission denied for table ...) فتفشل النسخة الكاملة.
  # عند التشغيل كـ root نعيد المحاولة بمستخدم postgres عبر المقبس المحلي (peer) — الكتابة تتم من هنا فلا يحتاج postgres صلاحية على المجلد.
  if [ "$(id -u)" -eq 0 ] && id postgres >/dev/null 2>&1; then
    DBNAME="$(printf '%s' "$DATABASE_URL" | sed -E 's#^[a-z]+://[^/]*/([^?]+).*#\1#')"
    echo "! pg_dump بمستخدم التطبيق فشل ($(head -1 "$TMP.err")) — إعادة المحاولة بمستخدم postgres على القاعدة $DBNAME"
    runuser -u postgres -- pg_dump --format=custom --compress=6 --no-owner --no-privileges --dbname="$DBNAME" > "$TMP"
  else
    cat "$TMP.err" >&2; rm -f "$TMP.err"; exit 1
  fi
fi
rm -f "$TMP.err"
pg_restore --list "$TMP" >/dev/null          # تحقق: الملف قابل للقراءة
mv "$TMP" "$OUT"
chmod 600 "$OUT"
SIZE="$(du -h "$OUT" | cut -f1)"
echo "✓ تمت النسخة ($SIZE)"

# تدوير: حذف النسخ الأقدم من KEEP_DAYS (بعد نجاح النسخة الجديدة فقط)
find "$BACKUP_DIR" -maxdepth 1 -name 'z8-*.dump' -type f -mtime +"$KEEP_DAYS" -print -delete | sed 's/^/  حُذفت نسخة قديمة: /' || true
echo "النسخ الحالية: $(find "$BACKUP_DIR" -maxdepth 1 -name 'z8-*.dump' -type f | wc -l)"
