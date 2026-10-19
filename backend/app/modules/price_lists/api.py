# modules/price_lists/api.py — طبقة الـ HTTP: مسارات + صلاحيات فقط
from fastapi import APIRouter, Depends, Query

from ...core.deps import CurrentUser, get_current_user, require_permission
from . import service
from .schemas import PriceListCreate, PriceListItemIn, PriceListOut, PriceListUpdate

router = APIRouter()


# القراءة مفتوحة لأي مسجّل دخول — فورم العميل وشاشة البيع يحتاجون أسماء القوائم
# بلا صلاحية إدارة (نفس فلسفة قراءة الأصناف المفتوحة لنقطة البيع)
@router.get("", response_model=list[PriceListOut])
async def list_price_lists(user: CurrentUser = Depends(get_current_user)):
    return await service.list_price_lists(user.company_id)


@router.post("", response_model=PriceListOut, status_code=201)
async def create_price_list(body: PriceListCreate,
                            user: CurrentUser = Depends(require_permission("products.price_lists"))):
    return await service.create_price_list(user.company_id, body.name)


@router.put("/{list_id}", response_model=PriceListOut)
async def rename_price_list(list_id: str, body: PriceListUpdate,
                            user: CurrentUser = Depends(require_permission("products.price_lists"))):
    return await service.rename_price_list(user.company_id, list_id, body.name)


@router.delete("/{list_id}", status_code=204)
async def delete_price_list(list_id: str,
                            user: CurrentUser = Depends(require_permission("products.price_lists"))):
    await service.delete_price_list(user.company_id, list_id)


@router.get("/{list_id}/items")
async def list_items(list_id: str, search: str | None = Query(default=None),
                     user: CurrentUser = Depends(require_permission("products.price_lists"))):
    """أصناف القائمة: كل الأصناف مع السعر العادي + سعر هذه القائمة لو له تخصيص"""
    return await service.list_items(user.company_id, list_id, search)


@router.put("/{list_id}/items/{product_id}")
async def set_item_price(list_id: str, product_id: str, body: PriceListItemIn,
                         user: CurrentUser = Depends(require_permission("products.price_lists"))):
    return await service.set_item_price(user.company_id, list_id, product_id, body.priceVat)


@router.delete("/{list_id}/items/{product_id}", status_code=204)
async def remove_item_price(list_id: str, product_id: str,
                            user: CurrentUser = Depends(require_permission("products.price_lists"))):
    await service.remove_item_price(user.company_id, list_id, product_id)
