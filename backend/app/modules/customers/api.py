# modules/customers/api.py — طبقة الـ HTTP: مسارات + صلاحيات فقط
# ملاحظة ترتيب: المسارات الثابتة (search-by-plate, lookup-by-plate) لازم تفضل
# قبل /{customer_id} وإلا Express/FastAPI هيحاول يفسّرها كـ id.
from fastapi import APIRouter, Depends, Query, Request
from pydantic import BaseModel, Field

from ...core.deps import CurrentUser, get_current_user, require_permission
from . import overview, service
from .schemas import (
    CustomerCreate, CustomerOut, CustomerUpdate, PaymentBody,
    StatementOut, VehicleCreate, VehicleOut, VehicleUpdate,
)


class RedeemPointsIn(BaseModel):
    points: int = Field(gt=0)

router = APIRouter()


# ══════════════════ مسارات ثابتة (قبل /{id}) ══════════════════

@router.get("/search-by-plate", response_model=list[CustomerOut])
async def search_by_plate(plate: str = Query(default=""),
                          user: CurrentUser = Depends(get_current_user)):
    """مطابقة جزئية برقم اللوحة — لشاشة اختيار العميل بنقطة البيع"""
    return await service.search_by_plate(user.company_id, plate)


@router.get("/lookup-by-plate", response_model=CustomerOut)
async def lookup_by_plate(plate: str = Query(...),
                          user: CurrentUser = Depends(get_current_user)):
    """عميل واحد بالتطابق الكامل للوحة — يفيد عند تسجيل دخول سيارة جديدة"""
    return await service.lookup_by_plate(user.company_id, plate)


@router.put("/vehicles/{vehicle_id}", response_model=VehicleOut)
async def update_vehicle(vehicle_id: str, body: VehicleUpdate,
                         user: CurrentUser = Depends(require_permission("customers.edit"))):
    """تعديل بيانات سيارة (إضافة جديدة — لا تغيّر العقود القائمة)"""
    return await service.update_vehicle(user.company_id, vehicle_id, body.model_dump(exclude_unset=True))


@router.delete("/vehicles/{vehicle_id}", status_code=204)
async def delete_vehicle(vehicle_id: str,
                         user: CurrentUser = Depends(require_permission("customers.edit"))):
    await service.delete_vehicle(user.company_id, vehicle_id)


# ══════════════════ مركز قيادة العملاء (قائمة مُصفّحة + مؤشرات + 360) ══════════════════

@router.get("/overview")
async def customers_overview(request: Request, user: CurrentUser = Depends(get_current_user)):
    """قائمة العملاء بترقيم/فرز/فلاتر من السيرفر + مؤشرات الفترة. الأرقام المالية لمن يملك الصلاحية فقط."""
    return await overview.list_overview(user.company_id, user, dict(request.query_params))


@router.get("/check-duplicate")
async def check_duplicate(phone: str | None = None, email: str | None = None, vat: str | None = None,
                          name: str | None = None, excludeId: str | None = None,
                          user: CurrentUser = Depends(get_current_user)):
    return await overview.check_duplicate(user.company_id, phone, email, vat, name, excludeId)


class BulkStatusIn(BaseModel):
    ids: list[str] = Field(min_length=1, max_length=500)
    active: bool


@router.post("/bulk-status")
async def bulk_status(body: BulkStatusIn, user: CurrentUser = Depends(require_permission("customers.delete"))):
    """تعطيل/تفعيل جماعي — التعطيل فقط (لا حذف)، ويُتخطّى أي عميل عليه رصيد مستحق"""
    return await overview.bulk_status(user.company_id, body.ids, body.active)


# ══════════════════ العملاء ══════════════════

@router.get("", response_model=list[CustomerOut])
async def list_customers(user: CurrentUser = Depends(get_current_user)):
    return await service.list_customers(user.company_id)


@router.post("", response_model=CustomerOut, status_code=201)
async def create_customer(body: CustomerCreate,
                          user: CurrentUser = Depends(require_permission("customers.create"))):
    return await service.create_customer(user.company_id, body.model_dump())


@router.get("/{customer_id}", response_model=CustomerOut)
async def get_customer(customer_id: str, user: CurrentUser = Depends(get_current_user)):
    return await service.get_customer(user.company_id, customer_id)


@router.put("/{customer_id}", response_model=CustomerOut)
async def update_customer(customer_id: str, body: CustomerUpdate,
                          user: CurrentUser = Depends(require_permission("customers.edit"))):
    return await service.update_customer(
        user.company_id, customer_id, body.model_dump(exclude_unset=True)
    )


@router.delete("/{customer_id}", status_code=204)
async def delete_customer(customer_id: str,
                          user: CurrentUser = Depends(require_permission("customers.delete"))):
    await service.deactivate_customer(user.company_id, customer_id)


@router.get("/{customer_id}/profile")
async def customer_profile(customer_id: str, user: CurrentUser = Depends(get_current_user)):
    """ملف العميل 360: مؤشرات + حساب + فواتير + مدفوعات + مشتريات + خط زمني + ملاحظات (حسب الصلاحية)"""
    return await overview.profile(user.company_id, user, customer_id)


class NoteIn(BaseModel):
    note: str = Field(min_length=1, max_length=2000)


@router.post("/{customer_id}/notes", status_code=201)
async def add_note(customer_id: str, body: NoteIn,
                   user: CurrentUser = Depends(require_permission("customers.edit", "customers.create", "customers.record_payment"))):
    return await overview.add_note(user.company_id, user.user_id, customer_id, body.note)


@router.get("/{customer_id}/statement", response_model=StatementOut)
async def get_statement(customer_id: str,
                        user: CurrentUser = Depends(require_permission("customers.view_statement"))):
    """كشف الحساب: كل حركات الذمم مع الرصيد الجاري تصاعدياً"""
    return await service.get_statement(user.company_id, customer_id)


@router.post("/{customer_id}/pay", status_code=201)
async def record_payment(customer_id: str, body: PaymentBody,
                         user: CurrentUser = Depends(require_permission("customers.record_payment"))):
    await service.record_payment(
        user.company_id, user.user_id, customer_id, body.amount, body.method, body.note
    )
    return {"success": True}


# ══════════════════ نقاط الولاء ══════════════════

@router.get("/{customer_id}/loyalty-ledger")
async def loyalty_ledger(customer_id: str, user: CurrentUser = Depends(get_current_user)):
    return await service.list_loyalty_ledger(user.company_id, customer_id)


@router.post("/{customer_id}/redeem-points", status_code=201)
async def redeem_points(customer_id: str, body: RedeemPointsIn,
                        user: CurrentUser = Depends(require_permission("customers.record_payment"))):
    return await service.redeem_points(user.company_id, customer_id, body.points)


# ══════════════════ سيارات العميل (الأسطول) ══════════════════

@router.get("/{customer_id}/vehicles", response_model=list[VehicleOut])
async def list_vehicles(customer_id: str, user: CurrentUser = Depends(get_current_user)):
    return await service.list_vehicles(user.company_id, customer_id)


@router.post("/{customer_id}/vehicles", response_model=VehicleOut, status_code=201)
async def add_vehicle(customer_id: str, body: VehicleCreate,
                      user: CurrentUser = Depends(require_permission("customers.edit", "cars.create"))):
    return await service.add_vehicle(user.company_id, customer_id, body.model_dump())
