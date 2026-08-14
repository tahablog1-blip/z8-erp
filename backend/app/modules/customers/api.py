# modules/customers/api.py — طبقة الـ HTTP: مسارات + صلاحيات فقط
# ملاحظة ترتيب: المسارات الثابتة (search-by-plate, lookup-by-plate) لازم تفضل
# قبل /{customer_id} وإلا Express/FastAPI هيحاول يفسّرها كـ id.
from fastapi import APIRouter, Depends, Query

from ...core.deps import CurrentUser, get_current_user, require_permission
from . import service
from .schemas import (
    CustomerCreate, CustomerOut, CustomerUpdate, PaymentBody,
    StatementOut, VehicleCreate, VehicleOut,
)

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


@router.delete("/vehicles/{vehicle_id}", status_code=204)
async def delete_vehicle(vehicle_id: str,
                         user: CurrentUser = Depends(require_permission("customers.edit"))):
    await service.delete_vehicle(user.company_id, vehicle_id)


# ══════════════════ العملاء ══════════════════

@router.get("", response_model=list[CustomerOut])
async def list_customers(user: CurrentUser = Depends(get_current_user)):
    return await service.list_customers(user.company_id)


@router.post("", response_model=CustomerOut, status_code=201)
async def create_customer(body: CustomerCreate,
                          user: CurrentUser = Depends(require_permission("customers.create"))):
    return await service.create_customer(user.company_id, body.model_dump())


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


# ══════════════════ سيارات العميل (الأسطول) ══════════════════

@router.get("/{customer_id}/vehicles", response_model=list[VehicleOut])
async def list_vehicles(customer_id: str, user: CurrentUser = Depends(get_current_user)):
    return await service.list_vehicles(user.company_id, customer_id)


@router.post("/{customer_id}/vehicles", response_model=VehicleOut, status_code=201)
async def add_vehicle(customer_id: str, body: VehicleCreate,
                      user: CurrentUser = Depends(require_permission("customers.edit", "cars.create"))):
    return await service.add_vehicle(user.company_id, customer_id, body.model_dump())
