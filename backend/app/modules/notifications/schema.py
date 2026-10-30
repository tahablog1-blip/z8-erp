# modules/notifications/schema.py — DDL الإشعارات (يستعمله ensure-schema في main.py والاختبارات)
# بعض القواعد الحية فيها جدول notifications بتصميم أقدم (recipient_user_id / recipient_permission / link_section ... + قيد CHECK + notification_reads)،
# و«CREATE TABLE IF NOT EXISTS» لا يغيّره فكان كل طلب إشعارات يرجع 500 (column "user_id" does not exist).
# الترقية هنا إضافية فقط: لا حذف أعمدة ولا صفوف؛ صفوف التصميم القديم تبقى لكنها لا تظهر لأي مستخدم (user_id فارغ).
NOTIFICATIONS_ENSURE_SQL = (
    """CREATE TABLE IF NOT EXISTS notifications (
         id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
         company_id uuid NOT NULL,
         user_id uuid NOT NULL,
         type text NOT NULL,
         title text NOT NULL,
         body text,
         link text,
         severity text NOT NULL DEFAULT 'info',
         is_read boolean NOT NULL DEFAULT FALSE,
         dedupe_key text,
         created_at timestamptz NOT NULL DEFAULT now()
       )""",
    "ALTER TABLE notifications ADD COLUMN IF NOT EXISTS user_id uuid",
    "ALTER TABLE notifications ADD COLUMN IF NOT EXISTS link text",
    "ALTER TABLE notifications ADD COLUMN IF NOT EXISTS severity text NOT NULL DEFAULT 'info'",
    "ALTER TABLE notifications ADD COLUMN IF NOT EXISTS is_read boolean NOT NULL DEFAULT FALSE",
    "ALTER TABLE notifications ADD COLUMN IF NOT EXISTS dedupe_key text",
    # القيد القديم يشترط recipient_user_id أو recipient_permission — الإشعارات الجديدة لا تملؤهما فكانت ستُرفض
    "ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_check",
    "CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(company_id, user_id, is_read, created_at DESC)",
)
