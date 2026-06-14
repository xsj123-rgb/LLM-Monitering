from __future__ import annotations

import asyncio
from datetime import UTC, datetime
from collections.abc import Awaitable, Callable

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.interval import IntervalTrigger
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from app.models.monitoring import ProbeTask
from app.services.probe import execute_probe_task


class ProbeScheduler:
    def __init__(self, session_factory: sessionmaker, on_error: Callable[[Exception], Awaitable[None]] | None = None):
        self._session_factory = session_factory
        self._scheduler = AsyncIOScheduler()
        self._running_task_ids: set[str] = set()
        self._lock = asyncio.Lock()
        self._on_error = on_error

    def start(self) -> None:
        if not self._scheduler.running:
            self._scheduler.start()

    async def shutdown(self) -> None:
        if self._scheduler.running:
            self._scheduler.shutdown(wait=False)

    async def reload_all(self) -> None:
        async with self._lock:
            self._scheduler.remove_all_jobs()
            with self._session_factory() as db:
                tasks = list(db.scalars(select(ProbeTask).where(ProbeTask.status == "running")))
                for task in tasks:
                    self._register_task(task)

    async def sync_task(self, task_id: str) -> None:
        async with self._lock:
            job_id = f"probe-task:{task_id}"
            if self._scheduler.get_job(job_id):
                self._scheduler.remove_job(job_id)
            with self._session_factory() as db:
                task = db.get(ProbeTask, task_id)
                if task and task.status == "running":
                    self._register_task(task)

    def _register_task(self, task: ProbeTask) -> None:
        if task.next_run_at is None:
            start_date = datetime.now(UTC)
        elif task.next_run_at.tzinfo is None:
            start_date = task.next_run_at.replace(tzinfo=UTC)
        else:
            start_date = task.next_run_at.astimezone(UTC)
        self._scheduler.add_job(
            self._run_task_job,
            IntervalTrigger(minutes=task.interval_minutes, start_date=start_date),
            id=f"probe-task:{task.id}",
            kwargs={"task_id": task.id},
            replace_existing=True,
            max_instances=1,
        )

    async def _run_task_job(self, task_id: str) -> None:
        if task_id in self._running_task_ids:
            return
        self._running_task_ids.add(task_id)
        try:
            with self._session_factory() as db:
                task = db.get(ProbeTask, task_id)
                if not task or task.status != "running":
                    return
                await execute_probe_task(db, task, trigger="scheduled")
        except Exception as exc:
            if self._on_error:
                await self._on_error(exc)
        finally:
            self._running_task_ids.discard(task_id)
