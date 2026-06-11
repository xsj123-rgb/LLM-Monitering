from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager

from fastapi import APIRouter, Request
from fastapi.responses import StreamingResponse

from app.core.events import event_broker
from app.db.session import SessionLocal
from app.services.auth import require_user

router = APIRouter(tags=["events"])


@router.get("/api/events/stream")
async def stream_events(request: Request):
    with SessionLocal() as db:
        require_user(db, request)

    @asynccontextmanager
    async def _subscription():
        async for queue in event_broker.subscribe():
            yield queue

    async def event_generator():
        async with _subscription() as queue:
            while True:
                if await request.is_disconnected():
                    break
                try:
                    message = await asyncio.wait_for(queue.get(), timeout=20)
                    yield event_broker.format_sse(message)
                except TimeoutError:
                    yield "event: ping\ndata: {}\n\n"

    return StreamingResponse(event_generator(), media_type="text/event-stream")
