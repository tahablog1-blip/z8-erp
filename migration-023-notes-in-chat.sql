-- ═══════════════════════════════════════════════════════════════
-- Z8 ERP — migration-023: ربط الملاحظات بالمحادثة (خيط موحد)
-- أي ملاحظة جديدة تتحول تلقائياً لرسالة داخل محادثة أمر العمل
-- (message_type = 'note_internal' — تُخفى عن العميل حتى يُبلَّغ رسمياً)
-- التشغيل: مرة واحدة على قاعدة z8_car_manager (محلياً وعلى السيرفر)
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION service_note_to_chat() RETURNS trigger AS $fn$
BEGIN
    IF NEW.work_order_id IS NULL THEN RETURN NEW; END IF;
    INSERT INTO service_messages
        (company_id, branch_id, work_order_id, customer_id, employee_id,
         note_id, sender_type, message, message_type)
    VALUES
        (NEW.company_id, NEW.branch_id, NEW.work_order_id, NEW.customer_id,
         NEW.employee_id, NEW.id, 'employee',
         '📋 ' || COALESCE(NEW.note_number, 'ملاحظة') || ' — ' ||
         CASE NEW.type
             WHEN 'out_of_stock'      THEN 'منتج غير متوفر'
             WHEN 'low_stock'         THEN 'كمية غير كافية'
             WHEN 'needs_replacement' THEN 'منتج يحتاج تغيير'
             WHEN 'part_replacement'  THEN 'قطعة تحتاج تغيير'
             WHEN 'technical'         THEN 'مشكلة فنية'
             WHEN 'car_note'          THEN 'ملاحظة على السيارة'
             WHEN 'extra_service'     THEN 'خدمة إضافية مقترحة'
             WHEN 'customer_declined' THEN 'العميل رفض خدمة'
             WHEN 'operational'       THEN 'مشكلة تشغيلية'
             ELSE 'أخرى'
         END ||
         CASE WHEN COALESCE(NEW.description, '') <> ''
              THEN E'\n' || NEW.description ELSE '' END,
         'note_internal');
    RETURN NEW;
END $fn$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_service_note_to_chat ON service_notes;
CREATE TRIGGER trg_service_note_to_chat
AFTER INSERT ON service_notes
FOR EACH ROW EXECUTE FUNCTION service_note_to_chat();

-- ═══ النتيجة: الملاحظة تظهر فوراً كبطاقة داخل خيط المحادثة الموحد ═══
