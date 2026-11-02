# modules/cars/notify_inbox.py — صندوق إشعارات العميل داخل تطبيق العميل (زر الجرس)
# كل حدث يخص العميل (تسجيل سيارة، حجز، دخول/انتهاء الخدمة، رسالة من الفرع، قرب موعد التغيير)
# يُسجَّل صفاً هنا؛ التطبيق يجلبها دورياً. الفشل هنا لا يعطّل العملية الأصلية أبداً.
from ...core.db import execute, fetch, fetchrow

DUE_AFTER_DAYS = 150     # قرب موعد تغيير الزيت: بعد ~5 أشهر من آخر فاتورة للسيارة
KINDS = ("car_registered", "booking", "turn_near", "in_service", "done", "message", "due")


async def add(company_id, customer_id, kind: str, title: str, body: str = "", *,
              branch_id=None, ref_id=None, dedupe: str | None = None, meta: str | None = None) -> None:
    """يضيف إشعاراً. dedupe: مفتاح يمنع تكرار نفس الإشعار للعميل."""
    if not customer_id:
        return
    try:
        await execute(
            """INSERT INTO customer_notifications
                 (company_id, customer_id, branch_id, kind, title, body, ref_id, dedupe, meta)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
               ON CONFLICT DO NOTHING""",
            company_id, customer_id, branch_id, kind, title, body,
            str(ref_id) if ref_id else None, dedupe, meta)
    except Exception as e:                       # ✋ لا يكسر العملية الأصلية
        print(f"⚠ إشعار العميل: {type(e).__name__}: {e}")


async def add_for_visit(car_id, kind: str, title: str, body: str = "", *, dedupe: str | None = None, meta: str | None = None) -> None:
    """إشعار لصاحب زيارة (سجل cars) — يُستنتج العميل والفرع منها."""
    try:
        r = await fetchrow("SELECT company_id, branch_id, customer_id, plate FROM cars WHERE id=$1::uuid", str(car_id))
    except Exception:
        return
    if r and r["customer_id"]:
        await add(r["company_id"], r["customer_id"], kind, title,
                  body.replace("{plate}", r["plate"] or ""), branch_id=r["branch_id"], ref_id=car_id, dedupe=dedupe,
                  meta=meta if meta is not None else (r["plate"] or ""))


async def generate_due(company_id, customer_id) -> None:
    """تذكير «قرب موعد التغيير» لكل سيارة مضى على آخر فاتورة لها DUE_AFTER_DAYS — مرة لكل فاتورة."""
    rows = await fetch(
        """SELECT DISTINCT ON (UPPER(REPLACE(c.plate,' ',''))) i.id, c.plate, i.issued_at
           FROM invoices i JOIN cars c ON c.id = i.car_id
           WHERE i.company_id=$1 AND i.customer_id=$2 AND i.is_returned=FALSE
             AND COALESCE(c.plate,'') <> ''
           ORDER BY UPPER(REPLACE(c.plate,' ','')), i.issued_at DESC""",
        company_id, customer_id)
    import datetime as _dt
    now = _dt.datetime.now(_dt.timezone.utc)
    for r in rows:
        at = r["issued_at"]
        if at is not None and at.tzinfo is None:
            at = at.replace(tzinfo=_dt.timezone.utc)
        if at is not None and (now - at).days >= DUE_AFTER_DAYS:
            await add(company_id, customer_id, "due", "اقترب موعد تغيير الزيت",
                      f"مرّت أكثر من {DUE_AFTER_DAYS // 30} أشهر على آخر خدمة لسيارتك {r['plate']} — احجز دورك الآن.",
                      dedupe=f"due:{r['id']}", meta=r["plate"])


async def list_for(company_id, customer_id, limit: int = 60) -> dict:
    await generate_due(company_id, customer_id)
    rows = await fetch(
        """SELECT id, kind, title, body, meta, ref_id, branch_id, created_at, read_at
           FROM customer_notifications WHERE company_id=$1 AND customer_id=$2
           ORDER BY created_at DESC LIMIT $3""", company_id, customer_id, limit)
    items = [{"id": str(r["id"]), "kind": r["kind"], "title": r["title"], "body": r["body"] or "", "meta": r["meta"] or "",
              "refId": r["ref_id"], "branchId": str(r["branch_id"]) if r["branch_id"] else None,
              "at": r["created_at"].isoformat(), "read": r["read_at"] is not None} for r in rows]
    return {"items": items, "unread": sum(1 for i in items if not i["read"])}


async def mark_read(company_id, customer_id, ids: list[str] | None) -> None:
    if ids:
        await execute(
            """UPDATE customer_notifications SET read_at=now()
               WHERE company_id=$1 AND customer_id=$2 AND read_at IS NULL AND id = ANY($3::uuid[])""",
            company_id, customer_id, [i for i in ids if len(i) == 36])
    else:
        await execute("UPDATE customer_notifications SET read_at=now() WHERE company_id=$1 AND customer_id=$2 AND read_at IS NULL",
                      company_id, customer_id)


async def chats_for(company_id, customer_id, limit: int = 30) -> list[dict]:
    """محادثات العميل: زيارة (سيارة) لكل محادثة، آخر رسالة وعدد غير المقروء من الفرع."""
    rows = await fetch(
        """SELECT c.id, c.plate, c.brand, c.name, b.name AS branch_name,
                  m.message AS last_msg, m.sender_type AS last_from, m.created_at AS last_at,
                  (SELECT COUNT(*) FROM service_messages x WHERE x.work_order_id=c.id
                     AND x.sender_type='employee' AND x.is_read=FALSE
                     AND COALESCE(x.message_type,'') <> 'note_internal') AS unread
           FROM cars c
           JOIN branches b ON b.id = c.branch_id
           JOIN LATERAL (SELECT message, sender_type, created_at FROM service_messages
                          WHERE work_order_id=c.id AND COALESCE(message_type,'') <> 'note_internal'
                          ORDER BY created_at DESC LIMIT 1) m ON TRUE
           WHERE c.company_id=$1 AND c.customer_id=$2 AND c.is_deleted=FALSE
           ORDER BY m.created_at DESC LIMIT $3""", company_id, customer_id, limit)
    return [{"bookingId": str(r["id"]), "plate": r["plate"], "carLabel": " ".join(x for x in [r["brand"], r["name"]] if x) or None,
             "branchName": r["branch_name"], "lastMessage": r["last_msg"] or "", "lastFromCustomer": r["last_from"] == "customer",
             "lastAt": r["last_at"].isoformat(), "unread": int(r["unread"] or 0)} for r in rows]
