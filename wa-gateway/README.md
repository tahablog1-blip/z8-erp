# بوابة واتساب المحلية (whatsapp-web.js)

خدمة صغيرة على نفس السيرفر بتربط **رقم الشركة** بواتساب عن طريق مسح QR، وبعدها الباك اند بيبعت كل رسائل
واتساب (رمز التحقق، الفواتير، إشعارات العملاء) منها — **بدون اشتراك**.

> ⚠ whatsapp-web.js غير رسمي ومخالف لشروط واتساب. الرقم ممكن يتقيّد. استخدم **رقماً مخصصاً للشركة**،
> والبوابة فيها فاصل 2.5 ثانية بين الرسائل وحد يومي (300 رسالة) للتقليل من المخاطرة.

## التثبيت على السيرفر (Ubuntu 24.04)

```bash
# 1) مكتبات كروم
apt update && apt install -y libnss3 libatk1.0-0t64 libatk-bridge2.0-0t64 libcups2t64 libdrm2 \
  libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libgbm1 libasound2t64 \
  libpangocairo-1.0-0 libgtk-3-0t64 fonts-liberation

# 2) تثبيت الحزم
cd /opt/z8-erp/wa-gateway && npm install --omit=dev

# 3) مفتاح سري (نفس القيمة هتتحط في الباك اند)
KEY=$(openssl rand -hex 24)
echo "WA_API_KEY=$KEY" > .env && chmod 600 .env
echo "WA_DATA_DIR=/opt/z8-erp/wa-gateway/.wwebjs_auth" >> .env

# 4) ربط الباك اند
cat >> /opt/z8-erp/backend/.env <<ENV
WA_GATEWAY_URL=http://127.0.0.1:4100
WA_GATEWAY_KEY=$KEY
ENV

# 5) تشغيل الخدمة
cp z8-wa.service /etc/systemd/system/ && systemctl daemon-reload
systemctl enable --now z8-wa
systemctl restart z8-api
```

## الربط
افتح **الإعدادات ← التكاملات** في النظام: هيظهر كارت «واتساب — ربط مباشر» فيه QR.
على جوال الشركة: واتساب ← الأجهزة المرتبطة ← ربط جهاز ← امسح الرمز. الحالة تتحوّل لـ «مربوط».

الجلسة بتتحفظ في `.wwebjs_auth` فمش هتحتاج QR بعد إعادة التشغيل (لا تمسح المجلد ولا ترفعه على GitHub).

## متابعة
```bash
systemctl status z8-wa --no-pager
journalctl -u z8-wa -n 50 --no-pager
curl -s -H "x-api-key: $(grep WA_API_KEY .env | cut -d= -f2)" http://127.0.0.1:4100/status
```

البوابة بتسمع على `127.0.0.1` بس (مش مكشوفة للإنترنت) وكل طلب محتاج المفتاح السري.
