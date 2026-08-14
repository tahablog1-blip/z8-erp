"""
Z8 - مركز البث اللحظي (WebSocket Hub)
=====================================
يبث حدث دخول السيارة لكل الشاشات المفتوحة في نفس الفرع لحظياً.
"""

import json
import asyncio
import logging
from typing import Dict, Set, Any
from datetime import datetime, date
from decimal import Decimal

from fastapi import WebSocket

log = logging.getLogger("z8.gate.ws")


def _encode(obj: Any) -> Any:
    if isinstance(obj, Decimal):
        return float(obj)
    if isinstance(obj, (datetime, date)):
        return obj.isoformat()
    raise TypeError(f"غير قابل للتحويل: {type(obj)}")


class GateHub:
    def __init__(self) -> None:
        self._rooms: Dict[str, Set[WebSocket]] = {}
        self._lock = asyncio.Lock()

    async def connect(self, ws: WebSocket, branch_id: str) -> None:
        await ws.accept()
        async with self._lock:
            self._rooms.setdefault(str(branch_id), set()).add(ws)
        log.info("شاشة اتصلت بالفرع %s (المتصلين: %d)",
                 branch_id, len(self._rooms.get(str(branch_id), ())))

    async def disconnect(self, ws: WebSocket, branch_id: str) -> None:
        async with self._lock:
            room = self._rooms.get(str(branch_id))
            if room:
                room.discard(ws)
                if not room:
                    self._rooms.pop(str(branch_id), None)

    async def broadcast(self, branch_id: Any, payload: dict) -> int:
        """يبث للفرع ويرجع عدد الشاشات اللي وصلها"""
        room = list(self._rooms.get(str(branch_id), ()))
        if not room:
            return 0

        text = json.dumps(payload, ensure_ascii=False, default=_encode)
        dead, sent = [], 0

        for ws in room:
            try:
                await ws.send_text(text)
                sent += 1
            except Exception:
                dead.append(ws)

        if dead:
            async with self._lock:
                r = self._rooms.get(str(branch_id))
                if r:
                    for ws in dead:
                        r.discard(ws)
        return sent

    def connections(self, branch_id: Any) -> int:
        return len(self._rooms.get(str(branch_id), ()))


hub = GateHub()
