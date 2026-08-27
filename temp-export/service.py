# modules/service_notes/service.py — منطق الأعمال
# القاعدة الذهبية (بند 30): الملاحظة تخزن IDs فقط — البيانات تتسحب join وقت العرض
import os
import uuid as uuidlib

from fastapi import HTTPException, UploadFile

from ...core.db import fetch, fetchrow, execute
from ...core import wa
from ...core import audit

UPLOAD_DIR = os.environ.get("NOTES_UPLOAD_DIR", "uploads/notes")

# ═══ السحب التلقائي: من أمر العمل (السيارة) لكل الـ IDs (بند 2) ═══
async def resolve_work_order(company_id: str, work_order_id: str) -> dict:
    row = await fetchrow(
        """SELECT c.id, c.company_id, c.branch_id, c.customer_id, c.plate,
                  c.brand, c.name AS car_name, c.model_year,
                  cu.name AS customer_name, cu.phone AS customer_phone
           FROM cars c
           LEFT JOIN customers cu ON cu.id = c.customer_id
           WHERE c.id = $1::uuid AND c.company_id = $2::uuid""",
        work_order_id, company_id)
    if not row:
        raise HTTPException(404, "أمر العمل غير موجود")
    return dict(row)


# ═══ إنشاء ملاحظة — الكمية المتوفرة تتسحب من المخزون تلقائياً (بند 1) ═══
async def create_note(user, body) -> dict:
    wo = await resolve_work_order(user.company_id, body.workOrderId)

    available = None
    if body.productId:
        prod = await fetchrow(
            """SELECT p.id, COALESCE(SUM(s.qty), 0) AS qty
               FROM products p
               LEFT JOIN inventory s ON s.product_id = p.id AND s.loc_type = 'branch'
                    AND ($2::text IS NULL OR s.loc_id = $2::text)
               WHERE p.id = $1::uuid GROUP BY p.id""",
            body.productId, wo["branch_id"])
        if not prod:
            raise HTTPException(404, "المنتج غير موجود")
        available = int(prod["qty"])

    row = await fetchrow(
        """INSERT INTO service_notes
             (company_id, branch_id, work_order_id, customer_id, vehicle_id,
              employee_id, product_id, type, title, description,
              required_quantity, available_quantity, priority)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
           RETURNING id, note_number""",
        user.company_id, wo["branch_id"], wo["id"], wo["customer_id"], wo["id"],
        user.user_id, body.productId, body.type, body.title,
        body.description, body.requiredQuantity, available, body.priority)

    await audit.log(
        company_id=user.company_id, user_id=user.user_id, user_email=user.email,
        action="service_note.create", entity="service_notes",
        entity_id=str(row["id"]),
        new_value={"note_number": row["note_number"], "type": body.type},
    )
    return {"id": str(row["id"]), "noteNumber": row["note_number"],
            "availableQuantity": available}


# ═══ حفظ مرفق (صورة/فيديو/ملف) على القرص وربطه بالملاحظة (بند 7) ═══
async def save_attachment(user, note_id: str, file: UploadFile) -> dict:
    note = await fetchrow(
        "SELECT id FROM service_notes WHERE id=$1::uuid AND company_id=$2::uuid",
        note_id, user.company_id)
    if not note:
        raise HTTPException(404, "الملاحظة غير موجودة")

    ctype = (file.content_type or "").lower()
    if ctype.startswith("image/"):
        ftype = "image"
    elif ctype.startswith("video/"):
        ftype = "video"
    else:
        ftype = "file"

    os.makedirs(UPLOAD_DIR, exist_ok=True)
    ext = os.path.splitext(file.filename or "")[1][:10] or ".bin"
    fname = f"{uuidlib.uuid4().hex}{ext}"
    path = os.path.join(UPLOAD_DIR, fname)
    data = await file.read()
    if len(data) > 25 * 1024 * 1024:
        raise HTTPException(400, "الحد الأقصى للمرفق 25 ميجا")
    with open(path, "wb") as f:
        f.write(data)

    url = f"/api/service-notes/attachments/file/{fname}"
    await execute(
        """INSERT INTO service_note_attachments (note_id, file_url, file_type, uploaded_by)
           VALUES ($1,$2,$3,$4)""",
        note_id, url, ftype, user.user_id)
    return {"url": url, "type": ftype}


# ═══ إبلاغ العميل: رسالة محادثة + إشعار واتساب بالرابط الآمن (بنود 9-10) ═══
async def notify_customer(user, note_id: str, message: str) -> dict:
    note = await fetchrow(
        """SELECT n.*, c.public_token, cu.phone AS customer_phone
           FROM service_notes n
           JOIN cars c ON c.id = n.work_order_id
           LEFT JOIN customers cu ON cu.id = n.customer_id
           WHERE n.id = $1::uuid AND n.company_id = $2::uuid""",
        note_id, user.company_id)
    if not note:
        raise HTTPException(404, "الملاحظة غير موجودة")

    # 1) رسالة داخل محادثة الحجز
    await execute(
        """INSERT INTO service_messages
             (company_id, branch_id, work_order_id, customer_id, employee_id,
              note_id, sender_type, message)
           VALUES ($1,$2,$3,$4,$5,$6,'employee',$7)""",
        user.company_id, note["branch_id"], note["work_order_id"],
        note["customer_id"], user.user_id, note_id, message)

    # 2) الملاحظة تبقى ظاهرة للعميل + حالتها بانتظار رده
    await execute(
        """UPDATE service_notes
           SET customer_visible = TRUE,
               status = CASE WHEN status = 'new' THEN 'awaiting_customer' ELSE status END,
               updated_at = now()
           WHERE id = $1::uuid""", note_id)

    # 3) إشعار واتساب مختصر بالرابط الآمن — مش المحادثة كاملة (بند 10)
    base = os.environ.get("PUBLIC_BASE_URL", "").rstrip("/")
    link = f"{base}/booking/status/{note['public_token']}" if base else ""
    wa_ok = False
    if note["customer_phone"]:
        text = ("🔔 لديك رسالة جديدة من موظف الخدمة بخصوص سيارتك.\n"
                + (f"للاطلاع والرد: {link}" if link else "افتح صفحة الحجز للاطلاع والرد."))
        wa_ok = await wa.send_text(user.company_id, note["customer_phone"], text)

    return {"sent": True, "whatsapp": wa_ok}


# ═══ إحصائيات لوحة التحكم (بند 4) ═══
async def dashboard_counts(company_id: str, branch_id: str | None) -> dict:
    row = await fetchrow(
        """SELECT
             COUNT(*)                                                    AS total,
             COUNT(*) FILTER (WHERE status = 'new')                      AS new,
             COUNT(*) FILTER (WHERE status IN
                 ('in_progress','awaiting_customer','awaiting_management')) AS follow_up,
             COUNT(*) FILTER (WHERE status IN ('closed','handled'))      AS closed,
             COUNT(*) FILTER (WHERE type IN ('out_of_stock','low_stock')) AS out_of_stock,
             COUNT(*) FILTER (WHERE type = 'technical')                  AS technical,
             COUNT(*) FILTER (WHERE status = 'awaiting_management')      AS needs_management
           FROM service_notes
           WHERE company_id = $1::uuid
             AND ($2::uuid IS NULL OR branch_id = $2::uuid)""",
        company_id, branch_id)
    return dict(row)





