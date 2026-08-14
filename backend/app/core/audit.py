"""سجل التدقيق — دالتان مكمّلتان:
   log_action(user, action, category, details=None) — الأصلية، تُستخدم في branches/products
   log(...) — الأحدث (خصومات/مبيعات آجلة)، تكتب لجدول audit_log التفصيلي
كلاهما fire-and-forget: فشل التسجيل لا يفشل العملية الأصلية أبداً."""
from .db import execute


async def log(company_id: str, user_id: str | None, user_email: str | None,
              action: str, entity: str, entity_id: str | None = None,
              old_value: str | None = None, new_value: str | None = None,
              reason: str | None = None, branch_id: str | None = None) -> None:
    try:
        await execute(
            """INSERT INTO audit_log
                 (company_id, branch_id, user_id, user_email, action, entity,
                  entity_id, old_value, new_value, reason)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)""",
            company_id, branch_id, user_id, user_email, action, entity,
            entity_id, old_value, new_value, reason)
    except Exception as e:
        print(f"⚠ سجل التدقيق فشل ({action}/{entity}): {e}")


async def log_action(user, action: str, category: str, details: str | None = None) -> None:
    """الدالة الأصلية — تُستخدم في branches و products.
    user: كائن CurrentUser (بصلاحياته وهويته الكاملة)."""
    await log(
        company_id=getattr(user, "company_id", None),
        user_id=getattr(user, "user_id", None),
        user_email=getattr(user, "email", None),
        action=action, entity=category, new_value=details,
        branch_id=getattr(user, "branch_id", None),
    )
