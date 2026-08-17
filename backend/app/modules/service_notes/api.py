# modules/service_notes/api.py — نقاط النهاية (بند 29 بالحرف + مسارات العميل العامة)
import os

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse

from ...core.db import fetch, fetchrow, execute
from ...core.deps import CurrentUser, get_current_user, require_permission
from . import service
from .schemas import (
    MessageCreate, NoteCreate, NoteStatusUpdate, NoteUpdate,
    NotifyCustomerBody, TemplateCreate, TemplateUpdate,
    STATUS_LABELS, TYPE_LABELS,
)

router = APIRouter()

_LIST_SQL = """
    SELECT n.id, n.note_number, n.type, n.status, n.priority, n.title,
           n.description, n.required_quantity, n.available_quantity,
           n.customer_visible, n.created_at, n.updated_at,
           n.work_order_id, n.customer_id, n.product_id, n.branch_id,
           c.plate, c.brand, c.name AS car_name, c.model_year,
           cu.name AS customer_name, cu.phone AS customer_phone,
           p.name AS product_name, p.barcode AS product_barcode,
           u.full_name AS employee_name,
           b.name AS branch_name,
           (SELECT COUNT(*) FROM service_note_attachments a
             WHERE a.note_id = n.id) AS attachments_count
    FROM service_notes n
    LEFT JOIN cars c       ON c.id  = n.work_order_id
    LEFT JOIN customers cu ON cu.id = n.customer_id
    LEFT JOIN products p   ON p.id  = n.product_id
    LEFT JOIN users u      ON u.id  = n.employee_id
    LEFT JOIN branches b   ON b.id  = n.branch_id
"""


# ═══════════ الإحصائيات ═══════════
@router.get("/dashboard")
async def dashboard(user: CurrentUser = Depends(require_permission("service_notes.view"))):
    counts = await service.dashboard_counts(user.company_id, user.branch_id)
    return {"counts": counts, "typeLabels": TYPE_LABELS, "statusLabels": STATUS_LABELS}


# ═══════════ قائمة الملاحظات + بحث وفلترة (بند 18) ═══════════
@router.get("")
async def list_notes(
    status: str | None = None,
    type: str | None = None,
    branchId: str | None = None,
    q: str | None = Query(default=None, description="بحث: عميل/جوال/لوحة/منتج/رقم ملاحظة"),
    limit: int = Query(default=100, le=300),
    user: CurrentUser = Depends(require_permission("service_notes.view")),
):
    sql = _LIST_SQL + " WHERE n.company_id = $1::uuid"
    args: list = [user.company_id]

    # الموظف العادي يشوف فرعه فقط — الإدارة تشوف الكل (بند 22)
    scope_branch = branchId or (user.branch_id if "service_notes.manage" not in user.permissions else None)
    if scope_branch:
        args.append(scope_branch)
        sql += f" AND n.branch_id = ${len(args)}::uuid"
    if status:
        args.append(status)
        sql += f" AND n.status = ${len(args)}"
    if type:
        args.append(type)
        sql += f" AND n.type = ${len(args)}"
    if q:
        args.append(f"%{q.strip()}%")
        i = len(args)
        sql += f""" AND (n.note_number ILIKE ${i} OR cu.name ILIKE ${i}
                    OR cu.phone ILIKE ${i} OR c.plate ILIKE ${i}
                    OR p.name ILIKE ${i} OR p.barcode ILIKE ${i}
                    OR u.full_name ILIKE ${i})"""
    args.append(limit)
    sql += f" ORDER BY n.created_at DESC LIMIT ${len(args)}"
    rows = await fetch(sql, *args)
    return [dict(r) for r in rows]


# ═══════════ ملاحظات أمر عمل معيّن (بند 21) ═══════════
@router.get("/work-order/{work_order_id}")
async def work_order_notes(
    work_order_id: str,
    user: CurrentUser = Depends(require_permission("service_notes.view",
                                                   "service_notes.create")),
):
    rows = await fetch(
        _LIST_SQL + " WHERE n.company_id=$1::uuid AND n.work_order_id=$2::uuid"
                    " ORDER BY n.created_at DESC",
        user.company_id, work_order_id)
    return [dict(r) for r in rows]


# ═══════════ إنشاء ملاحظة (بند 1-2) ═══════════
@router.post("")
async def create_note(
    body: NoteCreate,
    user: CurrentUser = Depends(require_permission("service_notes.create")),
):
    return await service.create_note(user, body)


# ═══════════ تفاصيل ملاحظة (بند 6) ═══════════
@router.get("/{note_id}")
async def note_details(
    note_id: str,
    user: CurrentUser = Depends(require_permission("service_notes.view")),
):
    row = await fetchrow(
        _LIST_SQL + " WHERE n.company_id=$1::uuid AND n.id=$2::uuid",
        user.company_id, note_id)
    if not row:
        raise HTTPException(404, "الملاحظة غير موجودة")
    atts = await fetch(
        "SELECT id, file_url, file_type, created_at FROM service_note_attachments"
        " WHERE note_id=$1::uuid ORDER BY created_at",
        note_id)
    msgs = await fetch(
        """SELECT id, sender_type, message, attachment_url, message_type,
                  is_read, created_at, read_at
           FROM service_messages WHERE work_order_id = (SELECT work_order_id FROM service_notes WHERE id=$1::uuid) ORDER BY created_at""",
        note_id)
    return {**dict(row),
            "attachments": [dict(a) for a in atts],
            "messages": [dict(m) for m in msgs]}


# ═══════════ تعديل ملاحظة ═══════════
@router.put("/{note_id}")
async def update_note(
    note_id: str, body: NoteUpdate,
    user: CurrentUser = Depends(require_permission("service_notes.create",
                                                   "service_notes.manage")),
):
    sets, args = ["updated_at = now()"], []
    mapping = {"description": body.description, "title": body.title,
               "priority": body.priority, "product_id": body.productId,
               "required_quantity": body.requiredQuantity}
    for col, val in mapping.items():
        if val is not None:
            args.append(val)
            cast = "::uuid" if col == "product_id" else ""
            sets.append(f"{col} = ${len(args)}{cast}")
    args += [note_id, user.company_id]
    r = await execute(
        f"UPDATE service_notes SET {', '.join(sets)}"
        f" WHERE id = ${len(args)-1}::uuid AND company_id = ${len(args)}::uuid",
        *args)
    if r.endswith("0"):
        raise HTTPException(404, "الملاحظة غير موجودة")
    return {"ok": True}


# ═══════════ تغيير الحالة — لا حذف نهائياً (بند 15) ═══════════
@router.put("/{note_id}/status")
async def update_status(
    note_id: str, body: NoteStatusUpdate,
    user: CurrentUser = Depends(require_permission("service_notes.manage",
                                                   "service_notes.create")),
):
    closing = body.status in ("closed", "handled", "rejected")
    if closing and "service_notes.manage" not in user.permissions:
        raise HTTPException(403, "إغلاق الملاحظة يتطلب صلاحية مشرف")
    r = await execute(
        """UPDATE service_notes
           SET status=$1, updated_at=now(),
               closed_at = CASE WHEN $2 THEN now() ELSE closed_at END,
               closed_by = CASE WHEN $2 THEN $3::uuid ELSE closed_by END
           WHERE id=$4::uuid AND company_id=$5::uuid""",
        body.status, closing, user.user_id, note_id, user.company_id)
    if r.endswith("0"):
        raise HTTPException(404, "الملاحظة غير موجودة")
    return {"ok": True}


# ═══════════ المرفقات (بند 7) ═══════════
@router.post("/{note_id}/attachments")
async def add_attachment(
    note_id: str,
    file: UploadFile = File(...),
    user: CurrentUser = Depends(require_permission("service_notes.create")),
):
    return await service.save_attachment(user, note_id, file)


@router.get("/attachments/file/{fname}")
async def get_attachment_file(fname: str):
    # اسم الملف uuid hex — غير قابل للتخمين؛ ونمنع أي مسار خارج المجلد
    if "/" in fname or ".." in fname:
        raise HTTPException(400, "اسم ملف غير صالح")
    path = os.path.join(service.UPLOAD_DIR, fname)
    if not os.path.isfile(path):
        raise HTTPException(404, "الملف غير موجود")
    return FileResponse(path)


# ═══════════ إبلاغ العميل (بنود 9-10) ═══════════
@router.post("/{note_id}/notify-customer")
async def notify_customer(
    note_id: str, body: NotifyCustomerBody,
    user: CurrentUser = Depends(require_permission("service_notes.create",
                                                   "service_notes.manage")),
):
    return await service.notify_customer(user, note_id, body.message)


# ═══════════ محادثة أمر العمل — جانب الموظف (بند 14) ═══════════
@router.get("/messages/{work_order_id}")
async def messages(
    work_order_id: str,
    user: CurrentUser = Depends(require_permission("service_notes.view",
                                                   "service_notes.create")),
):
    rows = await fetch(
        """SELECT id, sender_type, message, attachment_url, message_type,
                  is_read, created_at, read_at, note_id
           FROM service_messages
           WHERE company_id=$1::uuid AND work_order_id=$2::uuid
           ORDER BY created_at""",
        user.company_id, work_order_id)
    # رسائل العميل تتعلم كمقروءة لما الموظف يفتح المحادثة
    await execute(
        """UPDATE service_messages SET is_read=TRUE, read_at=now()
           WHERE company_id=$1::uuid AND work_order_id=$2::uuid
             AND sender_type='customer' AND is_read=FALSE""",
        user.company_id, work_order_id)
    return [dict(r) for r in rows]


@router.post("/messages/{work_order_id}")
async def send_message(
    work_order_id: str, body: MessageCreate,
    user: CurrentUser = Depends(require_permission("service_notes.create",
                                                   "service_notes.manage")),
):
    wo = await service.resolve_work_order(user.company_id, work_order_id)
    await execute(
        """INSERT INTO service_messages
             (company_id, branch_id, work_order_id, customer_id, employee_id,
              note_id, sender_type, message, message_type)
           VALUES ($1,$2,$3,$4,$5,$6,'employee',$7,$8)""",
        user.company_id, wo["branch_id"], wo["id"], wo["customer_id"],
        user.user_id, body.noteId, body.message, body.messageType)
    return {"ok": True}


# ═══════════ قوالب الرسائل (بند 13) ═══════════
@router.get("/templates/list")
async def list_templates(user: CurrentUser = Depends(get_current_user)):
    rows = await fetch(
        """SELECT id, title, message, category, branch_id, is_active
           FROM message_templates
           WHERE company_id=$1::uuid AND is_active=TRUE
             AND (branch_id IS NULL OR branch_id=$2::uuid)
           ORDER BY title""",
        user.company_id, user.branch_id)
    return [dict(r) for r in rows]


@router.post("/templates")
async def create_template(
    body: TemplateCreate,
    user: CurrentUser = Depends(require_permission("service_notes.manage")),
):
    row = await fetchrow(
        """INSERT INTO message_templates
             (company_id, branch_id, title, message, category, created_by)
           VALUES ($1,$2,$3,$4,$5,$6) RETURNING id""",
        user.company_id, body.branchId, body.title, body.message,
        body.category, user.user_id)
    return {"id": str(row["id"])}


@router.put("/templates/{template_id}")
async def update_template(
    template_id: str, body: TemplateUpdate,
    user: CurrentUser = Depends(require_permission("service_notes.manage")),
):
    sets, args = [], []
    mapping = {"title": body.title, "message": body.message,
               "category": body.category, "is_active": body.isActive}
    for col, val in mapping.items():
        if val is not None:
            args.append(val)
            sets.append(f"{col} = ${len(args)}")
    if not sets:
        return {"ok": True}
    args += [template_id, user.company_id]
    await execute(
        f"UPDATE message_templates SET {', '.join(sets)}"
        f" WHERE id = ${len(args)-1}::uuid AND company_id = ${len(args)}::uuid",
        *args)
    return {"ok": True}


# ═══════════════════════════════════════════════════════════════
#   مسارات العميل العامة — عبر التوكن الآمن فقط (بند 27)
#   لا user ولا JWT: التوكن العشوائي (48 hex) هو المصادقة
# ═══════════════════════════════════════════════════════════════
async def _car_by_token(token: str):
    if not token or len(token) < 20:
        raise HTTPException(403, "رابط غير صالح")
    row = await fetchrow(
        """SELECT c.id, c.company_id, c.branch_id, c.customer_id,
                  c.plate, c.brand, c.name AS car_name
           FROM cars c WHERE c.public_token = $1""",
        token)
    if not row:
        raise HTTPException(403, "رابط غير صالح أو منتهي")
    return row


@router.get("/public/{token}/messages")
async def public_messages(token: str):
    car = await _car_by_token(token)
    rows = await fetch(
        """SELECT id, sender_type, message, attachment_url, message_type, created_at
           FROM service_messages
           WHERE work_order_id=$1::uuid AND COALESCE(message_type,'') <> 'note_internal' ORDER BY created_at""",
        car["id"])
    notes = await fetch(
        """SELECT note_number, type, title, description, created_at
           FROM service_notes
           WHERE work_order_id=$1::uuid AND customer_visible=TRUE
           ORDER BY created_at DESC""",
        car["id"])
    # رسائل الموظف تتعلم كمقروءة لما العميل يفتح الصفحة
    await execute(
        """UPDATE service_messages SET is_read=TRUE, read_at=now()
           WHERE work_order_id=$1::uuid AND sender_type='employee' AND is_read=FALSE""",
        car["id"])
    return {"car": {"plate": car["plate"], "brand": car["brand"], "name": car["car_name"]},
            "messages": [dict(r) for r in rows],
            "notes": [dict(n) for n in notes],
            "typeLabels": TYPE_LABELS}


@router.post("/public/{token}/messages")
async def public_send(token: str, body: MessageCreate):
    car = await _car_by_token(token)
    if len(body.message) > 2000:
        raise HTTPException(400, "الرسالة طويلة جداً")
    await execute(
        """INSERT INTO service_messages
             (company_id, branch_id, work_order_id, customer_id,
              sender_type, message, message_type)
           VALUES ($1,$2,$3,$4,'customer',$5,$6)""",
        car["company_id"], car["branch_id"], car["id"], car["customer_id"],
        body.message, body.messageType)
    return {"ok": True}



# ═══ (مرحلة 3) تبادل التوكن للصفحة العامة — رقم الحجز → توكن آمن ═══
@router.get("/public/car-token/{car_id}")
async def public_car_token(car_id: str):
    if not car_id or len(car_id) != 36:
        raise HTTPException(403, "معرف غير صالح")
    row = await fetchrow("SELECT public_token FROM cars WHERE id = $1::uuid", car_id)
    if not row:
        raise HTTPException(404, "غير موجود")
    tok = row["public_token"]
    if not tok:
        row = await fetchrow(
            "UPDATE cars SET public_token = encode(gen_random_bytes(24), 'hex')"
            " WHERE id = $1::uuid RETURNING public_token", car_id)
        tok = row["public_token"]
    return {"token": tok}


@router.get("/public/token-info/{token}")
async def public_token_info(token: str):
    car = await _car_by_token(token)
    return {"branchId": str(car["branch_id"]), "carId": str(car["id"])}


# ═══ (مرحلة 3) تبادل التوكن للصفحة العامة — رقم الحجز → توكن آمن ═══
@router.get("/public/car-token/{car_id}")
async def public_car_token(car_id: str):
    if not car_id or len(car_id) != 36:
        raise HTTPException(403, "معرف غير صالح")
    row = await fetchrow("SELECT public_token FROM cars WHERE id = $1::uuid", car_id)
    if not row:
        raise HTTPException(404, "غير موجود")
    tok = row["public_token"]
    if not tok:
        row = await fetchrow(
            "UPDATE cars SET public_token = encode(gen_random_bytes(24), 'hex')"
            " WHERE id = $1::uuid RETURNING public_token", car_id)
        tok = row["public_token"]
    return {"token": tok}


@router.get("/public/token-info/{token}")
async def public_token_info(token: str):
    car = await _car_by_token(token)
    return {"branchId": str(car["branch_id"]), "carId": str(car["id"])}



# ═══ (مرحلة 3) الرسائل الصوتية — حفظ WAV + تشغيل مضمون على كل الأجهزة ═══
VOICE_DIR = "uploads/voice"


@router.post("/public/{token}/voice")
async def public_send_voice(token: str, file: UploadFile = File(...)):
    car = await _car_by_token(token)
    data = await file.read()
    if len(data) > 8 * 1024 * 1024:
        raise HTTPException(400, "التسجيل كبير جداً")
    os.makedirs(VOICE_DIR, exist_ok=True)
    fname = os.urandom(16).hex() + ".wav"
    with open(os.path.join(VOICE_DIR, fname), "wb") as f:
        f.write(data)
    url = f"/api/service-notes/public/media/{fname}"
    await execute(
        """INSERT INTO service_messages
             (company_id, branch_id, work_order_id, customer_id,
              sender_type, message, attachment_url, message_type)
           VALUES ($1,$2,$3,$4,'customer','🎤 رسالة صوتية',$5,'voice')""",
        car["company_id"], car["branch_id"], car["id"], car["customer_id"], url)
    return {"ok": True, "url": url}


@router.post("/messages/{work_order_id}/voice")
async def send_voice_employee(
    work_order_id: str,
    file: UploadFile = File(...),
    user: CurrentUser = Depends(require_permission("service_notes.view",
                                                   "service_notes.create")),
):
    wo = await service.resolve_work_order(user.company_id, work_order_id)
    data = await file.read()
    if len(data) > 8 * 1024 * 1024:
        raise HTTPException(400, "التسجيل كبير جداً")
    os.makedirs(VOICE_DIR, exist_ok=True)
    fname = os.urandom(16).hex() + ".wav"
    with open(os.path.join(VOICE_DIR, fname), "wb") as f:
        f.write(data)
    url = f"/api/service-notes/public/media/{fname}"
    await execute(
        """INSERT INTO service_messages
             (company_id, branch_id, work_order_id, customer_id, employee_id,
              sender_type, message, attachment_url, message_type)
           VALUES ($1,$2,$3,$4,$5,'employee','🎤 رسالة صوتية',$6,'voice')""",
        user.company_id, wo["branch_id"], wo["id"], wo["customer_id"],
        user.user_id, url)
    return {"ok": True, "url": url}


@router.get("/public/media/{fname}")
async def public_media(fname: str):
    if (not fname.endswith(".wav") or len(fname) != 36
            or not all(c in "0123456789abcdef" for c in fname[:-4])):
        raise HTTPException(403, "غير مسموح")
    path = os.path.join(VOICE_DIR, fname)
    if not os.path.isfile(path):
        raise HTTPException(404, "غير موجود")
    return FileResponse(path, media_type="audio/wav")

