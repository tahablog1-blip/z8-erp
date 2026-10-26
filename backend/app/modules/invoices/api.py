# modules/invoices/api.py — طبقة الـ HTTP: مسارات + صلاحيات فقط
from fastapi import APIRouter, Depends, HTTPException, Query

from ...core.deps import CurrentUser, get_current_user, require_permission
from ..customers import service as customers_service
from . import service
from .schemas import InvoiceCreate, InvoiceDetailOut, InvoiceOut, PartialReturnIn, PartialReturnOut

router = APIRouter()

_VIEW_PERMS = ("invoices.view_today", "invoices.view_all", "invoices.view_pending",
              "invoices.create", "invoices.prepare")


@router.post("", response_model=InvoiceOut, status_code=201)
async def create_invoice(body: InvoiceCreate,
                         user: CurrentUser = Depends(require_permission(
                             "invoices.create", "invoices.create_service", "invoices.create_direct"))):
    # ── فصل الكاشيرين: كل نوع فاتورة له صلاحيته — والشاملة القديمة تغطي النوعين ──
    is_service = body.source == "car" or bool(body.carId)
    needed = "invoices.create_service" if is_service else "invoices.create_direct"
    if not user.has("invoices.create", needed):
        raise HTTPException(403,
            "هذه الشاشة لكاشير " + ("الخدمة" if is_service else "البيع المباشر") + " — لا تملك صلاحيتها")

    # ── فرض حد الخصم حسب الدور: القرار الأمني هنا لا في الواجهة، مهما أرسل العميل ──
    gross = sum(it.unitPriceVat * it.qty for it in body.items)
    total_discount = body.discountAmount + sum(it.discountAmount for it in body.items)
    max_pct = (100.0 if user.has("invoices.discount_manager")
               else 20.0 if user.has("invoices.discount_supervisor")
               else 5.0 if user.has("invoices.discount_cashier") else 0.0)
    if total_discount > 0:
        pct = (total_discount / gross * 100) if gross > 0 else 0
        if pct > max_pct + 0.01:
            raise HTTPException(403,
                f"الخصم المطلوب {pct:.1f}% يتجاوز حدك المسموح ({max_pct:.0f}%) — راجع مشرفك")

    # ── حد ائتمان العميل: نفس فلسفة حد الخصم — القرار هنا، مهما أرسلت الواجهة ──
    credit_amount = sum(p.amount for p in body.payments if p.method == "credit")
    if credit_amount > 0 and body.customerId:
        status = await customers_service.get_credit_status(user.company_id, body.customerId)
        if status and status["creditLimit"] is not None:
            projected = status["balance"] + credit_amount
            if projected > status["creditLimit"] + 0.01 and not user.has("invoices.credit_override"):
                raise HTTPException(403,
                    f"تجاوز حد ائتمان العميل ({status['creditLimit']:.2f} ر.س) — "
                    f"الرصيد الحالي {status['balance']:.2f} + هذه الفاتورة {credit_amount:.2f} ر.س. "
                    "راجع مشرفك لتجاوز الحد.")

    inv = await service.create_invoice(user.company_id, user.user_id, user.email, body.model_dump())

    # 🎁 نقاط الولاء: اكتساب تلقائي حسب إجمالي الفاتورة — صفر تأثير لو معدّل
    # الاكتساب غير مفعّل من الإعدادات (0 الافتراضي)، وما بيعطّلش إصدار الفاتورة لو فشل
    if inv.get("customer_id"):
        try:
            await customers_service.accrue_points(user.company_id, inv["customer_id"], inv["total_inc"])
        except Exception as _e:
            print(f"⚠ نقاط الولاء: {_e}")

    # 📝 سجل تدقيق: أي فاتورة فيها خصم أو بيع آجل تُسجَّل — عملية fire-and-forget
    if total_discount > 0 or any(p.method == "credit" for p in body.payments):
        from ...core import audit
        import asyncio as _aio2
        _aio2.create_task(audit.log(
            user.company_id, user.user_id, user.email,
            action="discount" if total_discount > 0 else "credit_sale",
            entity="invoice", entity_id=inv.get("id"),
            new_value=f"discount={total_discount:.2f} credit={sum(p.amount for p in body.payments if p.method=='credit'):.2f}",
            reason=body.discountReason, branch_id=body.branchId))
    # 📲 بعد إتمام الدفع: إرسال الفاتورة PDF للعميل واتساب (تلقائي — لا يعطل الإصدار)
    try:
        is_credit = any(p.method == "credit" for p in (body.payments or []))   # PaymentIn كائن Pydantic — مش dict
        if inv.get("customer_id") and not is_credit:
            import asyncio as _aio
            _aio.create_task(_send_invoice_wa(user.company_id, inv["id"]))
        elif not inv.get("customer_id"):
            # بدون عميل مربوط ما فيش رقم نبعتله — نسجّل السبب بدل ما يتخطّى بصمت
            from ...core.integration_log import log_event as _log
            await _log(user.company_id, "whatsapp", "send_invoice", "skipped",
                       detail=f"فاتورة {inv.get('invoice_no')}: غير مربوطة بعميل — اختر العميل قبل إصدار الفاتورة ليصله PDF")
    except Exception as _e:
        print(f"⚠ جدولة واتساب الفاتورة: {_e}")
    return inv


async def _send_invoice_wa(company_id: str, invoice_id: str):
    """يبني PDF ويرسله؛ لو محرك PDF غير مثبت يرسل ملخصاً نصياً"""
    from ...core import wa
    from ...core.db import fetchrow as _fr
    row = await _fr(
        """SELECT i.invoice_no, i.total_inc, i.customer_name, cu.phone
           FROM invoices i LEFT JOIN customers cu ON cu.id = i.customer_id
           WHERE i.id=$1::uuid""", invoice_id)
    if not row or not row["phone"]:
        from ...core.integration_log import log_event as _log
        await _log(company_id, "whatsapp", "send_invoice", "skipped",
                   detail=f"فاتورة {row['invoice_no'] if row else invoice_id}: العميل ليس له رقم جوال")
        return
    caption = (f"فاتورتكم من شركة مصدر الزيوت\nرقم الفاتورة: {row['invoice_no']}"
               f"\nالإجمالي: {float(row['total_inc']):.2f} ر.س شاملاً ضريبة القيمة المضافة\nنشكركم على تعاملكم معنا.")
    import base64
    from ...core.integration_log import log_event as _log
    try:
        pdf_bytes = await _invoice_pdf_bytes(company_id, invoice_id)
    except Exception as e:
        # ما قدرناش نبني الـ PDF: نبعت الملخص النصي بدل ما العميل يفضل من غير حاجة، ونسجّل السبب
        print(f"⚠ PDF واتساب: {type(e).__name__}: {e}")
        await _log(company_id, "whatsapp", "send_invoice", "failed",
                   detail=f"فاتورة {row['invoice_no']}: تعذّر إنشاء PDF ({type(e).__name__}: {str(e)[:150]}) — أُرسل ملخص نصي")
        await wa.send_text(company_id, row["phone"], caption)
        return
    b64 = base64.b64encode(pdf_bytes).decode()
    ok = await wa.send_document(company_id, row["phone"], f"{row['invoice_no']}.pdf", b64, caption)
    if not ok:
        await wa.send_text(company_id, row["phone"], caption)


async def _invoice_pdf_bytes(company_id: str, invoice_id: str) -> bytes:
    """الفاتورة الرسمية (pdf_v2: لوجو + QR زكاة + تصميم الشركة)؛ لو فشلت نرجع للمولّد القديم"""
    try:
        from .pdf_v2 import build_invoice_pdf_v2
        return await build_invoice_pdf_v2(company_id, invoice_id)
    except Exception:
        import logging
        logging.getLogger(__name__).exception("pdf_v2 failed, falling back to legacy pdf")
        from .pdf import build_invoice_pdf
        return await build_invoice_pdf(company_id, invoice_id)


@router.get("", response_model=list[InvoiceOut])
async def list_invoices(customerId: str | None = Query(default=None),
                        branchId: str | None = Query(default=None),
                        date_from: str | None = Query(default=None, alias="from"),
                        date_to: str | None = Query(default=None, alias="to"),
                        limit: int = Query(default=100, ge=1, le=500),
                        offset: int = Query(default=0, ge=0),
                        q: str | None = Query(default=None, max_length=80),
                        invoiceNo: str | None = Query(default=None, max_length=40),
                        customer: str | None = Query(default=None, max_length=80),
                        plate: str | None = Query(default=None, max_length=20),
                        source: str | None = Query(default=None, pattern="^(pos|car)$"),
                        status: str | None = Query(default=None, pattern="^(active|returned|credit)$"),
                        minTotal: float | None = Query(default=None, ge=0),
                        maxTotal: float | None = Query(default=None, ge=0),
                        user: CurrentUser = Depends(require_permission(*_VIEW_PERMS))):
    return await service.list_invoices(
        user.company_id, user.branch_scope, branchId, customerId, date_from, date_to, limit,
        q=q, invoice_no=invoiceNo, customer=customer, plate=plate, source=source, status=status,
        min_total=minTotal, max_total=maxTotal, offset=offset,
    )


@router.get("/by-car/{car_id}")
async def invoices_by_car(car_id: str, limit: int = Query(default=5, ge=1, le=20),
                          user: CurrentUser = Depends(require_permission("invoices.prepare"))):
    """آخر فواتير السيارة ببنودها — التجهيز يعرض السوابق ويكرر آخر فاتورة (المسار قبل /{invoice_id} عمداً)"""
    return await service.invoices_by_car(user.company_id, car_id, limit)


@router.get("/{invoice_id}", response_model=InvoiceDetailOut)
async def get_invoice(invoice_id: str, user: CurrentUser = Depends(require_permission(*_VIEW_PERMS))):
    return await service.get_invoice(user.company_id, invoice_id)


@router.post("/{invoice_id}/return", status_code=200)
async def return_invoice(invoice_id: str,
                         user: CurrentUser = Depends(require_permission("invoices.return"))):
    await service.return_invoice(user.company_id, user.user_id, user.email, invoice_id)
    return {"success": True}


@router.post("/{invoice_id}/partial-return", response_model=PartialReturnOut, status_code=201)
async def partial_return_invoice(invoice_id: str, body: PartialReturnIn,
                                 user: CurrentUser = Depends(require_permission("invoices.return"))):
    """مرتجع بنود/كميات معينة من فاتورة صادرة — الفاتورة الأصلية تفضل كما هي
    (متطلبات ZATCA)، والمرتجع يتسجّل كحركة منفصلة. يتطلب رمز اعتماد مشرف لو
    الشركة مفعّلة رموز اعتماد (نفس حارس اعتماد أوامر العمل)."""
    return await service.partial_return_invoice(
        user.company_id, user.user_id, user.email, invoice_id,
        [it.model_dump() for it in body.items], body.note, body.approvalPin,
    )


@router.get("/{invoice_id}/returns", response_model=list[PartialReturnOut])
async def invoice_returns(invoice_id: str, user: CurrentUser = Depends(require_permission(*_VIEW_PERMS))):
    return await service.list_invoice_returns(user.company_id, invoice_id)


@router.get("/{invoice_id}/pdf")
async def invoice_pdf(invoice_id: str,
                      user: CurrentUser = Depends(require_permission(*_VIEW_PERMS))):
    """فاتورة PDF A4 — للتنزيل أو الإرسال"""
    from fastapi.responses import Response
    try:
        pdf = await _invoice_pdf_bytes(user.company_id, invoice_id)
    except ImportError:
        raise HTTPException(501, "محرك PDF غير مثبت — شغّل INSTALL-Z8.bat لتثبيت المتطلبات الجديدة")
    return Response(content=pdf, media_type="application/pdf",
                    headers={"Content-Disposition": f"inline; filename={invoice_id}.pdf"})


@router.post("/{invoice_id}/send-whatsapp")
async def invoice_send_wa(invoice_id: str,
                          user: CurrentUser = Depends(require_permission(*_VIEW_PERMS))):
    """إرسال الفاتورة واتساب يدوياً (زر في الشاشة)"""
    await _send_invoice_wa(user.company_id, invoice_id)
    return {"queued": True}
