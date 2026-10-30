#!/usr/bin/env bash
# tools/security-check.sh — فحص أمني للسيرفر (قراءة فقط: لا يغيّر شيئاً ولا يطبع أي سر).
# التشغيل على السيرفر:  sudo bash /opt/z8-erp/tools/security-check.sh
# المخرجات: ✓ سليم · ⚠ تحذير (يستحق المعالجة) · ✗ خطر (عالج فوراً). الصق الناتج كاملاً لمراجعته.
set -u
APP="${Z8_DIR:-/opt/z8-erp}"
ENVF="$APP/backend/.env"
DOMAIN="${1:-}"                       # اختياري: bash security-check.sh z8masdr.duckdns.org
ok=0; warn=0; bad=0
pass() { echo "  ✓ $*"; ok=$((ok+1)); }
warnf() { echo "  ⚠ $*"; warn=$((warn+1)); }
fail() { echo "  ✗ $*"; bad=$((bad+1)); }
sec() { echo; echo "── $* ──"; }
have() { command -v "$1" >/dev/null 2>&1; }
envval() { [ -f "$ENVF" ] && grep -E "^$1=" "$ENVF" | tail -1 | cut -d= -f2- | sed 's/^["'\'']//; s/["'\'']$//'; }

[ "$(id -u)" -eq 0 ] || echo "تنبيه: شغّله بـ sudo ليرى كل الفحوص."

sec "1) الأسرار (backend/.env)"
if [ ! -f "$ENVF" ]; then warnf "لا يوجد $ENVF — الإعدادات قد تكون من متغيرات النظام (تحقق يدوياً)"; else
  perm=$(stat -c '%a' "$ENVF"); owner=$(stat -c '%U' "$ENVF")
  case "$perm" in 600|400) pass ".env صلاحياته $perm ($owner)";; *) fail ".env صلاحياته $perm — نفّذ: chmod 600 $ENVF";; esac
  jwt=$(envval JWT_SECRET)
  if [ -z "$jwt" ]; then fail "JWT_SECRET غير مضبوط → يُستعمل السر الافتراضي المنشور في الكود (تزوير توكن مدير ممكن). اضبطه: echo \"JWT_SECRET=\$(openssl rand -hex 32)\" >> $ENVF ثم أعد تشغيل z8-api"
  elif echo "$jwt" | grep -q "z8SecretKey2026"; then fail "JWT_SECRET = القيمة الافتراضية المنشورة — غيّره فوراً"
  elif [ "${#jwt}" -lt 32 ]; then warnf "JWT_SECRET قصير (${#jwt} حرفاً) — الأفضل 64 حرفاً عشوائياً"
  else pass "JWT_SECRET مضبوط وطوله ${#jwt}"; fi
  dburl=$(envval DATABASE_URL)
  if [ -z "$dburl" ]; then warnf "DATABASE_URL غير مضبوط في .env (الافتراضي يستعمل كلمة مرور 123)";
  elif echo "$dburl" | grep -qE "://postgres:(123|postgres|password|admin)@"; then fail "DATABASE_URL يستعمل مستخدم postgres بكلمة مرور ضعيفة"
  elif echo "$dburl" | grep -qE "://postgres:"; then warnf "التطبيق يتصل بالقاعدة بالمستخدم postgres (مدير كامل) — الأفضل مستخدم بصلاحيات التطبيق فقط"
  else pass "DATABASE_URL لا يستعمل postgres/كلمة ضعيفة"; fi
  [ -n "$(envval SHORTAGE_API_KEY)" ] && pass "SHORTAGE_API_KEY مضبوط" || warnf "SHORTAGE_API_KEY فارغ → نقاط ماسح النواقص مفتوحة بلا مفتاح"
  [ -n "$(envval Z8_GATE_API_KEY)" ] && pass "Z8_GATE_API_KEY مضبوط" || warnf "Z8_GATE_API_KEY فارغ → /auto-checkin/scan مفتوح لأي شخص (يستهلك رصيد Vision)"
  [ -n "$(envval PAYMENTS_WEBHOOK_SECRET)" ] && pass "PAYMENTS_WEBHOOK_SECRET مضبوط" || pass "PAYMENTS_WEBHOOK_SECRET غير مضبوط (الـ webhook معطّل 501 — سليم ما لم تستعمل دفعاً إلكترونياً)"
  if [ -n "$(envval WA_GATEWAY_URL)" ] && [ -z "$(envval WA_GATEWAY_KEY)" ]; then warnf "بوابة واتساب بلا WA_GATEWAY_KEY"; fi
fi
if git -C "$APP" ls-files --error-unmatch backend/.env >/dev/null 2>&1; then fail ".env مُتتبَّع في git — أسراره في تاريخ المستودع (دوّرها كلها)"; else pass ".env غير مُتتبَّع في git"; fi

sec "2) المنافذ المفتوحة للإنترنت"
if have ss; then
  pub=$(ss -H -ltn 2>/dev/null | awk '{print $4}' | grep -vE '^(127\.|\[::1\]|::1)' | sed 's/.*://' | sort -un | tr '\n' ' ')
  echo "  منافذ تستمع على كل الواجهات: ${pub:-لا شيء}"
  for p in $pub; do
    case "$p" in
      22) pass "22 (SSH) — تأكد من بند SSH أدناه";;
      80|443) pass "$p (nginx)";;
      3000|4001|4100|5432|6379|27017|3306|9200) fail "المنفذ $p مكشوف للإنترنت — اجعله يستمع على 127.0.0.1 أو أغلقه بالجدار الناري";;
      *) warnf "المنفذ $p مفتوح — هل هو مقصود؟ (ss -ltnp | grep :$p)";;
    esac
  done
else warnf "أمر ss غير موجود"; fi

sec "3) الجدار الناري و fail2ban"
if have ufw; then
  st=$(ufw status 2>/dev/null | head -1)
  echo "  $st"; echo "$st" | grep -qi "active" && pass "ufw مفعّل" || warnf "ufw غير مفعّل — فعّله: ufw allow 22,80,443/tcp && ufw enable (بعد التأكد من منفذ SSH)"
else warnf "ufw غير مثبّت (قد تستعمل nftables/جدار مزوّد الاستضافة — تحقق)"; fi
if have fail2ban-client; then
  systemctl is-active --quiet fail2ban && pass "fail2ban يعمل" || warnf "fail2ban مثبّت لكنه متوقف"
else warnf "fail2ban غير مثبّت (apt install fail2ban) — يحجب مخمّني SSH"; fi

sec "4) SSH"
sshd_t=$(sshd -T 2>/dev/null)
if [ -n "$sshd_t" ]; then
  echo "$sshd_t" | grep -q "^passwordauthentication no" && pass "الدخول بكلمة مرور معطّل" || fail "SSH يقبل كلمة المرور — استعمل المفاتيح وعطّل PasswordAuthentication"
  echo "$sshd_t" | grep -qE "^permitrootlogin (no|prohibit-password|without-password)" && pass "دخول root المباشر مقيّد" || warnf "PermitRootLogin yes — مع تعطيل كلمة المرور يبقى المفتاح فقط، لكن الأفضل prohibit-password أو مستخدم عادي + sudo"
else warnf "تعذّر قراءة إعداد sshd (شغّل بـ sudo)"; fi
if [ -f /var/log/auth.log ]; then
  n=$(grep -c "Failed password" /var/log/auth.log 2>/dev/null || true); n=${n:-0}
  [ "$n" -gt 200 ] && warnf "محاولات دخول SSH فاشلة في auth.log: $n (هجمات تخمين نشطة — fail2ban + مفاتيح فقط)" || pass "محاولات SSH الفاشلة في السجل الحالي: $n"
fi

sec "5) التحديثات"
if have apt; then
  upg=$(apt list --upgradable 2>/dev/null | grep -c "/" || true)
  sec_upg=$(apt list --upgradable 2>/dev/null | grep -ci "security" || true)
  [ "${sec_upg:-0}" -gt 0 ] && warnf "تحديثات أمنية معلّقة: $sec_upg (apt upgrade)" || pass "لا تحديثات أمنية معلّقة (إجمالي القابل للتحديث: $upg)"
  dpkg -s unattended-upgrades >/dev/null 2>&1 && pass "unattended-upgrades مثبّت" || warnf "فعّل التحديثات الأمنية التلقائية: apt install unattended-upgrades"
  [ -f /var/run/reboot-required ] && warnf "السيرفر يحتاج إعادة تشغيل لتطبيق تحديث نواة/مكتبة"
fi

sec "6) الخدمات"
for s in z8-api z8-web nginx postgresql; do
  systemctl is-active --quiet "$s" 2>/dev/null && pass "$s يعمل" || warnf "$s غير نشط"
done
for s in z8-api z8-web; do
  u=$(systemctl show "$s" -p User --value 2>/dev/null)
  [ -z "$u" ] || [ "$u" = "root" ] && warnf "$s يعمل بصلاحيات root — الأفضل مستخدم مخصّص بلا صلاحيات" || pass "$s يعمل بالمستخدم $u"
done

sec "7) قاعدة البيانات"
if have psql; then
  la=$(sudo -u postgres psql -Atc "SHOW listen_addresses" 2>/dev/null)
  [ -n "$la" ] && { echo "$la" | grep -qE "^(localhost|127\.0\.0\.1)$" && pass "PostgreSQL يستمع على localhost فقط" || warnf "PostgreSQL listen_addresses=$la — تأكد أن الجدار الناري يمنع 5432"; }
  sup=$(sudo -u postgres psql -Atc "SELECT string_agg(rolname, ',') FROM pg_roles WHERE rolsuper AND rolname<>'postgres'" 2>/dev/null)
  [ -n "$sup" ] && warnf "مستخدمو قاعدة بيانات بصلاحية superuser غير postgres: $sup"
fi

sec "8) النسخ الاحتياطي"
BK="${BACKUP_DIR:-/var/backups/z8}"
if [ -d "$BK" ]; then
  last=$(find "$BK" -maxdepth 1 -name '*.dump' -printf '%T@ %p\n' 2>/dev/null | sort -n | tail -1)
  if [ -z "$last" ]; then fail "مجلد النسخ $BK موجود بلا أي ملف .dump"
  else age=$(( ( $(date +%s) - ${last%%.*} ) / 86400 ))
    [ "$age" -le 2 ] && pass "آخر نسخة قاعدة بيانات قبل $age يوم" || { [ "$age" -le 7 ] && warnf "آخر نسخة قبل $age أيام" || fail "آخر نسخة قبل $age يوماً — النسخ الدوري متوقف"; }
  fi
  warnf "تأكد يدوياً من وجود نسخة خارج هذا السيرفر (تخزين سحابي) وأنك جرّبت الاستعادة مرة"
else fail "لا يوجد مجلد نسخ احتياطي $BK"; fi
systemctl list-timers 2>/dev/null | grep -q z8-backup && pass "مؤقّت z8-backup مفعّل" || warnf "مؤقّت z8-backup غير ظاهر (systemctl list-timers)"

sec "9) nginx و HTTPS"
if have nginx; then
  nginx -t >/dev/null 2>&1 && pass "إعداد nginx سليم" || warnf "nginx -t فشل"
  conf=$(nginx -T 2>/dev/null)
  echo "$conf" | grep -q "limit_req_zone" && pass "limit_req مفعّل (حد للإغراق)" || warnf "لا يوجد limit_req — طبّق tools/nginx/z8-hardening.conf"
  echo "$conf" | grep -qE "^\s*server_tokens\s+off" && pass "server_tokens off" || warnf "نسخة nginx ظاهرة في الترويسات (server_tokens off)"
  echo "$conf" | grep -q "client_max_body_size" && pass "client_max_body_size محدد" || warnf "client_max_body_size غير محدد (الافتراضي 1m يرفض الصور، وقيمة كبيرة جداً خطر)"
fi
if [ -n "$DOMAIN" ] && have curl; then
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "http://$DOMAIN/" 2>/dev/null)
  case "$code" in 301|302|307|308) pass "HTTP يُحوَّل إلى HTTPS ($code)";; 000) warnf "تعذّر الاتصال بـ http://$DOMAIN";; *) warnf "HTTP لا يُحوَّل إلى HTTPS (رد $code)";; esac
  hdr=$(curl -sI --max-time 10 "https://$DOMAIN/" 2>/dev/null)
  [ -z "$hdr" ] && warnf "تعذّر جلب https://$DOMAIN" || {
    for h in "x-content-type-options" "x-frame-options" "strict-transport-security" "content-security-policy"; do
      echo "$hdr" | grep -qi "^$h" && pass "ترويسة $h موجودة" || warnf "ترويسة $h غير موجودة"
    done
    echo "$hdr" | grep -qi "^x-powered-by" && warnf "ترويسة X-Powered-By ظاهرة"
    echo "$hdr" | grep -i "^server:" | grep -qE "[0-9]\.[0-9]" && warnf "ترويسة Server تكشف رقم نسخة"
  }
  if have openssl; then
    end=$(echo | timeout 10 openssl s_client -servername "$DOMAIN" -connect "$DOMAIN:443" 2>/dev/null | openssl x509 -noout -enddate 2>/dev/null | cut -d= -f2)
    if [ -n "$end" ]; then d=$(( ( $(date -d "$end" +%s) - $(date +%s) ) / 86400 ))
      [ "$d" -ge 14 ] && pass "شهادة TLS تنتهي بعد $d يوماً" || fail "شهادة TLS تنتهي بعد $d يوماً فقط"; fi
  fi
else echo "  (مرّر النطاق لفحص HTTPS والترويسات:  bash security-check.sh z8masdr.duckdns.org)"; fi

sec "10) ملفات التطبيق"
[ -d "$APP/backend/uploads" ] && { w=$(find "$APP/backend/uploads" -maxdepth 1 -perm -o+w 2>/dev/null | head -1); [ -n "$w" ] && warnf "مجلد uploads قابل للكتابة لكل المستخدمين" || pass "مجلد uploads غير قابل للكتابة العامة"; }
df -P / | awk 'NR==2{gsub("%","",$5); if ($5+0>=90) print "  ⚠ القرص ممتلئ "$5"% (النسخ والسجلات ستتوقف)"; else print "  ✓ القرص "$5"% مستعمل"}'

echo
echo "══ الخلاصة: ✓ $ok سليم · ⚠ $warn تحذير · ✗ $bad خطر ══"
[ "$bad" -eq 0 ] || echo "عالج بنود ✗ أولاً (الترتيب من أعلى لأسفل)، ثم أعد تشغيل الفحص."
exit 0
