#!/usr/bin/env bash
# tools/nginx/apply-hardening.sh — يطبّق حدود الإغراق على موقع Z8 في nginx بأمان:
#   • قابل للتكرار (idempotent) • نسخة احتياطية خارج sites-enabled • اختبار nginx -t قبل أي reload • تراجع تلقائي عند الفشل.
# الاستعمال على السيرفر:  sudo bash tools/nginx/apply-hardening.sh [/etc/nginx/sites-enabled/z8]
set -euo pipefail
SITE="${1:-/etc/nginx/sites-enabled/z8}"
BK=/root/nginx-backup
[ -f "$SITE" ] || { echo "✗ ملف الموقع غير موجود: $SITE" >&2; exit 2; }
mkdir -p "$BK"

# 1) أي نسخ قديمة داخل sites-enabled تسبب duplicate default server — انقلها خارجاً
for f in "$SITE".bak-* /etc/nginx/sites-enabled/*.bak*; do
  [ -e "$f" ] && { mv "$f" "$BK/$(basename "$f")"; echo "نُقلت نسخة من sites-enabled: $(basename "$f")"; }
done

# 2) إن كانت لدينا نسخة أصلية (قبل أي تعديل منا) نبدأ منها، وإلا نأخذ نسخة من الحالي
ORIG=$(ls -1 "$BK"/z8.orig 2>/dev/null || true)
if [ -z "$ORIG" ]; then
  OLDEST=$(ls -1tr "$BK"/z8.bak-* 2>/dev/null | head -1 || true)
  if [ -n "$OLDEST" ] && ! grep -q "z8-limits.conf" "$OLDEST"; then cp "$OLDEST" "$BK/z8.orig"; else cp "$SITE" "$BK/z8.orig"; fi
fi
cp "$BK/z8.orig" "$SITE"           # نبدأ دائماً من الأصل النظيف ثم نطبّق التعديل مرة واحدة
echo "الأصل المحفوظ: $BK/z8.orig"

# 3) ملفات التكوين
cat > /etc/nginx/conf.d/z8-zones.conf <<'EOF'
limit_req_zone $binary_remote_addr zone=z8_api:10m    rate=20r/s;
limit_req_zone $binary_remote_addr zone=z8_login:10m  rate=10r/m;
limit_req_zone $binary_remote_addr zone=z8_public:10m rate=5r/s;
limit_req_zone $binary_remote_addr zone=z8_camera:10m rate=1r/s;
limit_req_status 429;
server_tokens off;
EOF
mkdir -p /etc/nginx/snippets
cat > /etc/nginx/snippets/z8-api-proxy.conf <<'EOF'
proxy_pass http://127.0.0.1:4001;
proxy_set_header Host $host;
proxy_set_header X-Real-IP $remote_addr;
proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
proxy_set_header X-Forwarded-Proto $scheme;
EOF
cat > /etc/nginx/snippets/z8-limits.conf <<'EOF'
location = /api/auth/login            { limit_req zone=z8_login burst=5 nodelay;   include /etc/nginx/snippets/z8-api-proxy.conf; }
location = /api/auth/2fa/verify-login { limit_req zone=z8_login burst=5 nodelay;   include /etc/nginx/snippets/z8-api-proxy.conf; }
location /api/cars/public/            { limit_req zone=z8_public burst=20 nodelay; include /etc/nginx/snippets/z8-api-proxy.conf; }
location /api/service-notes/public/   { limit_req zone=z8_public burst=20 nodelay; include /etc/nginx/snippets/z8-api-proxy.conf; }
location /api/products/public/        { limit_req zone=z8_public burst=40 nodelay; include /etc/nginx/snippets/z8-api-proxy.conf; }
location /api/cameras/public-live/    { limit_req zone=z8_camera burst=3 nodelay;  include /etc/nginx/snippets/z8-api-proxy.conf; }
EOF

# 4) تفعيلها في الموقع (مرة واحدة فقط في أول كتلة server)
python3 - "$SITE" <<'PY'
import re, sys
p = sys.argv[1]; s = open(p).read()
inc = "    include /etc/nginx/snippets/z8-limits.conf;\n"
assert "z8-limits.conf" not in s
s, n1 = re.subn(r"(\n\s*client_max_body_size[^\n]*\n)", lambda m: m.group(1) + inc, s, count=1)
s, n2 = re.subn(r"(\n\s*location /api/ \{\n)", lambda m: m.group(1) + "        limit_req zone=z8_api burst=60 nodelay;\n", s, count=1)
if not (n1 and n2):
    sys.exit("✗ لم أجد client_max_body_size أو location /api/ في الموقع — لا تعديل")
open(p, "w").write(s)
PY

# 5) اختبار ثم reload، وإلا تراجع
if nginx -t; then
  systemctl reload nginx
  echo "✓ تم التطبيق وإعادة تحميل nginx"
else
  cp "$BK/z8.orig" "$SITE"; rm -f /etc/nginx/conf.d/z8-zones.conf /etc/nginx/snippets/z8-limits.conf /etc/nginx/snippets/z8-api-proxy.conf
  nginx -t && echo "↩ تراجعت إلى الإعداد الأصلي — لم يتغيّر شيء" || echo "⚠ الإعداد الأصلي نفسه يفشل في الاختبار — راجع nginx -t" 
  exit 1
fi
echo "تحقق:  curl -sI https://\$(grep -m1 server_name $SITE | awk '{print \$2}' | tr -d ';') | grep -i '^server'"
