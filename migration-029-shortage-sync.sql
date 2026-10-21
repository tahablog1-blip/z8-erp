-- ═══════════════════════════════════════════════════════════════
-- Z8 ERP — migration-029: مزامنة تطبيق ماسح النواقص (Shortage Scanner)
-- يضيف 3 جداول جديدة لدعم: (1) رفع الطلبيات لسيرفر Z8 بدل بقائها محلية فقط
-- على كل جهاز، (2) إعلانات/تنبيهات يكتبها الإدمن من داخل التطبيق وتظهر
-- لكل الموظفين، (3) شاشة "الأجهزة المتصلة" للإدمن تعتمد على جدول
-- user_sessions الموجود فعلاً (لا حاجة لجدول جديد للحضور/الأونلاين).
-- التشغيل: مرة واحدة على z8_car_manager
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS shortage_orders (
    id              TEXT PRIMARY KEY,              -- نفس الـ id المولّد على الجهاز (ORD-YYYYMMDD-XXXX)
    company_id      UUID NOT NULL,
    user_id         UUID NOT NULL REFERENCES users(id),
    branch_id       UUID REFERENCES branches(id),
    items           JSONB NOT NULL DEFAULT '[]',
    item_count      INTEGER NOT NULL DEFAULT 0,
    total_amount    NUMERIC(12,2) NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_shortage_orders_user ON shortage_orders(user_id);
CREATE INDEX IF NOT EXISTS idx_shortage_orders_company ON shortage_orders(company_id, created_at DESC);

CREATE TABLE IF NOT EXISTS shortage_announcements (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id  UUID NOT NULL,
    message     TEXT NOT NULL,
    created_by  UUID NOT NULL REFERENCES users(id),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    active      BOOLEAN NOT NULL DEFAULT TRUE
);
CREATE INDEX IF NOT EXISTS idx_shortage_announcements_active
    ON shortage_announcements(company_id, active, created_at DESC);
