# modules/terminal/schema.py — DDL تابلت الكاشير (يستعمله ensure-schema في main.py والاختبارات): إضافات فقط
TERMINAL_ENSURE_SQL = (
    # رموز الدخول (9 أرقام) لكل فرع ونوع — تُخزَّن HMAC لا نصاً صريحاً؛ النص يظهر للمدير مرة واحدة عند الإنشاء
    """CREATE TABLE IF NOT EXISTS pos_access_codes (
         id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
         company_id uuid NOT NULL,
         branch_id uuid NOT NULL,
         kind text NOT NULL CHECK (kind IN ('cashier','service_notes','cars','workorder')),
         code_hash text NOT NULL UNIQUE,
         acts_as_user_id uuid,
         created_at timestamptz NOT NULL DEFAULT now(),
         rotated_at timestamptz NOT NULL DEFAULT now(),
         UNIQUE (branch_id, kind)
       )""",
    # الأجهزة التي فُعّلت برمز (إيقاف جهاز مفقود يقطعه فوراً)
    """CREATE TABLE IF NOT EXISTS pos_devices (
         id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
         company_id uuid NOT NULL,
         branch_id uuid NOT NULL,
         device_key text NOT NULL,
         name text,
         created_at timestamptz NOT NULL DEFAULT now(),
         last_seen_at timestamptz NOT NULL DEFAULT now(),
         revoked_at timestamptz,
         UNIQUE (company_id, device_key)
       )""",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS pos_pin_hash text",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS pos_pin_failed integer NOT NULL DEFAULT 0",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS pos_pin_locked_until timestamptz",
    # الجلسة تتبع الجهاز: أي كاشير على نفس التابلت يكمل الجلسة المفتوحة
    "ALTER TABLE shifts ADD COLUMN IF NOT EXISTS device_id uuid",
    "ALTER TABLE user_sessions ADD COLUMN IF NOT EXISTS pos_device_id uuid",
    "CREATE INDEX IF NOT EXISTS idx_shifts_device_open ON shifts(device_id) WHERE status = 'open'",
)
