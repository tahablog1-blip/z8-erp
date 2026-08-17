-- ═══════════════════════════════════════════════════════════════
-- Z8 ERP — مركز ملاحظات الخدمة (Service Notes Center)
-- migration-022-service-notes.sql
-- 4 جداول: الملاحظات، المرفقات، الرسائل، القوالب + توكن آمن للحجز
-- التشغيل: مرة واحدة على قاعدة z8_car_manager
-- ═══════════════════════════════════════════════════════════════

-- امتداد التشفير — مطلوب لتوليد التوكن الآمن (gen_random_bytes)
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ── 1) جدول الملاحظات الرئيسي ──
CREATE TABLE IF NOT EXISTS service_notes (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    note_number        TEXT UNIQUE,                -- NOTE-000123 يتولد تلقائياً
    company_id         UUID NOT NULL,
    branch_id          UUID,
    work_order_id      UUID,                       -- = car id في نظامنا (أمر العمل مرتبط بالسيارة)
    booking_id         UUID,
    customer_id        UUID,
    vehicle_id         UUID,                       -- نفس car_id — منفصل احتياطاً للمستقبل
    employee_id        UUID NOT NULL,              -- منشئ الملاحظة
    product_id         UUID,
    type               TEXT NOT NULL,              -- out_of_stock | low_stock | needs_replacement |
                                                   -- part_replacement | technical | car_note |
                                                   -- extra_service | customer_declined | operational | other
    title              TEXT,
    description        TEXT NOT NULL DEFAULT '',
    required_quantity  INT,
    available_quantity INT,
    status             TEXT NOT NULL DEFAULT 'new'
                       CHECK (status IN ('new','in_progress','awaiting_customer',
                                         'awaiting_management','handled','closed','rejected')),
    priority           TEXT NOT NULL DEFAULT 'normal'
                       CHECK (priority IN ('low','normal','high','urgent')),
    customer_visible   BOOLEAN NOT NULL DEFAULT FALSE,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    closed_at          TIMESTAMPTZ,
    closed_by          UUID
);

CREATE INDEX IF NOT EXISTS idx_snotes_status   ON service_notes (company_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_snotes_branch   ON service_notes (branch_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_snotes_car      ON service_notes (work_order_id);
CREATE INDEX IF NOT EXISTS idx_snotes_customer ON service_notes (customer_id);
CREATE INDEX IF NOT EXISTS idx_snotes_product  ON service_notes (product_id);

-- ترقيم تسلسلي NOTE-000001
CREATE SEQUENCE IF NOT EXISTS service_notes_seq;
CREATE OR REPLACE FUNCTION set_note_number() RETURNS TRIGGER AS $$
BEGIN
    IF NEW.note_number IS NULL THEN
        NEW.note_number := 'NOTE-' || LPAD(nextval('service_notes_seq')::TEXT, 6, '0');
    END IF;
    RETURN NEW;
END; $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_note_number ON service_notes;
CREATE TRIGGER trg_note_number BEFORE INSERT ON service_notes
    FOR EACH ROW EXECUTE FUNCTION set_note_number();

-- ── 2) مرفقات الملاحظة ──
CREATE TABLE IF NOT EXISTS service_note_attachments (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    note_id     UUID NOT NULL REFERENCES service_notes(id) ON DELETE CASCADE,
    file_url    TEXT NOT NULL,
    file_type   TEXT NOT NULL DEFAULT 'image',    -- image | video | file
    uploaded_by UUID,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_snote_att ON service_note_attachments (note_id);

-- ── 3) رسائل المحادثة (موظف ↔ عميل) مرتبطة بأمر العمل ──
CREATE TABLE IF NOT EXISTS service_messages (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id     UUID NOT NULL,
    branch_id      UUID,
    booking_id     UUID,
    work_order_id  UUID NOT NULL,                 -- = car id
    customer_id    UUID,
    employee_id    UUID,                          -- NULL لو المرسل عميل
    note_id        UUID REFERENCES service_notes(id) ON DELETE SET NULL,
    sender_type    TEXT NOT NULL CHECK (sender_type IN ('employee','customer','system')),
    message        TEXT NOT NULL DEFAULT '',
    attachment_url TEXT,
    message_type   TEXT NOT NULL DEFAULT 'text',  -- text | image | quick_reply
    is_read        BOOLEAN NOT NULL DEFAULT FALSE,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    read_at        TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_smsg_car    ON service_messages (work_order_id, created_at);
CREATE INDEX IF NOT EXISTS idx_smsg_unread ON service_messages (company_id, sender_type, is_read);

-- ── 4) قوالب الرسائل الجاهزة ──
CREATE TABLE IF NOT EXISTS message_templates (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL,
    branch_id  UUID,                              -- NULL = متاح لكل الفروع
    title      TEXT NOT NULL,
    message    TEXT NOT NULL,
    category   TEXT,
    is_active  BOOLEAN NOT NULL DEFAULT TRUE,
    created_by UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── 5) توكن آمن لصفحة الحجز/المحادثة العامة (بند 27) ──
-- بدل الوصول بـ car_id القابل للتخمين، العميل يوصل عبر توكن عشوائي
ALTER TABLE cars ADD COLUMN IF NOT EXISTS public_token TEXT UNIQUE
    DEFAULT encode(gen_random_bytes(24), 'hex');
-- تعبئة السيارات القديمة اللي لسه من غير توكن
UPDATE cars SET public_token = encode(gen_random_bytes(24), 'hex')
    WHERE public_token IS NULL;
CREATE INDEX IF NOT EXISTS idx_cars_public_token ON cars (public_token);

-- ── 6) قوالب افتراضية (بند 13) — تتزرع لكل شركة موجودة ──
INSERT INTO message_templates (company_id, title, message, category)
SELECT c.id, t.title, t.message, t.category
FROM companies c
CROSS JOIN (VALUES
    ('منتج غير متوفر',
     'لاحظ موظف الخدمة أن المنتج المطلوب يحتاج إلى تغيير، ولكن المنتج غير متوفر حالياً.',
     'out_of_stock'),
    ('خدمة إضافية',
     'لاحظنا أثناء الفحص أن السيارة تحتاج إلى خدمة إضافية. هل ترغب في معرفة التفاصيل؟',
     'extra_service'),
    ('ملاحظة فنية',
     'تم اكتشاف ملاحظة فنية أثناء تنفيذ الخدمة ونرغب في إبلاغك بها.',
     'technical')
) AS t(title, message, category)
WHERE NOT EXISTS (
    SELECT 1 FROM message_templates m
    WHERE m.company_id = c.id AND m.title = t.title
);

-- ═══ النتيجة: 4 جداول + توكن آمن + قوالب جاهزة، بدون أي تعديل ═══
-- ═══ على الجداول الموجودة (عدا عمود واحد آمن على cars)        ═══
