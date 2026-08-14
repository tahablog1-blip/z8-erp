# modules/purchases/api.py — طبقة الـ HTTP: مسارات + صلاحيات فقط
from fastapi import APIRouter, Depends, Query

from ...core.deps import CurrentUser, require_permission
from . import service
from .schemas import PurchaseInvoiceCreate, PurchaseInvoiceDetailOut, PurchaseInvoiceOut

router = APIRouter()
_PERM = "purchasing.invoices"


@router.post("/purchase-invoices", response_model=PurchaseInvoiceOut, status_code=201)
async def create_purchase_invoice(body: PurchaseInvoiceCreate,
                                  user: CurrentUser = Depends(require_permission(_PERM))):
    return await service.create_purchase_invoice(user.company_id, user.user_id, body.model_dump())


@router.get("/purchase-invoices", response_model=list[PurchaseInvoiceOut])
async def list_purchase_invoices(supplierId: str | None = Query(default=None),
                                 status: str | None = Query(default=None),
                                 user: CurrentUser = Depends(require_permission(_PERM))):
    return await service.list_purchase_invoices(user.company_id, supplierId, status)


@router.get("/purchase-invoices/{invoice_id}", response_model=PurchaseInvoiceDetailOut)
async def get_purchase_invoice(invoice_id: str, user: CurrentUser = Depends(require_permission(_PERM))):
    return await service.get_purchase_invoice(user.company_id, invoice_id)
