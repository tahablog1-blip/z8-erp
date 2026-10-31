# modules/edge/api.py — مسارات الوكيل (بمفتاحه X-Agent-Key) + إدارة الوكلاء (settings.company)
from fastapi import APIRouter, Depends, File, Form, Header, Query, UploadFile
from pydantic import BaseModel, Field

from ...core.deps import CurrentUser, require_permission
from . import service

router = APIRouter()


async def agent_dep(x_agent_key: str | None = Header(default=None)) -> dict:
    return await service.require_agent(x_agent_key)


class HelloBody(BaseModel):
    version: str | None = None
    cameras: dict = Field(default_factory=dict)       # {cameraId: {ok, reason}}


@router.post("/hello")
async def hello(body: HelloBody, agent: dict = Depends(agent_dep)):
    """نبضة حياة + حالة الكاميرات، ويرجع قائمة كاميرات فرع الوكيل (تُدار من الموقع بلا ملفات محلية)"""
    return await service.heartbeat(agent, body.version, body.cameras)


@router.get("/commands")
async def commands(wait: float = Query(default=20, ge=0, le=25), agent: dict = Depends(agent_dep)):
    return await service.poll_commands(agent, wait)


@router.post("/commands/{command_id}/result", status_code=204)
async def result(command_id: str, image: UploadFile | None = File(default=None), error: str | None = Form(default=None),
                 agent: dict = Depends(agent_dep)):
    data = await image.read() if image else None
    await service.submit_result(agent, command_id, data, error)


# ── الإدارة من الموقع ──
_ADMIN = "settings.company"


class CreateAgentBody(BaseModel):
    branchId: str
    name: str = Field(min_length=1, max_length=80)


@router.get("/admin/agents")
async def admin_agents(user: CurrentUser = Depends(require_permission(_ADMIN))):
    return await service.list_agents(user.company_id)


@router.post("/admin/agents")
async def admin_create(body: CreateAgentBody, user: CurrentUser = Depends(require_permission(_ADMIN))):
    return await service.create_agent(user.company_id, body.branchId, body.name)


@router.post("/admin/agents/{agent_id}/revoke", status_code=204)
async def admin_revoke(agent_id: str, user: CurrentUser = Depends(require_permission(_ADMIN))):
    await service.revoke_agent(user.company_id, agent_id)
