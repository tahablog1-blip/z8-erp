# التشغيل: النسخ الاحتياطي، النشر، الاختبارات

## 1) نسخ احتياطي يومي لقاعدة البيانات
```bash
cd /opt/z8-erp
sudo cp tools/systemd/z8-backup.service tools/systemd/z8-backup.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now z8-backup.timer
systemctl list-timers z8-backup.timer          # موعد التشغيل القادم (03:30 يومياً)
sudo systemctl start z8-backup.service         # تشغيل فوري للتجربة
ls -lh /var/backups/z8
```
- النسخ في `/var/backups/z8` بصيغة `pg_dump -Fc`، يُتحقق منها بـ `pg_restore --list`، وتُحذف بعد 14 يوماً (`KEEP_DAYS`).
- المسار والاحتفاظ قابلان للتغيير بمتغيرات `BACKUP_DIR` و`KEEP_DAYS`.
- **انسخ المجلد خارج السيرفر** (مثلاً rclone/scp لتخزين آخر) — نسخة على نفس القرص لا تحمي من فقدانه.

### اختبار الاستعادة (مرة شهرياً على الأقل)
```bash
bash tools/restore-db.sh --verify /var/backups/z8/<ملف>.dump      # يستعيد في قاعدة مؤقتة ويحذفها
bash tools/restore-db.sh --into z8_restored /var/backups/z8/<ملف>.dump   # استعادة في قاعدة جديدة (يرفض قاعدة موجودة)
```
الاستعادة الفعلية للإنتاج: أوقف `z8-api`، استعد في قاعدة جديدة، راجع البيانات، ثم غيّر `DATABASE_URL` وأعد التشغيل.

## 2) النشر مع تراجع تلقائي
```bash
cd /opt/z8-erp && bash deploy.sh          # نشر origin/main
bash deploy.sh --rollback                 # رجوع يدوي للنسخة السابقة
```
1. يبني الواجهة في `frontend/.next-build` بينما الموقع القديم يعمل؛ فشل البناء = لا يتغير شيء.
2. يبدّل المجلد، يعيد تشغيل `z8-api z8-web`، ثم يفحص `HEALTH_URL` (افتراضي `http://127.0.0.1:3000/login`) حتى 30 ثانية.
3. فشل الفحص = يعود تلقائياً للـ commit السابق ولبناء الواجهة السابق (`.next.prev`).
- تغييرات قاعدة البيانات (إن وُجدت) **لا** تُعكس تلقائياً؛ خذ نسخة احتياطية قبل أي نشر يغيّر المخطط.

## 3) الاختبارات و CI
```bash
cd backend && pip install -r requirements-dev.txt
python -m pytest                                              # بدون قاعدة بيانات: اختبارات الوحدات فقط
TEST_DATABASE_URL=postgresql://user:pw@localhost/z8_test python -m pytest   # + اختبارات القاعدة
```
- اسم قاعدة الاختبار **يجب** أن يحتوي `test` (يُعاد إنشاء schema `public` فيها في كل تشغيل — لا تشِر أبداً لقاعدة الإنتاج).
- GitHub Actions (`.github/workflows/ci.yml`) يشغّل على كل PR: pytest مع Postgres، و`tsc --noEmit` و`next build`.
