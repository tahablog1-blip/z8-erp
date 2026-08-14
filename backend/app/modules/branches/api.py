# modules/branches/api.py — طبقة الـ HTTP: مسارات + صلاحيات + تدقيق فقط
# نفس عقد النظام القديم: GET مفتوح للمسجّلين (القوائم المنسدلة محتاجاه في كل مكان)
# والكتابة كلها خلف صلاحية branches.manage
from fastapi import APIRouter, Depends
from ...core.deps import get_current_user, require_permission, CurrentUser
from ...core.audit import log_action
from .schemas import BranchCreate, BranchUpdate, BranchOut
from . import service

router = APIRouter()

@router.get("", response_model=list[BranchOut])
async def list_branches(user: CurrentUser = Depends(get_current_user)):
    return await service.list_branches(user.company_id)

@router.post("", response_model=BranchOut, status_code=201)
async def create_branch(body: BranchCreate,
                        user: CurrentUser = Depends(require_permission("branches.manage"))):
    branch = await service.create_branch(
        user.company_id, body.name, body.capacitySir, body.capacityHafr, body.capacityRafaat, body.lines)
    await log_action(user, "edit", "settings", details=f"إنشاء فرع: {body.name}")
    return branch

@router.put("/{branch_id}", response_model=BranchOut)
async def update_branch(branch_id: str, body: BranchUpdate,
                        user: CurrentUser = Depends(require_permission("branches.manage"))):
    branch = await service.update_branch(user.company_id, branch_id,
                                         body.model_dump(exclude_unset=True))
    await log_action(user, "edit", "settings", details=f"تعديل فرع: {branch['name']}")
    return branch

@router.delete("/{branch_id}", status_code=204)
async def delete_branch(branch_id: str,
                        user: CurrentUser = Depends(require_permission("branches.manage"))):
    await service.deactivate_branch(user.company_id, branch_id)
    await log_action(user, "delete", "settings", details="إلغاء تفعيل فرع")
