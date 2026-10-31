# modules/edge/schema.py — وكلاء المحطات (Edge Agents): إضافات فقط
EDGE_ENSURE_SQL = (
    """CREATE TABLE IF NOT EXISTS edge_agents (
         id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
         company_id uuid NOT NULL,
         branch_id uuid NOT NULL,
         name text NOT NULL,
         key_hash text NOT NULL UNIQUE,
         version text,
         last_seen timestamptz,
         cameras jsonb NOT NULL DEFAULT '{}'::jsonb,
         created_at timestamptz NOT NULL DEFAULT now(),
         revoked_at timestamptz
       )""",
    # طابور أوامر قصير العمر: السيرفر يطلب لقطة، الوكيل (داخل شبكة المحطة) ينفّذها ويرفعها
    """CREATE TABLE IF NOT EXISTS edge_commands (
         id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
         agent_id uuid NOT NULL,
         camera_id uuid NOT NULL,
         kind text NOT NULL DEFAULT 'snapshot',
         status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','claimed','done','failed')),
         jpeg bytea,
         error text,
         created_at timestamptz NOT NULL DEFAULT now(),
         claimed_at timestamptz,
         done_at timestamptz
       )""",
    "CREATE INDEX IF NOT EXISTS idx_edge_commands_agent ON edge_commands(agent_id, status)",
)
