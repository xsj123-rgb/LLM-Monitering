from __future__ import annotations

import asyncio
import json
from collections.abc import AsyncIterator


class EventBroker:
    def __init__(self) -> None:
        self._subscribers: set[asyncio.Queue[dict]] = set()

    async def subscribe(self) -> AsyncIterator[asyncio.Queue[dict]]:
        queue: asyncio.Queue[dict] = asyncio.Queue()
        self._subscribers.add(queue)
        try:
            yield queue
        finally:
            self._subscribers.discard(queue)

    async def publish(self, event_type: str, payload: dict) -> None:
        message = {"event": event_type, "data": payload}
        for queue in list(self._subscribers):
            await queue.put(message)

    @staticmethod
    def format_sse(message: dict) -> str:
        return f"event: {message['event']}\ndata: {json.dumps(message['data'], ensure_ascii=False)}\n\n"


event_broker = EventBroker()
