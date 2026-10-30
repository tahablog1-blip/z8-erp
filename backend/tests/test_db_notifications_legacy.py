# جدول notifications بالتصميم القديم (كما في قاعدة الإنتاج) يُرقّى بلا فقد بيانات، وتعمل القراءة والإنشاء والتعليم كمقروء بعده.
import uuid

import pytest

from conftest import CO, run

pytestmark = pytest.mark.db
CID = uuid.UUID(CO)

LEGACY = """CREATE TABLE notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid NOT NULL, recipient_user_id uuid, recipient_permission text, recipient_branch_id uuid,
  type text NOT NULL, title text NOT NULL, body text, link_section text, link_pane text, link_id uuid, created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(), CHECK (recipient_user_id IS NOT NULL OR recipient_permission IS NOT NULL));
CREATE TABLE notification_reads (notification_id uuid REFERENCES notifications(id) ON DELETE CASCADE, user_id uuid)"""


@pytest.fixture
def legacy(db_ready):
    from app.core import db
    from app.modules.notifications.schema import NOTIFICATIONS_ENSURE_SQL

    async def go():
        async with db.pool().acquire() as c:
            await c.execute("DROP TABLE IF EXISTS notification_reads, notifications CASCADE")
            await c.execute("TRUNCATE users RESTART IDENTITY CASCADE")
            await c.execute(LEGACY)
            u = uuid.uuid4()
            await c.execute("INSERT INTO users (id, company_id, full_name, email, permissions) VALUES ($1,$2,'مستخدم','u@x','[\"products.view_stock\"]'::jsonb)", u, CID)
            await c.execute("INSERT INTO notifications (company_id, recipient_user_id, type, title) VALUES ($1,$2,'old','قديم')", CID, u)
            for stmt in NOTIFICATIONS_ENSURE_SQL:           # نفس ما يشغّله الإقلاع
                await c.execute(stmt)
            return str(u)
    return run(go)


def test_legacy_table_upgrades_and_old_rows_survive(legacy):
    from app.modules.notifications import service
    assert run(lambda: service.unread_count(CO, legacy)) == 0          # كان 500 (column "user_id" does not exist)
    from app.core import db
    assert run(lambda: db.fetchrow("SELECT COUNT(*)::int AS n FROM notifications"))["n"] == 1


def test_notify_read_and_mark_read_after_upgrade(legacy):
    from app.core import notify
    from app.modules.notifications import service
    run(lambda: notify.notify_users_with_permission(CO, "products.view_stock", "low_stock", "نقص مخزون", body="x", link="/inventory", severity="warn", dedupe_key="k1"))
    assert run(lambda: service.unread_count(CO, legacy)) == 1
    run(lambda: notify.notify_users_with_permission(CO, "products.view_stock", "low_stock", "نقص مخزون", dedupe_key="k1"))   # لا تكرار لنفس المفتاح
    assert run(lambda: service.unread_count(CO, legacy)) == 1
    items = run(lambda: service.list_notifications(CO, legacy))
    assert len(items) == 1 and items[0]["severity"] == "warn" and items[0]["is_read"] is False
    run(lambda: service.mark_read(CO, legacy, items[0]["id"]))
    assert run(lambda: service.unread_count(CO, legacy)) == 0
    run(lambda: notify.notify_users_with_permission(CO, "products.view_stock", "low_stock", "آخر", dedupe_key="k2"))
    run(lambda: service.mark_all_read(CO, legacy))
    assert run(lambda: service.unread_count(CO, legacy)) == 0


def test_ensure_is_idempotent_on_fresh_table(db_ready):
    from app.core import db
    from app.modules.notifications.schema import NOTIFICATIONS_ENSURE_SQL

    async def go():
        async with db.pool().acquire() as c:
            await c.execute("DROP TABLE IF EXISTS notification_reads, notifications CASCADE")
            for _ in range(2):
                for stmt in NOTIFICATIONS_ENSURE_SQL:
                    await c.execute(stmt)
    run(go)
