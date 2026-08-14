# modules/suppliers/api.py — طبقة الـ HTTP: مسارات + صلاحيات فقط
from fastapi import APIRouter, Depends

from ...core.deps import CurrentUser, require_permission
from . import service
from .schemas import PaymentBody, StatementOut, SupplierCreate, SupplierOut, SupplierUpdate

router = APIRouter()
_PERM = "purchasing.suppliers"


@router.get("", response_model=list[SupplierOut])
async def list_suppliers(user: CurrentUser = Depends(require_permission(_PERM))):
    return await service.list_suppliers(user.company_id)


@router.post("", response_model=SupplierOut, status_code=201)
async def create_supplier(body: SupplierCreate, user: CurrentUser = Depends(require_permission(_PERM))):
    return await service.create_supplier(user.company_id, body.model_dump())


@router.put("/{supplier_id}", response_model=SupplierOut)
async def update_supplier(supplier_id: str, body: SupplierUpdate,
                          user: CurrentUser = Depends(require_permission(_PERM))):
    return await service.update_supplier(user.company_id, supplier_id, body.model_dump(exclude_unset=True))


@router.delete("/{supplier_id}", status_code=204)
async def delete_supplier(supplier_id: str, user: CurrentUser = Depends(require_permission(_PERM))):
    await service.deactivate_supplier(user.company_id, supplier_id)


@router.get("/{supplier_id}/statement", response_model=StatementOut)
async def get_statement(supplier_id: str, user: CurrentUser = Depends(require_permission(_PERM))):
    return await service.get_statement(user.company_id, supplier_id)


@router.post("/{supplier_id}/pay", status_code=201)
async def record_payment(supplier_id: str, body: PaymentBody,
                         user: CurrentUser = Depends(require_permission(_PERM))):
    await service.record_payment(
        user.company_id, user.user_id, supplier_id, body.amount, body.method, body.invoiceId, body.note
    )
    return {"success": True}
