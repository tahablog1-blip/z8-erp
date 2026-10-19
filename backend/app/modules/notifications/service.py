# modules/notifications/service.py — مركز الإشعارات: قراءة المستخدم لإشعاراته
# الإنشاء نفسه (fan-out حسب الصلاحية) مركزي في core/notify.py، تستخدمه الموديولات
# الأخرى (مخزون، مشتريات، ورديات...) مباشرة — هذا الملف للقراءة والتعليم كمقروء فقط.
from fastapi import HTTPException

from ...core.db import execute, fetch, fetchrow


def _out(r: dict) -> dict:
    r = dict(r)
    r["id"] = str(r["id"])
    return r


async def list_notifications(company_id: str, user_id: str, only_unread: bool = False,
                              limit: int = 50) -> list[dict]:
    conditions = ["company_id=$1", "user_id=$2"]
    if only_unread:
        conditions.append("is_read = FALSE")
    rows = await fetch(
        f"""SELECT * FROM notifications WHERE {' AND '.join(conditions)}
           ORDER BY created_at DESC LIMIT {min(max(limit, 1), 200)}""",
        company_id, user_id)
    return [_out(r) for r in rows]


async def unread_count(company_id: str, user_id: str) -> int:
    row = await fetchrow(
        "SELECT COUNT(*)::int AS n FROM notifications WHERE company_id=$1 AND user_id=$2 AND is_read=FALSE",
        company_id, user_id)
    return row["n"]


async def mark_read(company_id: str, user_id: str, notification_id: str) -> None:
    row = await fetchrow(
        """UPDATE notifications SET is_read=TRUE
           WHERE id=$1 AND company_id=$2 AND user_id=$3 RETURNING id""",
        notification_id, company_id, user_id)
    if not row:
        raise HTTPException(404, "الإشعار غير موجود")


async def mark_all_read(company_id: str, user_id: str) -> None:
    await execute(
        "UPDATE notifications SET is_read=TRUE WHERE company_id=$1 AND user_id=$2 AND is_read=FALSE",
        company_id, user_id)
