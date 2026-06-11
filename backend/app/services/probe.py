from __future__ import annotations

import asyncio
from datetime import datetime, timedelta

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.adapters.ollama import OllamaProbeAdapter
from app.adapters.openai import OpenAICompatibleProbeAdapter
from app.core.events import event_broker
from app.models.alert import AlertEndpoint, AlertIncident
from app.models.monitoring import ModelChannel, ProbeBatch, ProbeRun, ProbeTask
from app.services.notifier import deliver_incident


def get_adapter(channel_type: str):
    if channel_type == "ollama":
        return OllamaProbeAdapter()
    return OpenAICompatibleProbeAdapter()


async def execute_probe_task(
    db: Session,
    task: ProbeTask,
    *,
    trigger: str,
    concurrency_override: int | None = None,
) -> list[ProbeRun]:
    channel = db.get(ModelChannel, task.channel_id)
    if not channel:
        raise ValueError("Associated channel not found")

    planned_concurrency = concurrency_override or task.concurrency
    batch = ProbeBatch(task_id=task.id, trigger=trigger, planned_concurrency=planned_concurrency, status="running")
    db.add(batch)
    task.last_run_at = datetime.utcnow()
    task.next_run_at = task.last_run_at + timedelta(minutes=task.interval_minutes)
    channel.last_probe_at = task.last_run_at
    db.commit()
    db.refresh(batch)

    adapter = get_adapter(channel.type)
    results = await asyncio.gather(
        *[adapter.execute(channel, task.prompt) for _ in range(planned_concurrency)],
        return_exceptions=False,
    )

    runs: list[ProbeRun] = []
    for index, result in enumerate(results, start=1):
        violated_ttft = result.success and result.ttft_ms > task.max_ttft_ms
        violated_tps = result.success and result.tps < task.min_tps
        violated_latency = result.success and result.total_latency_ms > task.max_total_latency_ms
        run = ProbeRun(
            batch_id=batch.id,
            task_id=task.id,
            task_name=task.name,
            channel_id=channel.id,
            channel_name=channel.name,
            timestamp=datetime.utcnow(),
            prompt=task.prompt,
            response_text=result.response_text,
            dns_time_ms=result.dns_time_ms,
            tcp_time_ms=result.tcp_time_ms,
            ttft_ms=result.ttft_ms,
            total_latency_ms=result.total_latency_ms,
            tokens_count=result.tokens_count,
            tps=result.tps,
            status_code=result.status_code,
            success=result.success,
            error_msg=result.error_msg,
            violated_ttft=violated_ttft,
            violated_tps=violated_tps,
            violated_ext_latency=violated_latency,
            sample_no=index,
            trigger=trigger,
            request_payload_json=result.request_payload,
            response_excerpt=result.response_excerpt,
            token_count_source=result.token_count_source,
            error_type=result.error_type,
        )
        db.add(run)
        runs.append(run)
    batch.finished_at = datetime.utcnow()
    batch.status = "success" if all(run.success for run in runs) else "failed"

    _update_channel_status(db, channel, runs)
    db.commit()

    for run in runs:
        await event_broker.publish(
            "probe_run.created",
            {
                "id": run.id,
                "taskId": run.task_id,
                "channelId": run.channel_id,
                "success": run.success,
            },
        )

    await _handle_incidents(db, task, channel, runs)
    return runs


async def _handle_incidents(db: Session, task: ProbeTask, channel: ModelChannel, runs: list[ProbeRun]) -> None:
    alert_names = []
    endpoints: list[AlertEndpoint] = []
    if task.alert_channel_ids:
        endpoints = list(
            db.scalars(
                select(AlertEndpoint).where(
                    AlertEndpoint.id.in_(task.alert_channel_ids), AlertEndpoint.status == "enabled"
                )
            )
        )
        alert_names = [endpoint.name for endpoint in endpoints]
    alert_channel_name = ", ".join(alert_names) or "基础设施警报流"

    triggers: list[tuple[str, str, str, str]] = []
    worst_ttft = max((run.ttft_ms for run in runs if run.success), default=0)
    min_tps = min((run.tps for run in runs if run.success), default=0.0)
    max_latency = max((run.total_latency_ms for run in runs if run.success), default=0)
    has_failure = any(not run.success for run in runs)
    has_ttft_violation = any(run.violated_ttft for run in runs)
    has_tps_violation = any(run.violated_tps for run in runs)
    has_latency_violation = any(run.violated_ext_latency for run in runs)

    if has_failure:
        triggers.append(("connection", "探测连接熔断", "HTTP failure", "HTTP 200"))
    if has_ttft_violation:
        triggers.append(("ttft", "首字延迟 (TTFT)", f"{worst_ttft} ms", f"< {task.max_ttft_ms} ms"))
    if has_tps_violation:
        triggers.append(("tps", "吞吐速率 (TPS)", f"{min_tps:.1f} Tok/s", f">= {task.min_tps} Tok/s"))
    if has_latency_violation:
        triggers.append(
            ("latency", "端到端总时间 (Latency)", f"{max_latency} ms", f"< {task.max_total_latency_ms} ms")
        )

    open_incidents = list(
        db.scalars(
            select(AlertIncident).where(
                AlertIncident.task_id == task.id,
                AlertIncident.channel_id == channel.id,
                AlertIncident.status == "firing",
            )
        )
    )

    now = datetime.utcnow()
    open_by_metric = {incident.metric_type: incident for incident in open_incidents}
    fired_metric_types = {metric_type for metric_type, *_ in triggers}

    for metric_type, metric_name, metric_value, threshold_value in triggers:
        incident = open_by_metric.get(metric_type)
        if incident:
            incident.metric_value = metric_value
            incident.threshold_value = threshold_value
            incident.metric_name = metric_name
            should_notify = not incident.last_notified_at or now - incident.last_notified_at >= timedelta(minutes=10)
        else:
            incident = AlertIncident(
                task_id=task.id,
                channel_id=channel.id,
                task_name=task.name,
                channel_name=channel.name,
                metric_type=metric_type,
                metric_name=metric_name,
                metric_value=metric_value,
                threshold_value=threshold_value,
                alert_channel_name=alert_channel_name,
                status="firing",
                opened_at=now,
            )
            db.add(incident)
            db.flush()
            should_notify = True
        if should_notify and endpoints:
            incident.last_notified_at = now
            await deliver_incident(db, incident, endpoints)
            await event_broker.publish("incident.fired", {"id": incident.id, "metricType": metric_type})
        else:
            db.commit()

    for incident in open_incidents:
        if incident.metric_type in fired_metric_types:
            continue
        incident.status = "resolved"
        incident.resolved_at = now
        db.commit()
        if endpoints:
            await deliver_incident(db, incident, endpoints)
        await event_broker.publish("incident.resolved", {"id": incident.id, "metricType": incident.metric_type})


def _update_channel_status(db: Session, channel: ModelChannel, runs: list[ProbeRun]) -> None:
    now = datetime.utcnow()
    recent_open_incidents = db.scalar(
        select(func.count(AlertIncident.id)).where(
            AlertIncident.channel_id == channel.id,
            AlertIncident.status == "firing",
            AlertIncident.opened_at >= now - timedelta(hours=1),
        )
    )
    has_failure = any(not run.success for run in runs)
    has_violation = any(run.violated_ttft or run.violated_tps or run.violated_ext_latency for run in runs)
    if has_failure:
        recent_batches = list(
            db.scalars(
                select(ProbeBatch)
                .join(ProbeTask, ProbeTask.id == ProbeBatch.task_id)
                .where(ProbeTask.channel_id == channel.id)
                .order_by(ProbeBatch.started_at.desc())
                .limit(3)
            )
        )
        if len(recent_batches) >= 3 and all(batch.status == "failed" for batch in recent_batches):
            channel.status = "offline"
        else:
            channel.status = "degraded"
    elif has_violation or recent_open_incidents:
        channel.status = "degraded"
        channel.last_ok_at = None
    else:
        channel.status = "active"
        channel.last_ok_at = now
