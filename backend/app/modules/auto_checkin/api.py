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
# ربط بنظام المصادقة والاتصال بالداتابيز الفعلي في هذا المشروع
# ---------------------------------------------------------------------------
from ...core.deps import CurrentUser, get_current_user, require_permission
from ...core.db import fetch as _fetch, fetchrow as _fetchrow, execute as _execute, transaction as _transaction


class _ConnBridge:
    """جسر بسيط يحاكي واجهة conn.fetch/fetchrow/execute/transaction
    فوق دوال app.core.db الجاهزة — بدون تعديل منطق service.py الأصلي"""
    async def fetch(self, query, *args):
        return await _fetch(query, *args)

    async def fetchrow(self, query, *args):
        return await _fetchrow(query, *args)

    async def execute(self, query, *args):
        return await _execute(query, *args)

    def transaction(self):
        return _transaction()


async def get_connection():
    yield _ConnBridge()

log = logging.getLogger("z8.gate.api")

router = APIRouter()  # الـ prefix يُضاف عبر ModuleInfo.prefix في module.py

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


# ═══ تعبئة لمرة واحدة: plate_normalized + plate_loose لكل السيارات الموجودة ═══
@router.post("/backfill-plate-keys")
async def backfill_plate_keys(user=Depends(get_current_user)):
    from ...core.plate_utils import normalize_plate
    rows = await _fetch("SELECT id, plate FROM cars WHERE plate IS NOT NULL")
    updated, skipped = 0, 0
    for r in rows:
        key = normalize_plate(r["plate"])
        if not key.canonical:
            skipped += 1
            continue
        await _execute(
            "UPDATE cars SET plate_normalized=$1, plate_loose=$2 WHERE id=$3",
            key.canonical, key.loose, r["id"],
        )
        updated += 1
    return {"total": len(rows), "updated": updated, "skipped": skipped}


# ═══ حذف لقطات "غير مسجّلة" القديمة — تنظيف لوحة "سيارات جديدة" ═══
@router.post("/clear-unknown")
async def clear_unknown(branch_id: str = Query(...), user=Depends(get_current_user)):
    await _execute(
        "DELETE FROM plate_scans WHERE branch_id=$1 AND status='unknown'",
        branch_id,
    )
    return {"ok": True}


# ═══ 🎛 مفتاح البوابة الذكية: حالة + تشغيل/إيقاف المراقب من الواجهة ═══
from . import watcher as _watcher_mod


@router.get("/watcher-status")
async def watcher_status(user=Depends(get_current_user)):
    return {"enabled": _watcher_mod.is_enabled(), "running": _watcher_mod.is_started()}


@router.post("/watcher-toggle")
async def watcher_toggle(enabled: bool, user=Depends(get_current_user)):
    _watcher_mod.set_enabled(enabled)
    return {"enabled": _watcher_mod.is_enabled(), "running": _watcher_mod.is_started()}


# ═══ 🎛 مفاتيح الكاميرات المستقلة: حالة حية + تشغيل/إيقاف كل كاميرا ═══
@router.get("/cameras-status")
async def gate_cameras_status(user=Depends(get_current_user)):
    rows = await _fetch(
        """SELECT id, name, is_active FROM station_cameras
           WHERE company_id=$1 AND station=1 ORDER BY name""",
        user.company_id)
    stats = _watcher_mod.get_camera_stats()
    out = []
    for r in rows:
        st = stats.get(str(r["id"]), {})
        out.append({
            "id": str(r["id"]), "name": r["name"], "is_active": r["is_active"],
            "ok": st.get("ok") if st else None,
            "last": st.get("last", "") if st else "",
        })
    return {"cameras": out}


@router.post("/camera-toggle")
async def gate_camera_toggle(camera_id: str, enabled: bool,
                             user=Depends(get_current_user)):
    await _execute(
        "UPDATE station_cameras SET is_active=$2 WHERE id=$1::uuid AND company_id=$3",
        camera_id, enabled, user.company_id)
    print(f"🎛 كاميرا {camera_id[:8]}: {'تشغيل' if enabled else 'إيقاف'}", flush=True)
    return {"ok": True}


# ═══ 🧠 نموذج قراءة اللوحات: عرض المتاح + التبديل الفوري الدائم ═══
@router.get("/vision-model")
async def get_vision_model(user=Depends(get_current_user)):
    from . import vision as _v
    return {"model": _v.get_model(), "available": _v.AVAILABLE_MODELS}


@router.post("/vision-model")
async def set_vision_model(model: str, user=Depends(get_current_user)):
    from . import vision as _v
    if not _v.set_model(model):
        raise HTTPException(400, "نموذج غير مدعوم")
    return {"model": _v.get_model()}




# ═══ 📸 استيراد صور المنتجات جماعياً من مجلد على الجهاز — مرة واحدة سريعة ═══
@router.post("/import-images")
async def import_product_images(folder: str, user=Depends(get_current_user)):
    """يقرأ كل الصور من مجلد محلي، يطابق كل صورة باسم ملفها مع المنتجات،
    يضغطها تلقائياً، ويحفظها. التسمية: باركود المنتج، أو جزء من اسمه،
    أو اسم الشركة (تصبح شعاراً لكل منتجاتها التي بلا صورة)."""
    import base64
    from pathlib import Path as _P

    src = _P(folder)
    if not src.is_dir():
        raise HTTPException(400, f"المجلد غير موجود: {folder}")

    def _compress(path) -> str | None:
        try:
            import cv2
            img = cv2.imread(str(path))
            if img is None:
                return None
            h, w = img.shape[:2]
            if w > 600:
                img = cv2.resize(img, (600, int(h * 600 / w)))
            ok, buf = cv2.imencode(".jpg", img, [int(cv2.IMWRITE_JPEG_QUALITY), 80])
            if not ok:
                return None
            return "data:image/jpeg;base64," + base64.b64encode(buf.tobytes()).decode()
        except Exception:
            return None

    exts = {".jpg", ".jpeg", ".png", ".webp", ".bmp"}
    files = [f for f in sorted(src.iterdir()) if f.suffix.lower() in exts]

    matched_product = matched_brand = skipped = 0
    unmatched: list[str] = []

    for f in files:
        stem = f.stem.strip()
        b64 = _compress(f)
        if not b64:
            skipped += 1
            continue

        # 1) باركود مطابق تماماً
        row = await _fetchrow(
            "SELECT id FROM products WHERE company_id=$1 AND barcode=$2 LIMIT 1",
            user.company_id, stem)
        # 2) أو جزء من اسم المنتج
        if not row:
            row = await _fetchrow(
                "SELECT id FROM products WHERE company_id=$1 AND name ILIKE '%'||$2||'%' LIMIT 1",
                user.company_id, stem)
        if row:
            await _execute("UPDATE products SET image_base64=$2 WHERE id=$1",
                           row["id"], b64)
            matched_product += 1
            continue

        # 3) أو اسم شركة => شعار لكل منتجاتها التي بلا صورة
        res = await _execute(
            """UPDATE products SET image_base64=$3
               WHERE company_id=$1 AND oil_brand ILIKE $2
                 AND (image_base64 IS NULL OR image_base64='')""",
            user.company_id, stem, b64)
        if res and "0" not in str(res).split()[-1:]:
            matched_brand += 1
        else:
            unmatched.append(f.name)

    return {"total": len(files), "products": matched_product,
            "brands": matched_brand, "skipped": skipped,
            "unmatched": unmatched[:30]}


# ═══ 📸 استيراد الصور عبر ملف CSV — مطابقة دقيقة بالباركود ═══
@router.post("/import-images-csv")
async def import_images_csv(folder: str, user=Depends(get_current_user)):
    """يقرأ products.csv من المجلد: يستخرج الباركود من رابط المنتج،
    ويحمّل الصورة من (الملف المحلي)، يضغطها، ويربطها بالمنتج المطابق."""
    import base64
    import csv as _csv
    import re as _re2
    from pathlib import Path as _P

    src = _P(folder)
    csv_path = src / "products.csv"
    if not csv_path.exists():
        raise HTTPException(400, f"products.csv غير موجود في: {folder}")

    def _load_compress(p: _P) -> str | None:
        """قراءة آمنة للمسارات العربية على ويندوز + ضغط"""
        try:
            import cv2
            import numpy as np
            arr = np.fromfile(str(p), dtype=np.uint8)  # يدعم العربية بعكس imread
            img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
            if img is None:
                return None
            h, w = img.shape[:2]
            if w > 600:
                img = cv2.resize(img, (600, int(h * 600 / w)))
            ok, buf = cv2.imencode(".jpg", img, [int(cv2.IMWRITE_JPEG_QUALITY), 80])
            return ("data:image/jpeg;base64," +
                    base64.b64encode(buf.tobytes()).decode()) if ok else None
        except Exception:
            return None

    def _resolve(rel: str) -> _P | None:
        rel = rel.strip().replace("/", "\\\\")
        cands = [src / rel, src.parent / rel]
        parts = rel.split("\\\\")
        if len(parts) > 1:
            cands.append(src / "\\\\".join(parts[1:]))
        for c in cands:
            if c.exists():
                return c
        return None

    matched = by_name = missing_file = not_found = bad_img = 0
    unmatched: list[str] = []

    with open(csv_path, encoding="utf-8-sig") as f:
        for row in _csv.DictReader(f):
            name = (row.get("اسم المنتج") or "").strip()
            link = row.get("رابط المنتج") or ""
            rel = row.get("الملف المحلي") or ""
            m = _re2.search(r"z8\.sa/(\d+)", link)
            barcode = m.group(1) if m else ""

            fp = _resolve(rel)
            if not fp:
                missing_file += 1
                continue
            b64 = _load_compress(fp)
            if not b64:
                bad_img += 1
                continue

            prod = None
            if barcode:
                prod = await _fetchrow(
                    "SELECT id FROM products WHERE company_id=$1 AND barcode=$2 LIMIT 1",
                    user.company_id, barcode)
            if not prod and name:
                prod = await _fetchrow(
                    "SELECT id FROM products WHERE company_id=$1 AND name ILIKE '%'||$2||'%' LIMIT 1",
                    user.company_id, name[:40])
                if prod:
                    by_name += 1
            if prod:
                await _execute("UPDATE products SET image_base64=$2 WHERE id=$1",
                               prod["id"], b64)
                matched += 1
            else:
                not_found += 1
                if len(unmatched) < 30:
                    unmatched.append(f"{barcode or '؟'} — {name[:50]}")

    return {"matched": matched, "by_name_fallback": by_name,
            "not_in_db": not_found, "missing_file": missing_file,
            "bad_image": bad_img, "unmatched_sample": unmatched}


# ══ مزامنة شاملة v2: صور + شركات — مطابقة ضبابية محصنة ══
@router.post("/sync-products-v2")
async def sync_products_v2(folder: str, user=Depends(get_current_user)):
    import base64
    import csv as _csv
    import difflib as _dl
    import re as _re2
    from pathlib import Path as _P

    src = _P(folder)
    csv_path = src / "products.csv"
    if not csv_path.exists():
        raise HTTPException(400, "products.csv غير موجود")

    def _digits(s):
        return _re2.sub(r"\D", "", s or "")

    def _norm(s):
        s = (s or "").strip()
        s = _re2.sub(r"[أإآ]", "ا", s)
        s = s.replace("ة", "ه").replace("ى", "ي").replace("ـ", "")
        s = _re2.sub(r"[\s\-_/.,()×xX*]+", "", s)
        return s.lower()

    def _brand(raw):
        b = (raw or "").strip()
        for pre in ("زيت ", "زيوت "):
            if b.startswith(pre):
                b = b[len(pre):]
        return b.strip()

    def _img(p):
        try:
            import cv2
            import numpy as np
            arr = np.fromfile(str(p), dtype=np.uint8)
            im = cv2.imdecode(arr, cv2.IMREAD_COLOR)
            if im is None:
                return None
            h, w = im.shape[:2]
            if w > 600:
                im = cv2.resize(im, (600, int(h * 600 / w)))
            ok, buf = cv2.imencode(".jpg", im, [int(cv2.IMWRITE_JPEG_QUALITY), 80])
            if not ok:
                return None
            return "data:image/jpeg;base64," + base64.b64encode(buf.tobytes()).decode()
        except Exception:
            return None

    def _find(rel):
        sep = chr(92)
        rel = (rel or "").strip().replace("/", sep)
        parts = rel.split(sep)
        cands = [src / rel, src.parent / rel]
        if len(parts) > 1:
            cands.append(src / sep.join(parts[1:]))
        for c in cands:
            if c.exists():
                return c
        return None

    rows = await _fetch(
        "SELECT id, name, barcode FROM products WHERE company_id=$1",
        user.company_id)
    by_bar = {}
    by_name = []
    for r in rows:
        d = _digits(r["barcode"])
        if d:
            by_bar[d] = r
        by_name.append((_norm(r["name"]), r))

    matched = img_set = brand_set = fuzzy_used = 0
    unmatched = []

    with open(csv_path, encoding="utf-8-sig") as f:
        for row in _csv.DictReader(f):
            name = (row.get("اسم المنتج") or "").strip()
            m = _re2.search(r"z8\.sa/(\d+)", row.get("رابط المنتج") or "")
            bar = m.group(1) if m else ""
            brand = _brand(row.get("القسم الفرعي") or "")

            prod = by_bar.get(_digits(bar))
            if prod is None:
                nn = _norm(name)
                if len(nn) > 6:
                    best = None
                    best_sc = 0.0
                    for cand_name, r in by_name:
                        if nn in cand_name or cand_name in nn:
                            prod = r
                            break
                        sc = _dl.SequenceMatcher(None, nn, cand_name).ratio()
                        if sc > best_sc:
                            best_sc = sc
                            best = r
                    if prod is None and best_sc >= 0.72:
                        prod = best
                        fuzzy_used += 1
            if prod is None:
                if len(unmatched) < 40:
                    unmatched.append(name[:60])
                continue
            matched += 1

            if brand:
                await _execute("UPDATE products SET oil_brand=$2 WHERE id=$1",
                               prod["id"], brand)
                brand_set += 1
            fp = _find(row.get("الملف المحلي") or "")
            if fp:
                b64 = _img(fp)
                if b64:
                    await _execute(
                        "UPDATE products SET image_base64=$2 WHERE id=$1",
                        prod["id"], b64)
                    img_set += 1

    return {"csv_matched": matched, "images_set": img_set,
            "brands_set": brand_set, "fuzzy_matches": fuzzy_used,
            "unmatched_csv": unmatched, "db_total": len(rows)}


# ══ مزامنة شاملة v2: صور + شركات — مطابقة ضبابية محصنة ══
@router.post("/sync-products-v3")
async def sync_products_v3(folder: str, user=Depends(get_current_user)):
    import traceback as _tbmod
    try:
        return await _sync_v3_inner(folder, user)
    except Exception as e:
        # التشخيص الذاتي: الخطأ الحقيقي يظهر في الرد مباشرة
        return {"error": f"{type(e).__name__}: {e}",
                "traceback": _tbmod.format_exc()[-1500:]}


async def _sync_v3_inner(folder: str, user):
    import base64
    import csv as _csv
    import difflib as _dl
    import re as _re2
    from pathlib import Path as _P

    src = _P(folder)
    csv_path = src / "products.csv"
    if not csv_path.exists():
        raise HTTPException(400, "products.csv غير موجود")

    def _digits(s):
        return _re2.sub(r"\D", "", s or "")

    def _norm(s):
        s = (s or "").strip()
        s = _re2.sub(r"[أإآ]", "ا", s)
        s = s.replace("ة", "ه").replace("ى", "ي").replace("ـ", "")
        s = _re2.sub(r"[\s\-_/.,()×xX*]+", "", s)
        return s.lower()

    def _brand(raw):
        b = (raw or "").strip()
        for pre in ("زيت ", "زيوت "):
            if b.startswith(pre):
                b = b[len(pre):]
        return b.strip()

    def _img(p):
        try:
            import cv2
            import numpy as np
            arr = np.fromfile(str(p), dtype=np.uint8)
            im = cv2.imdecode(arr, cv2.IMREAD_COLOR)
            if im is None:
                return None
            h, w = im.shape[:2]
            if w > 600:
                im = cv2.resize(im, (600, int(h * 600 / w)))
            ok, buf = cv2.imencode(".jpg", im, [int(cv2.IMWRITE_JPEG_QUALITY), 80])
            if not ok:
                return None
            return "data:image/jpeg;base64," + base64.b64encode(buf.tobytes()).decode()
        except Exception:
            return None

    def _find(rel):
        sep = chr(92)
        rel = (rel or "").strip().replace("/", sep)
        parts = rel.split(sep)
        cands = [src / rel, src.parent / rel]
        if len(parts) > 1:
            cands.append(src / sep.join(parts[1:]))
        for c in cands:
            if c.exists():
                return c
        return None

    rows = await _fetch(
        "SELECT id, name, barcode FROM products WHERE company_id=$1",
        user.company_id)
    by_bar = {}
    by_name = []
    for r in rows:
        d = _digits(r["barcode"])
        if d:
            by_bar[d] = r
        by_name.append((_norm(r["name"]), r))

    matched = img_set = brand_set = fuzzy_used = 0
    unmatched = []

    with open(csv_path, encoding="utf-8-sig") as f:
        for row in _csv.DictReader(f):
            name = (row.get("اسم المنتج") or "").strip()
            m = _re2.search(r"z8\.sa/(\d+)", row.get("رابط المنتج") or "")
            bar = m.group(1) if m else ""
            brand = _brand(row.get("القسم الفرعي") or "")

            prod = by_bar.get(_digits(bar))
            if prod is None:
                nn = _norm(name)
                if len(nn) > 6:
                    best = None
                    best_sc = 0.0
                    for cand_name, r in by_name:
                        if nn in cand_name or cand_name in nn:
                            prod = r
                            break
                        sc = _dl.SequenceMatcher(None, nn, cand_name).ratio()
                        if sc > best_sc:
                            best_sc = sc
                            best = r
                    if prod is None and best_sc >= 0.72:
                        prod = best
                        fuzzy_used += 1
            if prod is None:
                if len(unmatched) < 40:
                    unmatched.append(name[:60])
                continue
            matched += 1

            if brand:
                await _execute("UPDATE products SET oil_brand=$2 WHERE id=$1",
                               prod["id"], brand)
                brand_set += 1
            fp = _find(row.get("الملف المحلي") or "")
            if fp:
                b64 = _img(fp)
                if b64:
                    await _execute(
                        "UPDATE products SET image_base64=$2 WHERE id=$1",
                        prod["id"], b64)
                    img_set += 1

    return {"csv_matched": matched, "images_set": img_set,
            "brands_set": brand_set, "fuzzy_matches": fuzzy_used,
            "unmatched_csv": unmatched, "db_total": len(rows)}
