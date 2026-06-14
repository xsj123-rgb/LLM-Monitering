from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.auth import router as auth_router
from app.api.events import router as events_router
from app.api.monitoring import router as monitoring_router
from app.config import get_settings
from app.db.base import Base
from app.db.session import SessionLocal, engine
from app.scheduler.service import ProbeScheduler
from app.services.bootstrap import bootstrap_admin_user
from app.services.db_migration import ensure_auth_columns
from app.state import scheduler as scheduler_state
import app.state as app_state

settings = get_settings()


@asynccontextmanager
async def lifespan(_: FastAPI):
    Base.metadata.create_all(bind=engine)
    ensure_auth_columns(engine)
    with SessionLocal() as db:
        bootstrap_admin_user(db, settings)
    scheduler = ProbeScheduler(SessionLocal)
    app_state.scheduler = scheduler
    scheduler.start()
    await scheduler.reload_all()
    try:
        yield
    finally:
        await scheduler.shutdown()


app = FastAPI(title=settings.app_name, lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(auth_router)
app.include_router(monitoring_router)
app.include_router(events_router)


@app.get("/healthz")
def healthz():
    return {"ok": True}


@app.get("/readyz")
def readyz():
    return {"ok": True}
