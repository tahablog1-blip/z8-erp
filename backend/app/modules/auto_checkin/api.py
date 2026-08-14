"""
Z8 - البوابة الذكية | نقاط النهاية
==================================
GET  /api/auto-checkin/schema-check     فحص أسماء الجداول
POST /api/auto-checkin/scan             لقطة كاميرا -> معالجة كاملة
POST /api/auto-checkin/manual           إدخال لوحة يدوياً
POST /api/auto-checkin/confirm/{id}     تأكيد الموظف على سيارة
GET  /api/auto-checkin/recent           آخر اللقطات
WS   /api/auto-checkin/ws               بث لحظي للشاشة
"""

import os
import uuid
import logging
from pathlib import Path
from typing import Optional, Any

from fastapi import (APIRouter, Depends, UploadFile, File, Form,
                     HTTPException, WebSocket, WebSocketDisconnect, Query)

from .schemas import GateEvent, ConfirmScanRequest, ManualScanRequest, SchemaCheckResult
from . import service
from .ws_hub import hub

# ---------------------------------------------------------------------------
# اربط هنا بنظام المصادقة والاتصال بالداتابيز الموجود عندك
# لو أسماء الدوال مختلفة عدّل السطرين دول فقط
# ---------------------------------------------------------------------------
from app.core.database import get_connection          # يرجع اتصال asyncpg
from app.core.security import get_current_user        # يرجع بيانات المستخدم

log = logging.getLogger("z8.gate.api")

router = APIRouter(prefix="/api/auto-checkin", tags=["البوابة الذكية"])

SNAPSHOT_DIR = Path(os.getenv("Z8_SNAPSHOT_DIR", "./storage/gate_snapshots"))
SNAPSHOT_DIR.mkdir(parents=True, exist_ok=True)

# مفتاح بسيط للكاميرات/الخدمات اللي بتبعت بدون JWT
GATE_API_KEY = os.getenv("Z8_GATE_API_KEY", "")


def _save_snapshot(data: bytes, ext: str = "jpg") -> Optional[str]:
    try:
        name = f"{uuid.uuid4().hex}.{ext}"
        path = SNAPSHOT_DIR / name
        path.write_bytes(data)
        return str(path)
    except Exception:
        log.exception("فشل حفظ اللقطة")
        return None


@router.get("/schema-check", response_model=SchemaCheckResult)
async def check_schema(conn=Depends(get_connection), user=Depends(get_current_user)):
    """يفحص أسماء الجداول والأعمدة ويقولك الناقص بالظبط"""
    return await service.schema_check(conn)


@router.post("/scan", response_model=GateEvent)
async def scan_plate(
    image: UploadFile = File(..., description="لقطة الكاميرا"),
    branch_id: str = Form(...),
    camera_id: Optional[str] = Form(None),
    auto_checkin: bool = Form(True),
    gate_key: Optional[str] = Form(None),
    conn=Depends(get_connection),
):
    """
    نقطة الدخول الرئيسية للكاميرا.
    مؤمّنة بمفتاح Z8_GATE_API_KEY (لأن الكاميرا مش هتعمل login).
    """
    if GATE_API_KEY and gate_key != GATE_API_KEY:
        raise HTTPException(status_code=401, detail="مفتاح البوابة غير صحيح")

    data = await image.read()
    if not data:
        raise HTTPException(status_code=400, detail="الصورة فارغة")
    if len(data) > 8 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="حجم الصورة أكبر من 8 ميجا")

    ext = (image.filename or "x.jpg").rsplit(".", 1)[-1].lower()
    path = _save_snapshot(data, ext if ext in ("jpg", "jpeg", "png", "webp") else "jpg")

    return await service.process_image(
        conn, data, branch_id,
        camera_id=camera_id, filename=image.filename or "",
        image_path=path, auto_checkin=auto_checkin,
    )


@router.post("/manual", response_model=GateEvent)
async def manual_plate(
    body: ManualScanRequest,
    conn=Depends(get_connection),
    user=Depends(get_current_user),
):
    """إدخال اللوحة يدوياً من شاشة الاستقبال"""
    return await service.process_manual_plate(
        conn, body.plate, body.branch_id,
        odometer=body.odometer, auto_checkin=body.auto_checkin,
    )


@router.post("/confirm/{scan_id}", response_model=GateEvent)
async def confirm(
    scan_id: str,
    body: ConfirmScanRequest,
    branch_id: str = Query(...),
    conn=Depends(get_connection),
    user=Depends(get_current_user),
):
    """الموظف يؤكد السيارة الصحيحة عند ضعف الثقة أو تعدد المرشحين"""
    try:
        return await service.confirm_scan(
            conn, scan_id, body.car_id, branch_id,
            odometer=body.odometer, station=body.station, notes=body.notes,
        )
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.get("/recent")
async def recent(
    branch_id: str = Query(...),
    limit: int = Query(30, ge=1, le=100),
    conn=Depends(get_connection),
    user=Depends(get_current_user),
):
    """سجل آخر اللقطات (للمراجعة والتدقيق)"""
    return await service.recent_scans(conn, branch_id, limit)


@router.websocket("/ws")
async def gate_socket(websocket: WebSocket, branch_id: str = Query(...)):
    """
    الشاشة بتفتح الاتصال ده وتستقبل كل حدث دخول لحظياً.
    مثال: ws://localhost:4001/api/auto-checkin/ws?branch_id=<uuid>
    """
    await hub.connect(websocket, branch_id)
    try:
        while True:
            # نستقبل ping من العميل عشان نحافظ على الاتصال حي
            await websocket.receive_text()
    except WebSocketDisconnect:
        pass
    except Exception:
        log.exception("خطأ في اتصال الشاشة")
    finally:
        await hub.disconnect(websocket, branch_id)
