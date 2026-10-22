-- ═══════════════════════════════════════════════════════════════
-- Z8 ERP — migration-030: كتالوج ماسح النواقص المشترك عبر السيرفر
-- يضيف جدول واحد يخزن آخر نسخة من كتالوج الأصناف (باركود/اسم/سعر) اللي
-- الإدمن رفعها من داخل تطبيق ماسح النواقص (Android). قبل كده كان تحديث
-- الكتالوج المشترك بيعدي على مطور خارجي يدويًا (ملف catalog.json على
-- GitHub) - دلوقتي الإدمن يرفع ملف إكسل جديد من جواه التطبيق مباشرة،
-- ويظهر زرار "تحديث الأصناف" تلقائيًا لكل الأجهزة التانية.
-- التشغيل: مرة واحدة على z8_car_manager
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS shortage_catalog (
    company_id  UUID PRIMARY KEY,
    products    JSONB NOT NULL DEFAULT '[]',
    item_count  INTEGER NOT NULL DEFAULT 0,
    updated_by  UUID REFERENCES users(id),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
