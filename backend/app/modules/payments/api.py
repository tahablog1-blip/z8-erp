# modules/payments/api.py — طبقة الـ HTTP: مسارات + صلاحيات فقط
from fastapi import APIRouter, Depends, Query, Request

from ...core.deps import CurrentUser, require_permission
from . import service
from .schemas import PaymentIntentCreate, PaymentProviderStatus, PaymentTransactionOut

router = APIRouter()
_PERM = "payments.view"
_PERM_CREATE = "payments.create"


@router.get("/status", response_model=PaymentProviderStatus)
async def status(user: CurrentUser = Depends(require_permission(_PERM))):
    """هل يوجد مزوّد دفع إلكتروني مفعّل فعلياً (متغير البيئة PAYMENTS_WEBHOOK_SECRET مضبوط)؟"""
    return service.provider_status()


@router.post("/intents", response_model=PaymentTransactionOut, status_code=201)
async def create_intent(body: PaymentIntentCreate,
                        user: CurrentUser = Depends(require_permission(_PERM_CREATE))):
    """إنشاء نية دفع إلكتروني لفاتورة أو عميل. بنية هيكلية جاهزة لربط مزوّد حقيقي
    (مدى/STC Pay/Apple Pay عبر Moyasar أو PayTabs أو HyperPay مثلاً) — راجع تعليق
    رأس service.py لخطوات التفعيل. بلا مزوّد مربوط حالياً يرجع checkout_url فارغاً."""
    return await service.create_intent(user.company_id, user.user_id, body.model_dump())


@router.get("/transactions", response_model=list[PaymentTransactionOut])
async def list_transactions(status: str | None = Query(default=None),
                            invoiceId: str | None = Query(default=None),
                            user: CurrentUser = Depends(require_permission(_PERM))):
    return await service.list_transactions(user.company_id, status, invoiceId)


@router.get("/transactions/{tx_id}", response_model=PaymentTransactionOut)
async def get_transaction(tx_id: str, user: CurrentUser = Depends(require_permission(_PERM))):
    return await service.get_transaction(user.company_id, tx_id)


@router.post("/webhook")
async def webhook(request: Request):
    """نقطة استقبال تأكيد الدفع من مزوّد الدفع — بلا صلاحية مستخدم (تُستدعى من خارج
    النظام مباشرة من سيرفرات المزوّد). معطّلة فعلياً (ترفض بخطأ 501) حتى يُضبط متغير
    البيئة PAYMENTS_WEBHOOK_SECRET عند ربط مزوّد حقيقي — حفاظاً على عدم قبول أي
    تأكيد دفع غير موقّع رقمياً."""
    raw = await request.body()
    signature = request.headers.get("X-Webhook-Signature")
    payload = await request.json()
    return await service.handle_webhook(raw, signature, payload)
