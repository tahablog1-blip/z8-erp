-- ═══════════════════════════════════════════════════════════════
-- Z8 ERP — migration-026: حجم الماكينة (engine_size) كحقل إضافي
-- بجانب عدد السلندرات الموجود، في: تسجيل سيارة العميل (الموقع/الأدمن)،
-- صفحة الحجز العامة للعميل، وربط فلاتر السيارات. نص حر (مثال: "2.5")
-- عشان يغطي كل أحجام المحركات، ويُطابَق في البحث بعد تطبيع يُسقط أي حرف
-- غير رقم/نقطة (فـ"2.5" و"2.5L" و"2.5 لتر" تتطابق). التشغيل: مرة واحدة
-- على z8_car_manager
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE cars              ADD COLUMN IF NOT EXISTS engine_size TEXT;
ALTER TABLE customer_cars     ADD COLUMN IF NOT EXISTS engine_size TEXT;
ALTER TABLE customer_vehicles ADD COLUMN IF NOT EXISTS engine_size TEXT;
ALTER TABLE car_oil_filters   ADD COLUMN IF NOT EXISTS engine_size TEXT;
