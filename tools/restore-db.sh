#!/usr/bin/env bash
# tools/restore-db.sh — استعادة نسخة احتياطية أو اختبار صلاحيتها.
#
#   bash tools/restore-db.sh --verify /var/backups/z8/z8-YYYYMMDD-HHMMSS.dump
#       يستعيد النسخة في قاعدة مؤقتة ويعدّ الجداول والصفوف ثم يحذف المؤقتة — آمن، لا يمسّ قاعدتك الحية. اعمله شهرياً.
#
#   bash tools/restore-db.sh --into NEW_DB_NAME FILE.dump
#       يستعيد في قاعدة جديدة باسم تحدده (يرفض لو الاسم موجود). لا يستبدل القاعدة الحية أبداً.
#
# يحتاج DATABASE_URL لمستخدم يملك صلاحية CREATE DATABASE (نفس بيئة النسخ الاحتياطي).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MODE="${1:-}"; shift || true
if [ -z "${DATABASE_URL:-}" ] && [ -f "$ROOT/backend/.env" ]; then
  DATABASE_URL="$(grep -E '^DATABASE_URL=' "$ROOT/backend/.env" | head -1 | cut -d= -f2- | tr -d '"'"'")"
fi
[ -n "${DATABASE_URL:-}" ] || { echo "✗ DATABASE_URL غير معرّف" >&2; exit 2; }

# رابط الخادم بدون اسم القاعدة (للاتصال بقاعدة postgres الإدارية)
BASE="${DATABASE_URL%/*}"; QUERY=""; case "$DATABASE_URL" in *\?*) QUERY="?${DATABASE_URL#*\?}";; esac
admin_url() { echo "$BASE/postgres$QUERY"; }
db_url()    { echo "$BASE/$1$QUERY"; }

restore_into() {  # $1=اسم القاعدة  $2=الملف
  psql "$(admin_url)" -v ON_ERROR_STOP=1 -qc "CREATE DATABASE \"$1\""
  pg_restore --no-owner --no-privileges --dbname="$(db_url "$1")" "$2"
}

case "$MODE" in
  --verify)
    FILE="${1:?المسار مطلوب}"; [ -f "$FILE" ] || { echo "✗ الملف غير موجود" >&2; exit 2; }
    TMPDB="z8_verify_$(date +%s)"
    trap 'psql "$(admin_url)" -qc "DROP DATABASE IF EXISTS \"'"$TMPDB"'\"" >/dev/null 2>&1 || true' EXIT
    echo "==> استعادة تجريبية في $TMPDB"
    restore_into "$TMPDB" "$FILE"
    echo "==> الجداول والصفوف في النسخة المستعادة:"
    psql "$(db_url "$TMPDB")" -At -c "SELECT relname || ': ' || n_live_tup FROM pg_stat_user_tables ORDER BY n_live_tup DESC LIMIT 15"
    TABLES="$(psql "$(db_url "$TMPDB")" -At -c "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'")"
    [ "$TABLES" -gt 0 ] || { echo "✗ النسخة لا تحتوي جداول" >&2; exit 1; }
    echo "✓ النسخة سليمة ($TABLES جدول) — حُذفت القاعدة المؤقتة";;
  --into)
    NAME="${1:?اسم القاعدة الجديدة مطلوب}"; FILE="${2:?المسار مطلوب}"
    [ -f "$FILE" ] || { echo "✗ الملف غير موجود" >&2; exit 2; }
    EXISTS="$(psql "$(admin_url)" -At -c "SELECT 1 FROM pg_database WHERE datname='$NAME'")"
    [ -z "$EXISTS" ] || { echo "✗ القاعدة $NAME موجودة بالفعل — اختر اسماً جديداً" >&2; exit 1; }
    restore_into "$NAME" "$FILE"
    echo "✓ استُعيدت النسخة في القاعدة $NAME. للتحويل إليها: غيّر DATABASE_URL في backend/.env ثم systemctl restart z8-api";;
  *) sed -n 2,12p "$0"; exit 2;;
esac
