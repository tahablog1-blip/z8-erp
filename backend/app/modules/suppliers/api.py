# modules/suppliers/api.py — طبقة الـ HTTP: مسارات + صلاحيات فقط
from fastapi import APIRouter, Depends, Query

from ...core.deps import CurrentUser, require_permission
from . import overview as ov
from . import service
from .schemas import (
    PaymentBody, StatementOut, SupplierCreate, SupplierOut, SupplierScorecardOut, SupplierUpdate,
)

router = APIRouter()
_PERM = "purchasing.suppliers"


# ══════════ مركز قيادة الموردين (قراءة فقط) — يجب أن تسبق مسارات /{supplier_id} ══════════

@router.get("/overview")
async def overview_api(
    q: str | None = None, status: str | None = None, filter: str | None = None, category: str | None = None,
    sort: str | None = None, dir: str | None = None, page: int = 1, pageSize: int = 25,
    purchasesMin: str | None = None, purchasesMax: str | None = None,
    date_from: str | None = Query(default=None, alias="from"), date_to: str | None = Query(default=None, alias="to"),
    user: CurrentUser = Depends(require_permission(_PERM)),
):
    """جدول الموردين مُصفّح من السيرفر + مؤشرات الحسابات الدائنة + أعمار الديون."""
    return await ov.overview(user.company_id, user, {
        "q": q, "status": status, "filter": filter, "category": category, "sort": sort, "dir": dir, "page": page, "pageSize": pageSize,
        "purchasesMin": purchasesMin, "purchasesMax": purchasesMax, "from": date_from, "to": date_to,
    })


@router.get("/overview/categories")
async def overview_categories_api(user: CurrentUser = Depends(require_permission(_PERM))):
    return await ov.categories(user.company_id)


@router.get("/payables")
async def payables_api(supplier: str | None = None, bucket: str | None = None, overdue: bool = False,
                       user: CurrentUser = Depends(require_permission(_PERM))):
    """الفواتير الآجلة غير المسددة مع فئة العمر (مركز الحسابات المستحقة)."""
    return await ov.payables(user.company_id, {"supplier": supplier, "bucket": bucket, "overdue": overdue})


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


@router.get("/{supplier_id}/scorecard", response_model=SupplierScorecardOut)
async def get_scorecard(supplier_id: str, user: CurrentUser = Depends(require_permission(_PERM))):
    """بطاقة أداء محسوبة: الالتزام بمواعيد التوريد + حوادث فرق السعر + إجمالي المشتريات"""
    return await service.get_scorecard(user.company_id, supplier_id)


@router.post("/{supplier_id}/pay", status_code=201)
async def record_payment(supplier_id: str, body: PaymentBody,
                         user: CurrentUser = Depends(require_permission(_PERM))):
    await service.record_payment(
        user.company_id, user.user_id, supplier_id, body.amount, body.method, body.invoiceId, body.note
    )
    return {"success": True}


@router.get("/{supplier_id}/360")
async def supplier_360_api(supplier_id: str,
                           date_from: str | None = Query(default=None, alias="from"), date_to: str | None = Query(default=None, alias="to"),
                           user: CurrentUser = Depends(require_permission(_PERM))):
    """ملف المورد 360: مؤشرات + فواتير + مدفوعات + كشف حساب من دفتر المورد + منتجات + اتجاه + نشاط."""
    return await ov.supplier_360(user.company_id, supplier_id, {"from": date_from, "to": date_to})


@router.post("/{supplier_id}/activate")
async def activate_supplier(supplier_id: str, user: CurrentUser = Depends(require_permission(_PERM))):
    """إعادة تفعيل مورد معطَّل (التعطيل يتم عبر DELETE الموجود ولا يحذف أي بيانات)."""
    await ov.activate(user.company_id, supplier_id)
    return {"success": True}
