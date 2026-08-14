# modules/inventory/api.py — طبقة الـ HTTP: مسارات + صلاحيات فقط
# نفس عقد النظام القديم: GET /qty مفتوح عن قصد — نقطة البيع بتستعلم عن رصيد
# الصنف قبل البيع حتى لموظف بلا صلاحية عرض المخزون الكامل.
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from ...core.deps import CurrentUser, get_current_user, require_permission
from . import service
from .schemas import (
    LevelOut, MoveOut, MoveResult, QtyOut, ReceiveBody,
    TransferBody, VoucherDetailOut, VoucherEditBody, VoucherOut,
)

router = APIRouter()


# ══════════════════ قراءة ══════════════════

@router.get("/levels", response_model=list[LevelOut])
async def list_levels(user: CurrentUser = Depends(require_permission("products.view_stock"))):
    """أرصدة كل الأصناف في المستودع وكل الفروع"""
    return await service.list_levels(user.company_id)


@router.get("/qty", response_model=QtyOut)
async def get_qty(locType: str = Query(...), locId: str = Query(...),
                  productId: str = Query(...),
                  user: CurrentUser = Depends(get_current_user)):
    """رصيد صنف واحد في موقع واحد — استعلام سريع لنقطة البيع"""
    return {"qty": await service.get_qty(user.company_id, locType, locId, productId)}


@router.get("/suppliers", response_model=list[str])
async def list_suppliers(user: CurrentUser = Depends(get_current_user)):
    """أسماء الموردين المستخدمة سابقاً — اقتراحات لحقل المورد"""
    return await service.list_suppliers(user.company_id)


@router.get("/moves", response_model=list[MoveOut])
async def list_moves(limit: int = Query(default=100, ge=1, le=300),
                     user: CurrentUser = Depends(require_permission("products.view_stock"))):
    """سجل الحركات الفردية، أحدث أولاً"""
    return await service.list_moves(user.company_id, limit)


@router.get("/vouchers", response_model=list[VoucherOut])
async def list_vouchers(user: CurrentUser = Depends(require_permission("products.view_stock"))):
    """السندات مجمّعة حسب رقم السند"""
    return await service.list_vouchers(user.company_id)


@router.get("/vouchers/{move_no}", response_model=VoucherDetailOut)
async def get_voucher(move_no: str,
                      user: CurrentUser = Depends(require_permission("products.view_stock"))):
    return await service.get_voucher(user.company_id, move_no)


# ══════════════════ كتابة ══════════════════

@router.post("/receive", response_model=MoveResult, status_code=201)
async def receive(body: ReceiveBody,
                  user: CurrentUser = Depends(
                      require_permission("purchasing.invoices", "products.view_stock"))):
    """استلام من مورد خارجي إلى المستودع (سند واحد بعدة أصناف)"""
    try:
        return await service.receive(
            user.company_id, user.user_id, user.full_name,
            [i.model_dump() for i in body.items], body.supplierName, body.note,
        )
    except RuntimeError as e:
        # شجرة الحسابات ناقصة أو القيد غير متوازن — رسالة واضحة بدل 500 غامض
        raise HTTPException(400, str(e))


@router.post("/transfer", response_model=MoveResult, status_code=201)
async def transfer(body: TransferBody,
                   user: CurrentUser = Depends(require_permission("products.view_stock"))):
    """تحويل داخلي بين أي موقعين (مستودع↔فرع أو فرع↔فرع)"""
    return await service.transfer(
        user.company_id, user.user_id, user.full_name, body.model_dump()
    )


@router.put("/vouchers/{move_no}", response_model=MoveResult)
async def edit_voucher(move_no: str, body: VoucherEditBody,
                       user: CurrentUser = Depends(require_permission("products.view_stock"))):
    """تعديل سند: استبدال قائمة أصنافه بالكامل مع تصحيح المخزون تلقائياً"""
    return await service.edit_voucher(
        user.company_id, user.user_id, user.full_name, move_no,
        [i.model_dump() for i in body.items],
    )


# ══════════════════ طلبات الفروع (Requisitions) ══════════════════

class RequestItemIn(BaseModel):
    productId: str
    productLabel: str
    qty: int


class BranchRequestIn(BaseModel):
    requestingBranchId: str | None = None   # الفرع الطالب — إجباري لو المستخدم مش مربوط بفرع (زي الأدمن)
    sourceBranchId: str | None = None       # معرّف الفرع أو "main" للمستودع الرئيسي
    note: str | None = None
    items: list[RequestItemIn]


class DecideRequestIn(BaseModel):
    approve: bool
    sourceBranchId: str | None = None
    quantities: dict[str, int] = {}
    note: str | None = None


@router.post("/requests", status_code=201)
async def create_request(body: BranchRequestIn,
                         user: CurrentUser = Depends(require_permission("inventory.request"))):
    """مدير الفرع يطلب أصناف — بدون تنفيذ مباشر، لحد ما حد يوافق"""
    requesting_branch_id = body.requestingBranchId or user.branch_id
    if not requesting_branch_id:
        raise HTTPException(422, "اختر الفرع الطالب — حسابك غير مربوط بفرع افتراضي")
    return await service.create_request(
        user.company_id, requesting_branch_id, user.user_id, user.full_name, body.model_dump())


@router.get("/requests")
async def list_requests(branchId: str | None = Query(default=None),
                        status: str | None = Query(default=None),
                        user: CurrentUser = Depends(require_permission(
                            "inventory.request", "inventory.approve_requests"))):
    """لو معاه صلاحية الموافقة يشوف كل الفروع، غير كده يشوف طلبات فرعه بس"""
    effective_branch = branchId if user.has("inventory.approve_requests") else user.branch_id
    return await service.list_requests(user.company_id, effective_branch, status)


@router.post("/requests/{request_id}/decide")
async def decide_request(request_id: str, body: DecideRequestIn,
                         user: CurrentUser = Depends(require_permission("inventory.approve_requests"))):
    """موافقة (كلية/جزئية) تنفّذ التحويل تلقائياً، أو رفض بسبب"""
    return await service.decide_request(
        user.company_id, user.user_id, user.full_name, request_id, body.model_dump())


@router.get("/reorder-suggestions")
async def reorder(user: CurrentUser = Depends(require_permission("products.view_stock", "purchasing.invoices"))):
    """اقتراحات إعادة الطلب — الأصناف عند/تحت الحد الأدنى"""
    return await service.reorder_suggestions(user.company_id)
