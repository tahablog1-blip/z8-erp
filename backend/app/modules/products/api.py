# modules/products/api.py — طبقة الـ HTTP: مسارات + صلاحيات + تدقيق فقط
# نفس عقد النظام القديم: مسارات القراءة (القائمة، الباركود، القوائم المتسلسلة)
# مفتوحة عن قصد للمسجّلين — نقطة البيع وتسجيل السيارات محتاجينها حتى لموظف
# بلا صلاحية إدارة الأصناف. الكتابة كلها خلف صلاحياتها.
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from ...core.audit import log_action
from ...core.deps import CurrentUser, get_current_user, require_permission
from . import service
from .schemas import ProductCreate, ProductOut, ProductUpdate, SpecOut

router = APIRouter()


# ══════════════════ قراءة ══════════════════

@router.get("", response_model=list[ProductOut])
async def list_products(search: str | None = Query(default=None),
                        user: CurrentUser = Depends(get_current_user)):
    return await service.list_products(user.company_id, search)


@router.get("/cascade/categories", response_model=list[str])
async def cascade_categories(user: CurrentUser = Depends(get_current_user)):
    """المستوى الأول من الإدخال المتسلسل: الفئات"""
    return await service.cascade_categories(user.company_id)


@router.get("/cascade/names", response_model=list[str])
async def cascade_names(category: str = Query(...),
                        user: CurrentUser = Depends(get_current_user)):
    """المستوى الثاني: أسماء الشركات المصنعة داخل الفئة"""
    return await service.cascade_names(user.company_id, category)


@router.get("/cascade/specs", response_model=list[SpecOut])
async def cascade_specs(category: str = Query(...), name: str = Query(...),
                        user: CurrentUser = Depends(get_current_user)):
    """المستوى الثالث: اللزوجات/المواصفات — بترجع بالسعر عشان يتملي تلقائياً"""
    return await service.cascade_specs(user.company_id, category, name)


# ملاحظة ترتيب: المسار الثابت ده لازم يفضل قبل أي مسار متغير زي /{id}
@router.get("/barcode/{code}", response_model=ProductOut)
async def get_by_barcode(code: str, user: CurrentUser = Depends(get_current_user)):
    """البحث بالباركود — لقارئ الباركود في نقطة البيع"""
    return await service.get_by_barcode(user.company_id, code)


# ══════════════════ كتابة ══════════════════

@router.post("", response_model=ProductOut, status_code=201)
async def create_product(body: ProductCreate,
                         user: CurrentUser = Depends(require_permission("products.create"))):
    product = await service.create_product(user.company_id, body.model_dump())
    await log_action(user, "product_add", "stock",
                     details=f"{product['category']} — {product['name']} — {product.get('spec') or ''}")
    return product


@router.put("/{product_id}", response_model=ProductOut)
async def update_product(product_id: str, body: ProductUpdate,
                         user: CurrentUser = Depends(require_permission("products.edit"))):
    product = await service.update_product(
        user.company_id, product_id, body.model_dump(exclude_unset=True)
    )
    await log_action(user, "product_edit", "stock", details=product["name"])
    return product


@router.delete("/{product_id}", status_code=204)
async def delete_product(product_id: str,
                         user: CurrentUser = Depends(require_permission("products.delete"))):
    name = await service.deactivate_product(user.company_id, product_id)
    await log_action(user, "product_delete", "stock", details=name)


class AutoClassifyIn(BaseModel):
    apply: bool = False
    onlyUncategorized: bool = True


@router.post("/auto-classify")
async def auto_classify(body: AutoClassifyIn,
                        user: CurrentUser = Depends(require_permission("products.edit", "products.create"))):
    """المصنّف الذكي: معاينة (apply=false) ثم تطبيق (apply=true)"""
    return await service.auto_classify(user.company_id, body.apply, body.onlyUncategorized)


# ══════════════════ شركات الزيوت + الصور + بوابة العميل ══════════════════

class ImageIn(BaseModel):
    imageBase64: str | None = None      # None = حذف الصورة


class BrandIn(BaseModel):
    name: str
    logoBase64: str | None = None


class AssignIn(BaseModel):
    productIds: list[str] = []


@router.put("/{product_id}/image")
async def set_image(product_id: str, body: ImageIn,
                    user: CurrentUser = Depends(require_permission("products.edit", "products.create"))):
    return await service.set_product_image(user.company_id, product_id, body.imageBase64)


@router.get("/oil-brands")
async def oil_brands(user: CurrentUser = Depends(get_current_user)):
    return await service.list_oil_brands(user.company_id)


@router.post("/oil-brands")
async def create_brand(body: BrandIn,
                       user: CurrentUser = Depends(require_permission("products.edit", "products.create"))):
    return await service.upsert_oil_brand(user.company_id, body.name, body.logoBase64)


@router.put("/oil-brands/{brand_id}")
async def update_brand(brand_id: str, body: BrandIn,
                       user: CurrentUser = Depends(require_permission("products.edit", "products.create"))):
    return await service.upsert_oil_brand(user.company_id, body.name, body.logoBase64, brand_id)


@router.delete("/oil-brands/{brand_id}")
async def remove_brand(brand_id: str,
                       user: CurrentUser = Depends(require_permission("products.edit", "products.create"))):
    return await service.delete_oil_brand(user.company_id, brand_id)


@router.post("/oil-brands/{brand_id}/assign")
async def assign_brand(brand_id: str, body: AssignIn,
                       user: CurrentUser = Depends(require_permission("products.edit", "products.create"))):
    return await service.assign_brand_products(user.company_id, brand_id, body.productIds)


@router.get("/kiosk-oils")
async def kiosk(user: CurrentUser = Depends(get_current_user)):
    """بيانات بوابة اختيار الزيت — متاحة لأي مستخدم مسجل (التابلت بيشتغل بحساب موظف البوابة)"""
    return await service.kiosk_oils(user.company_id)


# ══════════════════ قواعد تسعير الخدمة حسب السيارة ══════════════════

class ServiceRuleIn(BaseModel):
    serviceProductId: str
    brand: str | None = None
    model: str | None = None
    yearFrom: int | None = None
    yearTo: int | None = None
    price: float


@router.get("/service-price-rules")
async def list_service_rules(user: CurrentUser = Depends(get_current_user)):
    return await service.list_service_rules(user.company_id)


@router.post("/service-price-rules", status_code=201)
async def create_service_rule(body: ServiceRuleIn,
                              user: CurrentUser = Depends(require_permission("products.edit", "products.create"))):
    return await service.create_service_rule(user.company_id, body.model_dump())


@router.delete("/service-price-rules/{rule_id}")
async def delete_service_rule(rule_id: str,
                              user: CurrentUser = Depends(require_permission("products.edit", "products.create"))):
    return await service.delete_service_rule(user.company_id, rule_id)


class AiCleanIn(BaseModel):
    apply: bool = False
    onlyOils: bool = True


@router.post("/ai-clean-names")
async def ai_clean_names(body: AiCleanIn,
                         user: CurrentUser = Depends(require_permission("products.edit", "products.create"))):
    """منظف الأسماء الذكي — دفعة 120 صنف في المرة (معاينة ثم تطبيق)"""
    return await service.ai_clean_names(user.company_id, body.apply, body.onlyOils)


# ══════════════════ استيراد Excel (تصدير Odoo) — سعر البيع شامل الضريبة ══════════════════
from fastapi import UploadFile, File as _File
from .xlsx_lite import read_xlsx_rows

# مطابقة مرنة لعناوين الأعمدة العربية (زي ما بتيجي من تصدير Odoo بالحرف)
_IMPORT_HEADERS = {
    "name":      ("الاسم", "اسم المنتج"),
    "barcode":   ("مرجع داخلي", "الباركود", "المرجع الداخلي"),
    "price_vat": ("سعر البيع", "سعر المبيع", "سعر الوحدة", "أسعار البيع",
                  "سعر التجزئة", "السعر العام", "sales price", "list_price"),  # ⚠ شامل الضريبة
    "cost":      ("التكلفة", "سعر التكلفة", "cost"),
    "unit":      ("وحدة القياس", "الوحدة"),
    "category":  ("فئة نقطة البيع", "الفئة", "فئة المنتج", "pos_categ"),
}

_INVISIBLE = dict.fromkeys(map(ord, "\u200e\u200f\u202a\u202b\u202c\u200b\ufeff\u0640"))
_INVISIBLE[0x00A0] = " "   # المسافة الخاصة NBSP → مسافة عادية (مش حذف — وإلا الكلمات تلتزق)

def _norm_header(h: str) -> str:
    """تطبيع عنوان العمود: إزالة محارف الاتجاه الخفية وتوحيد المسافات —
    تصديرات Odoo العربية كتير بتحقن علامات RTL غير مرئية بتكسر المطابقة النصية."""
    return " ".join(str(h).translate(_INVISIBLE).split()).strip().lower()


@router.post("/import-excel")
async def import_excel(file: UploadFile = _File(...),
                       dryRun: bool = Query(default=False),
                       user: CurrentUser = Depends(require_permission("products.create", "products.edit"))):
    """رفع ملف Excel للمنتجات: الأعمدة المعتمدة — الاسم / مرجع داخلي / سعر البيع (شامل
    الضريبة) / التكلفة / وحدة القياس / فئة نقطة البيع. المطابقة بالباركود ثم الاسم."""
    data = await file.read()
    try:
        raw = read_xlsx_rows(data)
    except Exception as e:
        raise HTTPException(422, f"تعذّرت قراءة الملف — تأكد أنه xlsx سليم ({type(e).__name__})")
    if not raw or len(raw) < 2:
        raise HTTPException(422, "الملف فاضي — لازم صف عناوين وصف بيانات على الأقل")

    headers = [h.strip() for h in raw[0]]
    normed = [_norm_header(h) for h in headers]
    col_of: dict[str, int] = {}
    for key, names in _IMPORT_HEADERS.items():
        for i, h in enumerate(normed):
            if any(_norm_header(n) in h for n in names):
                col_of[key] = i
                break
    if "name" not in col_of:
        raise HTTPException(422, f"مش لاقي عمود «الاسم» — العناوين الموجودة: {headers}")

    def cell(row: list[str], key: str) -> str:
        i = col_of.get(key)
        return row[i] if i is not None and i < len(row) else ""

    rows = [{k: cell(r, k) for k in _IMPORT_HEADERS} for r in raw[1:]]

    if dryRun:
        # ── معاينة بلا أي كتابة: كده بالظبط هيتسجل كل صنف — القرار للمستخدم ──
        sample = []
        for r in rows[:8]:
            if not (r.get("name") or "").strip():
                continue
            pv = r.get("price_vat")
            sample.append({
                "name": r["name"], "barcode": r.get("barcode") or "—",
                "priceVat": pv or "—",
                "priceEx": round(float(pv) / 1.15, 2) if pv not in (None, "") else "—",
                "cost": r.get("cost") or "—", "unit": r.get("unit") or "قطعة",
                "category": r.get("category") or "—",
            })
        detected = {k: (headers[col_of[k]] if k in col_of else "❌ مش موجود") for k in _IMPORT_HEADERS}
        total = sum(1 for r in rows if (r.get("name") or "").strip())
        return {"preview": True, "totalRows": total, "columns": detected, "sample": sample,
                "rawHeaders": headers}

    result = await service.import_products_rows(user.company_id, rows)
    print(f"📦 استيراد منتجات: +{result['added']} جديد | ~{result['updated']} تحديث | "
          f"أخطاء {result['errorsTotal']} — بواسطة {user.email}")
    return result


@router.post("/wipe-all")
async def wipe_all(confirm: str = Query(default=""),
                   user: CurrentUser = Depends(require_permission("products.delete"))):
    """مسح كل الأصناف (تعطيل شامل يحفظ تاريخ الفواتير) — يتطلب confirm=WIPE"""
    if confirm != "WIPE":
        raise HTTPException(422, "التأكيد مطلوب")
    result = await service.wipe_all_products(user.company_id)
    print(f"🗑 مسح شامل للأصناف: {result['deactivated']} صنف اتعطل — بواسطة {user.email}")
    return result


class AutoAssignIn(BaseModel):
    apply: bool = False


@router.post("/oil-brands/auto-assign")
async def oil_brands_auto_assign(body: AutoAssignIn,
                                 user: CurrentUser = Depends(require_permission("products.edit", "products.create"))):
    """توزيع الزيوت على شركاتها تلقائياً — معاينة (apply=false) ثم تطبيق"""
    return await service.auto_assign_brands(user.company_id, body.apply)
