-- ═══════════════════════════════════════════════════════════════
-- Z8 ERP — migration-024: كميات الزيت المعتمدة لكل موديل
-- تُدخل مرة واحدة لأي سيارة، وتُثبّت لكل سيارة بنفس
-- (الماركة + الموديل + سنة الصنع) — وتظهر تلقائياً في أوامر العمل
-- وصفحة حجز العميل. التشغيل: مرة واحدة على z8_car_manager
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS oil_specs (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id  UUID NOT NULL,
    brand       TEXT NOT NULL,
    model       TEXT NOT NULL,
    model_year  TEXT NOT NULL,
    oil_qty     NUMERIC(4,1) NOT NULL CHECK (oil_qty > 0),
    oil_type    TEXT NOT NULL DEFAULT '',
    updated_by  UUID,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (company_id, brand, model, model_year)
);

CREATE INDEX IF NOT EXISTS idx_oil_specs_lookup
    ON oil_specs (company_id, brand, model, model_year);
