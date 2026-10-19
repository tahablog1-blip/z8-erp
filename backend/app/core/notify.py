# core/notify.py — مركز إشعارات النظام: مساعد عام تستدعيه أي موديولة (مخزون،
# مشتريات، ورديات...) لإبلاغ كل المستخدمين الحاصلين على صلاحية معيّنة.
# يُستدعى دايماً بعد نجاح الـ transaction الأصلية (لا من داخلها) — الإشعار
# أثر جانبي، ولا ينبغي أن يفشل أو يتأثر بمصير العملية المحاسبية الأصلية.
from .db import execute, fetch


async def notify_users_with_permission(
    company_id: str, permission: str, ntype: str, title: str,
    body: str | None = None, link: str | None = None,
    severity: str = "info", dedupe_key: str | None = None,
) -> None:
    """يبلّغ كل المستخدمين الفعّالين في الشركة الحاصلين على هذه الصلاحية.

    dedupe_key: مفتاح منع التكرار (مثلاً f"low_stock:{product_id}:{loc_id}") —
    لو عند المستخدم نفسه إشعار غير مقروء بنفس المفتاح، نتجاهل الإضافة بدل
    ما نكرّر نفس التنبيه في كل عملية بيع/تحويل لاحقة على نفس الصنف.
    أخطاء هنا متعمد تجاهلها (best-effort) — فشل الإشعار لا يوقف العملية الأصلية."""
    try:
        users = await fetch(
            "SELECT id, email FROM users WHERE company_id=$1 AND is_active=TRUE AND permissions ? $2",
            company_id, permission)
        email_kv: dict[str, str] | None = None
        for u in users:
            if dedupe_key:
                existing = await fetch(
                    """SELECT id FROM notifications
                       WHERE company_id=$1 AND user_id=$2 AND dedupe_key=$3 AND is_read=FALSE LIMIT 1""",
                    company_id, u["id"], dedupe_key)
                if existing:
                    continue
            await execute(
                """INSERT INTO notifications (company_id, user_id, type, title, body, link, severity, dedupe_key)
                   VALUES ($1,$2,$3,$4,$5,$6,$7,$8)""",
                company_id, u["id"], ntype, title, body, link, severity, dedupe_key)

            # بريد إلكتروني تلقائي للتنبيهات المهمة (warn/danger) فقط — لو مفعّل
            if severity in ("warn", "danger") and u["email"]:
                if email_kv is None:
                    rows = await fetch(
                        "SELECT key, value FROM company_settings WHERE company_id=$1 "
                        "AND key IN ('email.enabled','email.notifyOnWarnAndDanger')", company_id)
                    email_kv = {r["key"]: r["value"] for r in rows}
                if email_kv.get("email.enabled") == "1" and email_kv.get("email.notifyOnWarnAndDanger", "1") == "1":
                    from . import email as _email
                    await _email.send_email(company_id, u["email"], title, body or title)
    except Exception as e:
        print(f"⚠ notify: فشل إنشاء إشعار ({ntype}): {e}")
