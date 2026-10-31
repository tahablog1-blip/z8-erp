# core/camera_grab.py — نقطة واحدة لالتقاط لقطة من كاميرا محطة:
# إن كان لفرعها وكيل متصل (داخل شبكة المحطة) تُطلب منه، وإلا تُلتقط مباشرة من السيرفر (السلوك القديم لكاميرات يصل لها السيرفر).
import asyncio


async def grab_jpeg(camera_id, company_id, branch_id, rtsp_url: str) -> bytes:
    from ..modules.edge import service as edge
    agent = await edge.online_agent_for_branch(str(company_id), str(branch_id)) if branch_id else None
    if agent and camera_id:
        return await edge.request_snapshot(agent, str(camera_id))
    from ..modules.cameras.api import _grab_frame      # استيراد متأخر: تفادي الدوران
    return await asyncio.to_thread(_grab_frame, rtsp_url)
