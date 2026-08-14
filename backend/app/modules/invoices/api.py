# modules/invoices/api.py — طبقة الـ HTTP: مسارات + صلاحيات فقط
from fastapi import APIRouter, Depends, HTTPException, Query

from ...core.deps import CurrentUser, get_current_user, require_permission
from . import service
from .schemas import InvoiceCreate, InvoiceDetailOut, InvoiceOut

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

    inv = await service.create_invoice(user.company_id, user.user_id, user.email, body.model_dump())

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
        if inv.get("customer_id") and not any(p.get("method") == "credit" for p in (body.payments or [])):
            import asyncio as _aio
            _aio.create_task(_send_invoice_wa(user.company_id, inv["id"]))
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
        return
    caption = (f"🧾 فاتورتكم من مصدر الزيوت\nرقم: {row['invoice_no']}"
               f"\nالإجمالي: {float(row['total_inc']):.2f} ر.س شامل الضريبة\nشكراً لتعاملكم معنا 🌟")
    try:
        from .pdf import build_invoice_pdf
        import base64
        pdf_bytes = await build_invoice_pdf(company_id, invoice_id)
        b64 = base64.b64encode(pdf_bytes).decode()
        ok = await wa.send_document(company_id, row["phone"],
                                    f"{row['invoice_no']}.pdf", b64, caption)
        if not ok:
            await wa.send_text(company_id, row["phone"], caption)
    except ImportError:
        print("⚠ محرك PDF غير مثبت (شغّل INSTALL-Z8) — إرسال نصي بديل")
        await wa.send_text(company_id, row["phone"], caption)
    except Exception as e:
        print(f"⚠ PDF واتساب: {type(e).__name__}: {e}")
        await wa.send_text(company_id, row["phone"], caption)


@router.get("", response_model=list[InvoiceOut])
async def list_invoices(customerId: str | None = Query(default=None),
                        branchId: str | None = Query(default=None),
                        date_from: str | None = Query(default=None, alias="from"),
                        date_to: str | None = Query(default=None, alias="to"),
                        limit: int = Query(default=100, ge=1, le=500),
                        user: CurrentUser = Depends(require_permission(*_VIEW_PERMS))):
    return await service.list_invoices(
        user.company_id, user.branch_scope, branchId, customerId, date_from, date_to, limit
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


@router.get("/{invoice_id}/pdf")
async def invoice_pdf(invoice_id: str,
                      user: CurrentUser = Depends(require_permission(*_VIEW_PERMS))):
    """فاتورة PDF A4 — للتنزيل أو الإرسال"""
    try:
        from .pdf import build_invoice_pdf
    except ImportError:
        raise HTTPException(501, "محرك PDF غير مثبت — شغّل INSTALL-Z8.bat لتثبيت المتطلبات الجديدة")
    from fastapi.responses import Response
    pdf = await build_invoice_pdf(user.company_id, invoice_id)
    return Response(content=pdf, media_type="application/pdf",
                    headers={"Content-Disposition": f"inline; filename={invoice_id}.pdf"})


@router.post("/{invoice_id}/send-whatsapp")
async def invoice_send_wa(invoice_id: str,
                          user: CurrentUser = Depends(require_permission(*_VIEW_PERMS))):
    """إرسال الفاتورة واتساب يدوياً (زر في الشاشة)"""
    await _send_invoice_wa(user.company_id, invoice_id)
    return {"queued": True}
