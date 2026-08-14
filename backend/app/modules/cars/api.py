# modules/cars/api.py — طبقة الـ HTTP: مسارات + صلاحيات فقط
# نفس عقد النظام القديم: GET / مفتوح عن قصد — الكاشير محتاجها لربط الفاتورة
# بالسيارة حتى لو مالوش صلاحيات إدارة الدور.
from fastapi import HTTPException, APIRouter, Depends, Query

from ...core.deps import CurrentUser, get_current_user, require_permission
from . import service
from .schemas import BillingQueueRow, CarCreate, CarEdit, CarOut, ChecklistIn, LookupOut

router = APIRouter()


@router.get("", response_model=list[CarOut])
async def list_cars(activeOnly: bool = Query(default=False),
                    branchId: str | None = Query(default=None),
                    limit: int = Query(default=100, ge=1, le=500),
                    offset: int = Query(default=0, ge=0),
                    user: CurrentUser = Depends(get_current_user)):
    rows = await service.list_cars(user.company_id, user.branch_scope, branchId, activeOnly, limit, offset)
    return rows


@router.get("/lookup", response_model=LookupOut | None)
async def lookup(plate: str | None = Query(default=None), phone: str | None = Query(default=None),
                 user: CurrentUser = Depends(require_permission("cars.create"))):
    """بحث ذكي عن عميل/سيارة سابقة برقم اللوحة أو الجوال — لتعبئة تلقائية"""
    return await service.lookup(user.company_id, plate, phone)


@router.get("/billing-queue", response_model=list[BillingQueueRow])
async def billing_queue(includeInvoiced: bool = Query(default=False),
                        branchId: str | None = Query(default=None),
                        user: CurrentUser = Depends(
                            require_permission("invoices.view_pending", "invoices.create", "invoices.create_service", "invoices.prepare"))):
    """السيارات الجاهزة للفوترة (work_status='ready') — شاشة الكاشير الأساسية.
       أوامر العمل اللي لسه بتتجهز مخفية هنا تلقائياً — والأندرويد بيورث نفس السلوك."""
    return await service.billing_queue(user.company_id, user.branch_scope, branchId, includeInvoiced)


@router.get("/preparation-queue", response_model=list[BillingQueueRow])
async def preparation_queue(branchId: str | None = Query(default=None),
                            user: CurrentUser = Depends(
                                require_permission("invoices.prepare"))):
    """سيارات محتاجة إعداد أمر عمل (queued + preparing) — شاشة موظف الإعداد"""
    # ── شفاء ذاتي: سيارات دخلت فعلاً (entered_at) وحالة أمر العمل متجمدة queued
    #    من عهد كود أقدم — الحقيقة الفيزيائية هي الدخول، فالحالة بتتصحح تلقائياً ──
    from ...core.db import execute as _exec
    try:
        await _exec(
            """UPDATE cars SET work_status='preparing'
               WHERE company_id=$1 AND work_status='queued'
                 AND entered_at IS NOT NULL AND exited_at IS NULL
                 AND COALESCE(is_deleted, FALSE)=FALSE""",
            user.company_id)
    except Exception:
        pass
    return await service.billing_queue(user.company_id, user.branch_scope, branchId,
                                       include_invoiced=False, stage="prepare")


@router.post("", response_model=CarOut, status_code=201)
async def create_car(body: CarCreate, user: CurrentUser = Depends(require_permission("cars.create"))):
    d = body.model_dump()
    # ── فرض النطاق: الموظف المربوط بفرع يسجّل في فرعه هو — مهما كان اللي اتبعت.
    #    ده بيمنع أخطر بق صامت: سيارة تتسجل في فرع تاني وتختفي من قائمته فوراً ──
    if user.branch_scope:
        d["branchId"] = user.branch_scope
    if not d.get("branchId"):
        raise HTTPException(422, "اختر الفرع أولاً — التسجيل لازم يتربط بفرع")
    try:
        result = await service.create_car(user.company_id, user.user_id, user.email, d)
        return result
    except HTTPException:
        raise
    except Exception as e:
        # تشخيص ذاتي: بدل 500 غامضة — السبب الفعلي بالعربي في الواجهة ونافذة الباك اند
        import traceback; traceback.print_exc()
        name = type(e).__name__
        if "UndefinedColumn" in name or "UndefinedTable" in name:
            raise HTTPException(500,
                f"قاعدة البيانات ناقصة ({e}) — أعد تشغيل الباك اند ليُرقّي المخطط تلقائياً، "
                f"ولو استمر الخطأ ابعت السطر ده")
        raise HTTPException(500, f"فشل تسجيل السيارة: {name}: {e}")


@router.post("/{car_id}/confirm-entry", response_model=CarOut)
async def confirm_entry(car_id: str,
                        user: CurrentUser = Depends(require_permission(
                            "cars.confirm_entry", "invoices.prepare"))):
    # invoices.prepare مضافة عمداً — تابلت اعتماد أوامر العمل بيأكد الدخول من خانة "في الانتظار"
    return await service.confirm_entry(user.company_id, car_id)


@router.post("/{car_id}/exit", response_model=CarOut)
async def confirm_exit(car_id: str, user: CurrentUser = Depends(require_permission("cars.confirm_exit"))):
    return await service.confirm_exit(user.company_id, car_id)


# ⚠ ترتيب مهم: PUT /{car_id} لازم يفضل بعد كل المسارات الثابتة فوق (lookup، billing-queue)
@router.put("/{car_id}", response_model=CarOut)
async def update_car(car_id: str, body: CarEdit,
                     user: CurrentUser = Depends(
                         require_permission("cars.edit", "invoices.edit_items", "invoices.prepare"))):
    return await service.update_car(
        user.company_id, user.user_id, user.email, car_id, body.model_dump(exclude_unset=True)
    )


@router.delete("/{car_id}", status_code=204)
async def delete_car(car_id: str, user: CurrentUser = Depends(require_permission("cars.delete"))):
    await service.delete_car(user.company_id, user.user_id, user.email, car_id)

# ══════════════════ نقاط التشييك أثناء الخدمة ══════════════════

@router.get("/{car_id}/checklist")
async def get_checklist(car_id: str,
                        user: CurrentUser = Depends(require_permission(
                            "cars.create", "cars.confirm_entry", "cars.confirm_exit", "cars.edit"))):
    return await service.get_checklist(user.company_id, car_id)


@router.put("/{car_id}/checklist")
async def set_checklist(car_id: str, body: ChecklistIn,
                        user: CurrentUser = Depends(require_permission(
                            "cars.create", "cars.confirm_entry", "cars.confirm_exit", "cars.edit"))):
    return await service.set_checklist(user.company_id, car_id, [i.model_dump() for i in body.items])


# ══════════════════ قراءة اللوحة السعودية بالرؤية (Claude Vision) ══════════════════
# اتصال مباشر بـ API عبر urllib المدمجة — صفر مكتبات خارجية، صفر تعارضات
# اللوحة السعودية: الصف السفلي فيه الأرقام الغربية + الحروف اللاتينية — ده المطلوب فقط

from pydantic import BaseModel as _BM
from pydantic import Field

# الحروف اللاتينية المسموحة رسمياً على اللوحات السعودية (17 حرف)
SAUDI_PLATE_LETTERS = set("ABDEGHJKLNRSTUVXZ")

_OCR_PROMPT = (
    "Saudi car plate. Read ONLY the bottom row: Western digits (left) and Latin CAPITAL letters (right). "
    "IGNORE Arabic completely. Letters: EXACTLY 3 capitals, only from A B D E G H J K L N R S T U V X Z. "
    "Digits: 1-4. If you cannot see exactly 3 Latin letters clearly, return empty letters. "
    'ONLY JSON: {"numbers":"1234","letters":"ABC","confidence":0.95}'
)


class PlateOcrIn(_BM):
    imageBase64: str          # JPEG/PNG base64 بدون البادئة data:
    mediaType: str = "image/jpeg"


def _validate_plate(letters: str, numbers: str) -> tuple[str, str]:
    letters = "".join(ch for ch in letters.upper() if ch in SAUDI_PLATE_LETTERS)[:3]
    numbers = "".join(ch for ch in numbers if ch.isdigit())[:4]
    return letters, numbers


def _vision_call(api_key: str, image_b64: str, media_type: str) -> dict:
    """نداء مباشر لـ api.anthropic.com بأدوات بايثون المدمجة — بيتنفذ في Thread"""
    import json as _json
    import urllib.request as _rq
    import urllib.error as _er

    payload = _json.dumps({
        "model": "claude-haiku-4-5-20251001",
        "max_tokens": 80,
        "messages": [{
            "role": "user",
            "content": [
                {"type": "image",
                 "source": {"type": "base64", "media_type": media_type, "data": image_b64}},
                {"type": "text", "text": _OCR_PROMPT},
            ],
        }],
    }).encode()

    req = _rq.Request(
        "https://api.anthropic.com/v1/messages",
        data=payload, method="POST",
        headers={
            "Content-Type": "application/json",
            "x-api-key": api_key,
            "anthropic-version": "2023-06-01",
        },
    )
    try:
        with _rq.urlopen(req, timeout=30) as resp:
            data = _json.loads(resp.read().decode())
    except _er.HTTPError as e:
        try:
            err = _json.loads(e.read().decode())
            detail = err.get("error", {}).get("message", str(e))
        except Exception:
            detail = str(e)
        if e.code == 401:
            raise RuntimeError("المفتاح مرفوض (401) — راجع ANTHROPIC_API_KEY في backend/.env")
        raise RuntimeError(f"خدمة الرؤية ردّت بخطأ {e.code}: {detail}")
    except _er.URLError as e:
        raise RuntimeError(f"تعذّر الوصول لخدمة الرؤية — راجع الإنترنت ({e.reason})")

    text = "".join(b.get("text", "") for b in data.get("content", []) if b.get("type") == "text")
    text = text.replace("```json", "").replace("```", "").strip()
    return _json.loads(text)


@router.get("/plate-ocr/status")
async def plate_ocr_status(user: CurrentUser = Depends(get_current_user)):
    """تشخيص القراءة الذكية: هل المفتاح موجود ومقبول الشكل؟"""
    from ...core.config import settings as cfg
    key = (cfg.ANTHROPIC_API_KEY or "").strip()
    return {
        "keyPresent": bool(key),
        "keyLooksValid": key.startswith("sk-ant-"),
        "keyPreview": (key[:12] + "...") if key else None,
    }


@router.post("/plate-ocr")
async def plate_ocr(body: PlateOcrIn,
                    user: CurrentUser = Depends(require_permission("cars.create", "cars.edit"))):
    from ...core.config import settings as cfg
    key = (cfg.ANTHROPIC_API_KEY or "").strip()
    if not key:
        raise HTTPException(503, "القراءة الذكية غير مفعّلة — أضف ANTHROPIC_API_KEY في backend/.env وأعد التشغيل")

    import asyncio as _aio
    try:
        result = await _aio.to_thread(_vision_call, key, body.imageBase64, body.mediaType)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(502, f"فشل تحليل الصورة: {e}")

    letters, numbers = _validate_plate(str(result.get("letters", "")), str(result.get("numbers", "")))
    if not letters and not numbers:
        raise HTTPException(422, "لم أتمكن من قراءة اللوحة من الصورة — صوّر أوضح أو اكتبها يدوياً")
    return {"letters": letters, "numbers": numbers,
            "confidence": float(result.get("confidence", 0) or 0)}


# ══════════════════ بوابة الدخول الذكية ══════════════════

class GateScanIn(_BM):
    imageBase64: str | None = None       # لقطة اللوحة (الرؤية الذكية)
    mediaType: str = "image/jpeg"
    letters: str | None = None           # بديل: نتيجة القارئ المحلي من الواجهة
    numbers: str | None = None
    branchId: str | None = None          # الفرع الحالي — لازم لإنشاء دخول تلقائي لعميل واصل من غير حجز


@router.post("/gate-scan")
async def gate_scan(body: GateScanIn,
                    user: CurrentUser = Depends(require_permission(
                        "cars.confirm_entry", "cars.create"))):
    letters, numbers = body.letters or "", body.numbers or ""

    if body.imageBase64:
        from ...core.config import settings as cfg
        key = (cfg.ANTHROPIC_API_KEY or "").strip()
        if not key:
            raise HTTPException(503, "القراءة الذكية غير مفعّلة — أضف ANTHROPIC_API_KEY في backend/.env")
        import asyncio as _aio
        try:
            result = await _aio.to_thread(_vision_call, key, body.imageBase64, body.mediaType)
        except HTTPException:
            raise
        except Exception as e:
            raise HTTPException(502, f"فشل تحليل الصورة: {e}")
        letters, numbers = _validate_plate(
            str(result.get("letters", "")), str(result.get("numbers", "")))
    else:
        letters, numbers = _validate_plate(letters, numbers)

    try:
        # ── نفس فرض النطاق: الموظف المربوط بفرع تتطابق سياراته على فرعه هو ──
        return await service.gate_scan(user.company_id, letters, numbers,
                                       user.branch_scope or body.branchId)
    except HTTPException:
        raise
    except Exception as e:
        # تشخيص كامل: النوع والرسالة للواجهة + التتبع الكامل في نافذة الباك اند
        import traceback
        traceback.print_exc()
        raise HTTPException(500, f"gate-scan: {type(e).__name__}: {e}")


class DraftItemLine(_BM):
    productId: str
    qty: int = Field(default=1, ge=1)


class DraftItemsIn(_BM):
    items: list[DraftItemLine]
    flow: str = "engine"      # engine = زيت ماكينة (خدمة تلقائية) | gear = زيت قير (فحص ثابت 25)


class PrepareItemLine(_BM):
    productId: str
    qty: int = Field(default=1, ge=1)
    priceVat: float | None = None     # سعر يدوي اختياري شامل الضريبة (خدمات بسعر متغير)


class PrepareConfirmIn(_BM):
    items: list[PrepareItemLine]
    odometer: int | None = None
    notes: str | None = None
    # الفنيون: التعبئة متغيرة مع كل سيارة، الفك والتركيب (اثنان) والتشييك شبه ثابتين
    fillerId: str | None = None
    fitter1Id: str | None = None
    fitter2Id: str | None = None
    checkerId: str | None = None
    # رمز اعتماد الموظف (اختياري) — لو أُرسل يتحقق منه السيرفر ويسجل صاحبه كمعتمِد
    approvalPin: str | None = None


class BundleItemLine(_BM):
    productId: str
    qty: int = Field(default=1, ge=1)


class BundleCreateIn(_BM):
    name: str = Field(min_length=2, max_length=120)
    items: list[BundleItemLine] = Field(min_length=1)


@router.get("/technicians")
async def technicians(user: CurrentUser = Depends(require_permission("invoices.prepare"))):
    """الفنيون النشطون مصنفين بالدور — قوائم اختيار أمر العمل (المسار قبل /{car_id} عمداً)"""
    from ...core.db import fetch as _fetch
    rows = await _fetch(
        """SELECT id, full_name, tech_role, branch_id FROM hr_employees
           WHERE company_id=$1 AND tech_role IS NOT NULL
             AND COALESCE(is_active, TRUE)=TRUE
             AND ($2::uuid IS NULL OR branch_id=$2 OR branch_id IS NULL)
           ORDER BY full_name""",
        user.company_id, user.branch_scope)
    out = {"filling": [], "fitting": [], "checking": []}
    for r in rows:
        role = r["tech_role"]
        if role in out:
            out[role].append({"id": str(r["id"]), "name": r["full_name"]})
    return out


@router.get("/tech-report")
async def tech_report(date_from: str = Query(alias="from"), date_to: str = Query(alias="to"),
                      branchId: str | None = Query(default=None),
                      user: CurrentUser = Depends(require_permission("reports.sales"))):
    """تقرير إنتاجية الفنيين — عدد السيارات لكل فني بالدور (مسار ثابت قبل /{car_id} عمداً)"""
    return await service.tech_report(user.company_id, user.branch_scope, branchId,
                                     date_from, date_to)


@router.get("/{car_id}/team")
async def car_team(car_id: str,
                   user: CurrentUser = Depends(require_permission(
                       "cars.confirm_entry", "cars.create", "invoices.prepare", "reports.sales"))):
    """فريق العمل الكامل لسيارة — مراجعة من اشتغل عليها فيما بعد"""
    return await service.car_team(user.company_id, car_id)


@router.get("/bundles")
async def list_bundles(user: CurrentUser = Depends(require_permission("invoices.prepare"))):
    """الباقات الجاهزة — تُحفَظ من أي تابلت وتظهر على كل أجهزة الشركة (مسار ثابت قبل /{car_id})"""
    return await service.list_bundles(user.company_id)


@router.post("/bundles", status_code=201)
async def create_bundle(body: BundleCreateIn,
                        user: CurrentUser = Depends(require_permission("invoices.prepare"))):
    return await service.create_bundle(user.company_id, body.name,
                                       [it.model_dump() for it in body.items])


@router.delete("/bundles/{bundle_id}", status_code=200)
async def delete_bundle(bundle_id: str,
                        user: CurrentUser = Depends(require_permission("invoices.prepare"))):
    return await service.delete_bundle(user.company_id, bundle_id)


@router.post("/{car_id}/cancel-order")
async def cancel_work_order(car_id: str,
                            user: CurrentUser = Depends(require_permission(
                                "invoices.prepare", "cars.confirm_exit", "cars.edit"))):
    """إلغاء رسمي لأمر عمل معتمد غير مفوتر — المسار الوحيد لفك حالة 'ready' بلا فاتورة"""
    return await service.cancel_order(user.company_id, car_id)


@router.post("/{car_id}/prepare-confirm")
async def prepare_confirm_order(car_id: str, body: PrepareConfirmIn,
                                user: CurrentUser = Depends(require_permission("invoices.prepare"))):
    """موظف الإعداد أكّد البيانات وجهّز الأصناف — أمر العمل يظهر عند الكاشير"""
    result = await service.prepare_confirm(
        user.company_id, user.email, car_id,
        [it.model_dump() for it in body.items], body.odometer, body.notes,
        body.fillerId, body.fitter1Id, body.fitter2Id, body.checkerId,
        body.approvalPin)
    # 📲 إشعار العميل: سيارتك جاهزة (فشل الواتساب لا يعطل الاعتماد)
    try:
        from ...core import wa
        from ...core.db import fetchrow as _fr2
        row = await _fr2(
            """SELECT c.plate, cu.phone FROM cars c
               LEFT JOIN customers cu ON cu.id = c.customer_id
               WHERE c.id=$1::uuid""", car_id)
        if row and row["phone"]:
            import asyncio as _aio
            _aio.create_task(wa.send_text(user.company_id, row["phone"],
                f"🚗 عميلنا العزيز، سيارتك ({row['plate']}) أصبحت جاهزة للاستلام.\nمصدر الزيوت — شكراً لثقتكم."))
    except Exception as _e:
        print(f"⚠ إشعار الجاهزية: {_e}")
    return result


@router.post("/{car_id}/force-prepare")
async def force_prepare(car_id: str,
                        user: CurrentUser = Depends(require_permission(
                            "cars.confirm_entry", "cars.create", "invoices.create"))):
    """جهّز الآن — تجهيز يدوي فوري بنفس أصناف آخر فاتورة لعميل السيارة"""
    return await service.force_prepare_last_invoice(user.company_id, car_id)


@router.post("/{car_id}/draft-items")
async def set_draft_items(car_id: str, body: DraftItemsIn,
                          user: CurrentUser = Depends(require_permission(
                              "cars.confirm_entry", "cars.create"))):
    """حفظ اختيار العميل من بوابة اختيار الزيت الذاتية"""
    return await service.set_draft_items(
        user.company_id, car_id, [it.model_dump() for it in body.items], body.flow)


@router.get("/alerts")
async def list_alerts(user: CurrentUser = Depends(require_permission("cars.confirm_entry", "cars.create"))):
    """تنبيهات المشرف الآلي غير المقروءة"""
    return await service.list_alerts(user.company_id)


@router.post("/alerts/{alert_id}/seen")
async def mark_alert_seen(alert_id: str, isFalse: bool = Query(default=False),
                          user: CurrentUser = Depends(require_permission("cars.confirm_entry", "cars.create"))):
    """تم التعامل — أو بلاغ خاطئ (isFalse=true) لضبط دقة النظام"""
    return await service.mark_alert_seen(user.company_id, alert_id, isFalse)


class WorkLogIn(_BM):
    employeeId: str | None = None
    employeeName: str


@router.get("/line-workers")
async def line_workers(user: CurrentUser = Depends(require_permission("cars.confirm_entry", "cars.create"))):
    return await service.line_workers(user.company_id)


@router.get("/{car_id}/work-log")
async def get_work_log(car_id: str,
                       user: CurrentUser = Depends(require_permission("cars.confirm_entry", "cars.create"))):
    return await service.get_work_log(user.company_id, car_id)


@router.post("/{car_id}/work-log")
async def log_work(car_id: str, body: WorkLogIn,
                   user: CurrentUser = Depends(require_permission("cars.confirm_entry", "cars.create"))):
    """تسجيل الفني اللي اشتغل على السيارة — ضغطة اسم أو مسح بطاقته"""
    return await service.log_work(user.company_id, car_id, body.employeeId, body.employeeName)


# ══════════════════ الحجز الذاتي بالباركود — مسارات عامة بدون تسجيل دخول ══════════════════

class PublicBookIn(_BM):
    customerName: str
    customerPhone: str
    plateLetters: str | None = None
    plateNumbers: str
    brand: str | None = None
    carName: str | None = None


@router.get("/public/branch/{branch_id}")
async def public_branch(branch_id: str):
    return await service.public_branch_info(branch_id)


@router.post("/public/book/{branch_id}")
async def public_book(branch_id: str, body: PublicBookIn):
    return await service.public_book(branch_id, body.model_dump())


@router.get("/public/status/{car_id}")
async def public_status(car_id: str):
    return await service.public_status(car_id)


# ══════════════════ ترشيح الزيت المناسب لسيارة العميل ══════════════════

def _text_call(api_key: str, prompt: str) -> str:
    """نداء نصي خفيف لكلود (نفس نمط الرؤية بدون صورة)"""
    import json as _json
    import urllib.request as _rq
    payload = _json.dumps({
        "model": "claude-haiku-4-5-20251001",
        "max_tokens": 150,
        "messages": [{"role": "user", "content": prompt}],
    }).encode()
    req = _rq.Request(
        "https://api.anthropic.com/v1/messages",
        data=payload,
        headers={"Content-Type": "application/json",
                 "x-api-key": api_key, "anthropic-version": "2023-06-01"})
    with _rq.urlopen(req, timeout=25) as resp:
        data = _json.loads(resp.read().decode())
    return "".join(b.get("text", "") for b in data.get("content", []) if b.get("type") == "text")


@router.post("/{car_id}/recommend-oil")
async def recommend_oil(car_id: str,
                        user: CurrentUser = Depends(require_permission(
                            "cars.confirm_entry", "cars.create"))):
    """ترشيح ذكي حسب نوع السيارة — مع احتياطي محلي لو الذكاء غير متاح"""
    from ...core.db import fetch as _fetch
    from ...core.db import fetchrow as _fetchrow

    car = await _fetchrow(
        "SELECT brand, name, model_year FROM cars WHERE id=$1 AND company_id=$2",
        car_id, user.company_id)
    if not car:
        raise HTTPException(404, "السيارة غير موجودة")

    oils = await _fetch(
        """SELECT id, name, spec, oil_brand FROM products
           WHERE company_id=$1 AND is_active=TRUE AND is_oil=TRUE
           ORDER BY oil_brand NULLS LAST, name LIMIT 60""", user.company_id)
    if not oils:
        raise HTTPException(400, "لا توجد أصناف زيت معرّفة")

    car_desc = " ".join(str(x) for x in [car["brand"], car["name"], car["model_year"]] if x) or "سيارة"

    # ── المحاولة الذكية ──
    from ...core.config import settings as cfg
    key = (cfg.ANTHROPIC_API_KEY or "").strip()
    if key:
        listing = "\n".join(f"{i}. {o['name']} {o['spec'] or ''} ({o['oil_brand'] or ''})"
                              for i, o in enumerate(oils))
        prompt = (
            f"Car: {car_desc}\nAvailable engine oils:\n{listing}\n"
            "Pick the single most suitable oil for this car (viscosity/spec match). "
            'Reply ONLY JSON: {"index": <number>, "reason": "<سبب مختصر جداً بالعربية 8 كلمات كحد أقصى>"}'
        )
        try:
            import asyncio as _aio
            import json as _json
            import re as _re
            text = await _aio.to_thread(_text_call, key, prompt)
            m = _re.search(r"\{[\s\S]*\}", text)
            parsed = _json.loads(m.group(0)) if m else {}
            idx = int(parsed.get("index", -1))
            if 0 <= idx < len(oils):
                return {"productId": str(oils[idx]["id"]),
                        "reason": str(parsed.get("reason", ""))[:120] or "الأنسب لمواصفات سيارتك",
                        "source": "ai"}
        except Exception:
            pass  # نكمل بالاحتياطي المحلي

    # ── الاحتياطي المحلي: مطابقة اسم الماركة ثم لزوجة شائعة ──
    brand_low = (car["brand"] or "").strip().lower()
    if brand_low:
        for o in oils:
            if brand_low and brand_low in f"{o['name']} {o['spec'] or ''}".lower():
                return {"productId": str(o["id"]),
                        "reason": f"مخصص لسيارات {car['brand']}", "source": "basic"}
    for visc in ("5w-30", "5w30", "5w-20", "10w-30", "5w-40"):
        for o in oils:
            if visc in f"{o['name']} {o['spec'] or ''}".lower():
                return {"productId": str(o["id"]),
                        "reason": "لزوجة مناسبة لأغلب السيارات الحديثة", "source": "basic"}
    return {"productId": str(oils[0]["id"]), "reason": "الخيار الأكثر شيوعاً لدينا", "source": "basic"}


@router.get("/{car_id}/service-fee")
async def service_fee(car_id: str,
                      user: CurrentUser = Depends(require_permission("cars.confirm_entry", "cars.create"))):
    """رسوم خدمة التغيير المحسوبة لسيارة معينة (حسب قواعد التسعير)"""
    fee = await service.resolve_service_fee(user.company_id, car_id)
    return fee or {"productId": None}


# ══════════════════ حجز الدور العام (QR — بدون مصادقة) ══════════════════
# العميل بيفتحها من موبايله بمسح باركود الفرع — مفيش أي بيانات حساسة بتتعرض

class PublicCarIn(_BM):
    plateLetters: str = ""
    plateNumbers: str = ""
    brand: str | None = None
    carName: str | None = None
    modelYear: str | None = None
    carCategory: str | None = None
    cylinders: str | None = None
    color: str | None = None
    chassisNumber: str | None = None
    odometer: str | int | None = None


class PublicCompanyIn(_BM):
    vat: str | None = None
    cr: str | None = None
    buildingNo: str | None = None
    street: str | None = None
    district: str | None = None
    city: str | None = None
    postalCode: str | None = None
    additionalNo: str | None = None


class PublicBookingIn(_BM):
    serviceType: str = "basic"          # basic | warranty | company
    name: str = ""
    phone: str = ""
    car: PublicCarIn | None = None
    company: PublicCompanyIn | None = None
    savedCarId: str | None = None       # حجز فوري من الكراج
    odometer: str | int | None = None   # الممشى مع السيارة المحفوظة


class PublicLookupIn(_BM):
    phone: str = ""
    plate: str | None = None


@router.get("/public/booking/{branch_id}")
async def public_booking_info(branch_id: str):
    return await service.public_booking_info(branch_id)


@router.post("/public/booking/{branch_id}", status_code=201)
async def public_create_booking(branch_id: str, body: PublicBookingIn):
    return await service.public_create_booking(branch_id, body.model_dump())


@router.post("/public/booking/{branch_id}/lookup")
async def public_lookup(branch_id: str, body: PublicLookupIn):
    """استرجاع ملف العميل وسياراته المحفوظة برقم الجوال"""
    return await service.public_lookup(branch_id, body.phone, body.plate)


@router.get("/public/booking-status/{car_id}")
async def public_booking_status(car_id: str):
    return await service.public_booking_status(car_id)
