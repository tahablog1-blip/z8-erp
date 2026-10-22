# modules/shortage_sync/service.py — منطق الأعمال معزول عن طبقة الـ HTTP
import json
from ...core.db import fetch, fetchrow, execute


def _order_row_out(r: dict) -> dict:
    items = r["items"]
    if isinstance(items, str):
        items = json.loads(items)
    return {
        "id": r["id"],
        "userId": str(r["user_id"]),
        "userName": r["user_name"],
        "branchId": str(r["branch_id"]) if r.get("branch_id") else None,
        "branchName": r.get("branch_name"),
        "items": items or [],
        "itemCount": r["item_count"],
        "totalAmount": float(r["total_amount"]),
        "createdAt": r["created_at"],
        "updatedAt": r["updated_at"],
    }


async def upsert_order(company_id: str, user_id: str, branch_id: str | None,
                        order_id: str, items: list[dict]) -> dict:
    item_count = sum(int(i.get("qty", 0)) for i in items)
    total_amount = sum(float(i.get("price", 0)) * int(i.get("qty", 0)) for i in items)
    row = await fetchrow(
        """INSERT INTO shortage_orders
               (id, company_id, user_id, branch_id, items, item_count, total_amount, updated_at)
           VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, now())
           ON CONFLICT (id) DO UPDATE
               SET items = EXCLUDED.items, item_count = EXCLUDED.item_count,
                   total_amount = EXCLUDED.total_amount, updated_at = now()
           RETURNING id, company_id, user_id, branch_id, items, item_count,
                     total_amount, created_at, updated_at""",
        order_id, company_id, user_id, branch_id, json.dumps(items), item_count, total_amount,
    )
    return await _attach_names(row)


async def _attach_names(row: dict) -> dict:
    u = await fetchrow(
        "SELECT full_name, email FROM users WHERE id = $1", row["user_id"]
    )
    b = None
    if row.get("branch_id"):
        b = await fetchrow("SELECT name FROM branches WHERE id = $1", row["branch_id"])
    row = dict(row)
    row["user_name"] = (u["full_name"] if u else None) or (u["email"] if u else "")
    row["branch_name"] = b["name"] if b else None
    return _order_row_out(row)


async def list_orders(company_id: str, user_id: str | None) -> list[dict]:
    """user_id=None → كل طلبيات الشركة (الإدمن فقط يستخدم هذا المسار من طبقة الـ API).
    غير ذلك → طلبيات هذا المستخدم فقط."""
    if user_id is None:
        rows = await fetch(
            """SELECT o.id, o.company_id, o.user_id, o.branch_id, o.items, o.item_count,
                      o.total_amount, o.created_at, o.updated_at,
                      u.full_name AS user_name, u.email AS user_email, b.name AS branch_name
               FROM shortage_orders o
               LEFT JOIN users u ON u.id = o.user_id
               LEFT JOIN branches b ON b.id = o.branch_id
               WHERE o.company_id = $1
               ORDER BY o.updated_at DESC
               LIMIT 500""",
            company_id,
        )
    else:
        rows = await fetch(
            """SELECT o.id, o.company_id, o.user_id, o.branch_id, o.items, o.item_count,
                      o.total_amount, o.created_at, o.updated_at,
                      u.full_name AS user_name, u.email AS user_email, b.name AS branch_name
               FROM shortage_orders o
               LEFT JOIN users u ON u.id = o.user_id
               LEFT JOIN branches b ON b.id = o.branch_id
               WHERE o.company_id = $1 AND o.user_id = $2
               ORDER BY o.updated_at DESC
               LIMIT 500""",
            company_id, user_id,
        )
    out = []
    for r in rows:
        r = dict(r)
        r["user_name"] = r.get("user_name") or r.get("user_email") or ""
        out.append(_order_row_out(r))
    return out


async def list_device_status(company_id: str) -> list[dict]:
    """شاشة 'الأجهزة المتصلة' للإدمن — مبنية على جدول user_sessions الموجود
    فعلاً (نفس جلسات تسجيل الدخول العادية)، بدون أي جدول حضور إضافي.
    أونلاين = عنده جلسة غير مُلغاة تحرّكت آخر 10 دقائق."""
    rows = await fetch(
        """SELECT u.id AS user_id, u.full_name, u.email, u.branch_id, b.name AS branch_name,
                  s.last_seen_at,
                  (s.last_seen_at IS NOT NULL AND s.last_seen_at > now() - interval '10 minutes') AS online
           FROM users u
           LEFT JOIN branches b ON b.id = u.branch_id
           LEFT JOIN (
               SELECT user_id, MAX(last_seen_at) AS last_seen_at
               FROM user_sessions
               WHERE revoked_at IS NULL
               GROUP BY user_id
           ) s ON s.user_id = u.id
           WHERE u.company_id = $1 AND u.is_active = TRUE
           ORDER BY online DESC, u.full_name""",
        company_id,
    )
    return [
        {
            "userId": str(r["user_id"]),
            "fullName": r["full_name"],
            "email": r["email"],
            "branchId": str(r["branch_id"]) if r["branch_id"] else None,
            "branchName": r["branch_name"],
            "online": bool(r["online"]),
            "lastSeenAt": r["last_seen_at"],
        }
        for r in rows
    ]


async def upload_catalog(company_id: str, user_id: str, items: list[dict]) -> dict:
    """الإدمن بيستبدل الكتالوج المشترك بالكامل بالنسخة اللي استورد عمودها من إكسل على
    جهازه - نفس منطق الاستيراد اليدوي الموجود فعلاً (CsvImporter)، بس بيتبعت هنا كمان
    عشان باقي الأجهزة تاخده. تحديث كامل (استبدال) مش دمج، زي أي استيراد كتالوج تاني."""
    row = await fetchrow(
        """INSERT INTO shortage_catalog (company_id, products, item_count, updated_by, updated_at)
           VALUES ($1, $2::jsonb, $3, $4, now())
           ON CONFLICT (company_id) DO UPDATE
               SET products = EXCLUDED.products, item_count = EXCLUDED.item_count,
                   updated_by = EXCLUDED.updated_by, updated_at = now()
           RETURNING item_count, updated_at""",
        company_id, json.dumps(items), len(items), user_id,
    )
    return {"itemCount": row["item_count"], "updatedAt": row["updated_at"]}


async def get_catalog(company_id: str) -> dict:
    row = await fetchrow(
        "SELECT products, item_count, updated_at FROM shortage_catalog WHERE company_id = $1",
        company_id,
    )
    if not row:
        return {"items": [], "itemCount": 0, "updatedAt": None}
    products = row["products"]
    if isinstance(products, str):
        products = json.loads(products)
    return {"items": products or [], "itemCount": row["item_count"], "updatedAt": row["updated_at"]}


async def get_catalog_version(company_id: str) -> dict:
    """نسخة خفيفة (من غير كل الأصناف) تُستخدم في البولينج الدوري على كل الأجهزة -
    بس توقيت آخر تحديث وعدد الأصناف، عشان نعرف لو فيه نسخة أحدث من غير ما نجيب
    آلاف الأصناف كل 20 ثانية."""
    row = await fetchrow(
        "SELECT item_count, updated_at FROM shortage_catalog WHERE company_id = $1",
        company_id,
    )
    if not row:
        return {"itemCount": 0, "updatedAt": None}
    return {"itemCount": row["item_count"], "updatedAt": row["updated_at"]}


async def create_announcement(company_id: str, created_by: str, message: str) -> dict:
    row = await fetchrow(
        """INSERT INTO shortage_announcements (company_id, message, created_by)
           VALUES ($1, $2, $3)
           RETURNING id, message, created_by, created_at, active""",
        company_id, message.strip(), created_by,
    )
    u = await fetchrow("SELECT full_name, email FROM users WHERE id = $1", created_by)
    return {
        "id": str(row["id"]),
        "message": row["message"],
        "createdByName": (u["full_name"] if u else None) or (u["email"] if u else ""),
        "createdAt": row["created_at"],
        "active": row["active"],
    }


async def list_active_announcements(company_id: str, limit: int = 5) -> list[dict]:
    rows = await fetch(
        """SELECT a.id, a.message, a.created_at, a.active, u.full_name, u.email
           FROM shortage_announcements a
           LEFT JOIN users u ON u.id = a.created_by
           WHERE a.company_id = $1 AND a.active = TRUE
           ORDER BY a.created_at DESC
           LIMIT $2""",
        company_id, limit,
    )
    return [
        {
            "id": str(r["id"]),
            "message": r["message"],
            "createdByName": r["full_name"] or r["email"] or "",
            "createdAt": r["created_at"],
            "active": r["active"],
        }
        for r in rows
    ]


async def deactivate_announcement(company_id: str, announcement_id: str) -> None:
    await execute(
        "UPDATE shortage_announcements SET active = FALSE WHERE id = $1 AND company_id = $2",
        announcement_id, company_id,
    )
