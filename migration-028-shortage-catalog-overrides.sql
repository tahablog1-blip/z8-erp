-- migration-028-shortage-catalog-overrides.sql
-- جدول مستقل (لا يلمس جدول products الحالي) لحفظ اسم أي صنف يُكتب يدويًا من
-- تطبيق ماسح النواقص (ShortageScanner Android) لما الباركود يطلع "غير موجود".
-- مشترك بين كل الفروع/الأجهزة عبر نقطة الدخول /api/shortage-overrides، فبمجرد
-- ما موظف في فرع يكتب اسم صنف جديد، يظهر فورًا لباقي الأجهزة لما تصوّر نفس الباركود.
CREATE TABLE IF NOT EXISTS shortage_catalog_overrides (
    barcode    VARCHAR(64) PRIMARY KEY,
    name       TEXT NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
