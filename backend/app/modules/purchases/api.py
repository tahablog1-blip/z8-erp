# modules/purchases/api.py — طبقة الـ HTTP: مسارات + صلاحيات فقط
from fastapi import APIRouter, Depends, Query

from ...core.deps import CurrentUser, require_permission
from . import service
from .schemas import (
    POApproveIn, POCreate, PODetailOut, POOut, PORejectIn, POReceiveIn,
    PurchaseInvoiceCreate, PurchaseInvoiceDetailOut, PurchaseInvoiceOut,
    QuotationCreate, QuotationDetailOut, QuotationOut,
)

router = APIRouter()
_PERM = "purchasing.invoices"
_PERM_QUOT = "purchasing.quotations"
_PERM_PO = "purchasing.orders"


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


# ══════════════════ عروض الأسعار ══════════════════

@router.post("/quotations", response_model=QuotationDetailOut, status_code=201)
async def create_quotation(body: QuotationCreate, user: CurrentUser = Depends(require_permission(_PERM_QUOT))):
    return await service.create_quotation(user.company_id, user.user_id, body.model_dump())


@router.get("/quotations", response_model=list[QuotationOut])
async def list_quotations(supplierId: str | None = Query(default=None),
                          status: str | None = Query(default=None),
                          user: CurrentUser = Depends(require_permission(_PERM_QUOT))):
    return await service.list_quotations(user.company_id, supplierId, status)


@router.get("/quotations/{quotation_id}", response_model=QuotationDetailOut)
async def get_quotation(quotation_id: str, user: CurrentUser = Depends(require_permission(_PERM_QUOT))):
    return await service.get_quotation(user.company_id, quotation_id)


@router.post("/quotations/{quotation_id}/reject", response_model=QuotationDetailOut)
async def reject_quotation(quotation_id: str, user: CurrentUser = Depends(require_permission(_PERM_QUOT))):
    return await service.set_quotation_status(user.company_id, quotation_id, "rejected")


# ══════════════════ أوامر الشراء ══════════════════

@router.post("/orders", response_model=PODetailOut, status_code=201)
async def create_po(body: POCreate, user: CurrentUser = Depends(require_permission(_PERM_PO))):
    return await service.create_po(user.company_id, user.user_id, body.model_dump())


@router.get("/orders", response_model=list[POOut])
async def list_pos(supplierId: str | None = Query(default=None),
                   status: str | None = Query(default=None),
                   user: CurrentUser = Depends(require_permission(_PERM_PO))):
    return await service.list_pos(user.company_id, supplierId, status)


@router.get("/orders/{po_id}", response_model=PODetailOut)
async def get_po(po_id: str, user: CurrentUser = Depends(require_permission(_PERM_PO))):
    return await service.get_po(user.company_id, po_id)


@router.post("/orders/{po_id}/approve", response_model=PODetailOut)
async def approve_po(po_id: str, body: POApproveIn,
                     user: CurrentUser = Depends(require_permission(_PERM_PO))):
    return await service.approve_po(user.company_id, user.user_id, user.full_name, po_id, body.approvalPin)


@router.post("/orders/{po_id}/reject", response_model=PODetailOut)
async def reject_po(po_id: str, body: PORejectIn,
                    user: CurrentUser = Depends(require_permission(_PERM_PO))):
    return await service.reject_po(user.company_id, user.user_id, user.full_name, po_id,
                                   body.reason, body.approvalPin)


@router.post("/orders/{po_id}/cancel", response_model=PODetailOut)
async def cancel_po(po_id: str, user: CurrentUser = Depends(require_permission(_PERM_PO))):
    return await service.cancel_po(user.company_id, po_id)


@router.post("/orders/{po_id}/receive", response_model=PODetailOut, status_code=201)
async def receive_po(po_id: str, body: POReceiveIn,
                     user: CurrentUser = Depends(require_permission(_PERM_PO))):
    """استلام مخزني (جزئي أو كامل) مقابل أمر شراء معتمد"""
    return await service.receive_po(
        user.company_id, user.user_id, user.full_name, po_id,
        [it.model_dump() for it in body.items], body.note)
