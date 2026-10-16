-- ═══════════════════════════════════════════════════════════════
-- Z8 ERP — migration-025: مرتجع جزئي للفواتير (بند/كمية معينة)
-- يكمّل المرتجع الكامل الموجود (invoices.is_returned) من غير ما يلمسه —
-- الفاتورة الأصلية تفضل زي ما هي زي ما تتطلب الفوترة الإلكترونية، والمرتجع
-- الجزئي بيتسجّل كحركة منفصلة مرتبطة بيها (نفس فكرة invoice_returns في
-- النظام الأصلي قبل الترحيل لـ FastAPI — راجع كومنتات modules/invoices).
-- التشغيل: مرة واحدة على z8_car_manager
-- ═══════════════════════════════════════════════════════════════

-- كام وحدة من كل بند اترجعت فعلاً (يمنع ترجيع نفس البند أكتر من مرة)
ALTER TABLE invoice_items ADD COLUMN IF NOT EXISTS returned_qty INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS invoice_returns (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id      UUID NOT NULL,
    branch_id       UUID NOT NULL,
    invoice_id      UUID NOT NULL REFERENCES invoices(id),
    return_no       TEXT NOT NULL,
    total_ex        NUMERIC(12,2) NOT NULL DEFAULT 0,
    total_vat       NUMERIC(12,2) NOT NULL DEFAULT 0,
    total_inc       NUMERIC(12,2) NOT NULL DEFAULT 0,
    note            TEXT,
    approved_by     UUID REFERENCES hr_employees(id),   -- صاحب رمز الاعتماد (مشرف)
    approved_name   TEXT,                                -- اسمه وقت الاعتماد (ثابت حتى لو الموظف اتغيّر لاحقاً)
    created_by      UUID NOT NULL,                        -- الكاشير اللي نفّذ العملية
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (company_id, return_no)
);

CREATE TABLE IF NOT EXISTS invoice_return_items (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    return_id       UUID NOT NULL REFERENCES invoice_returns(id) ON DELETE CASCADE,
    invoice_item_id UUID NOT NULL REFERENCES invoice_items(id),
    product_id      UUID,
    label           TEXT NOT NULL,
    qty             INTEGER NOT NULL CHECK (qty > 0),
    unit_price      NUMERIC(12,2) NOT NULL,      -- نفس سعر البند في الفاتورة الأصلية (بدون ضريبة)
    unit_price_vat  NUMERIC(12,2) NOT NULL,      -- نفس سعر البند في الفاتورة الأصلية (شامل الضريبة)
    line_ex         NUMERIC(12,2) NOT NULL,
    line_vat        NUMERIC(12,2) NOT NULL,
    line_inc        NUMERIC(12,2) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_invoice_returns_invoice ON invoice_returns(invoice_id);
CREATE INDEX IF NOT EXISTS idx_invoice_return_items_return ON invoice_return_items(return_id);
