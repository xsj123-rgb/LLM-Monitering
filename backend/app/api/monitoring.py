from __future__ import annotations

from datetime import datetime, timedelta
from typing import Literal

from fastapi import APIRouter, Body, HTTPException, Query
from sqlalchemy import and_, delete, func, select
from sqlalchemy.orm import selectinload

from app.dependencies import CurrentAdminUser, CurrentUser, DBSession
from app.models.alert import AlertEndpoint, AlertIncident
from app.models.monitoring import AIAnalysisConfig, ModelChannel, ProbeRun, ProbeTask
from app.schemas.monitoring import (
    AIAnalysisConfigTestRequest,
    AIAnalysisConfigResponse,
    AIAnalysisConfigUpdate,
    AIAnalysisTestResponse,
    AlertConfigCreate,
    AlertConfigResponse,
    AlertConfigUpdate,
    AlertNotificationResponse,
    AuditAdviceResponse,
    DashboardSeriesPoint,
    DashboardSummaryResponse,
    DialTaskCreate,
    DialTaskResponse,
    DialTaskUpdate,
    MetricLogResponse,
    ModelDiscoveryRequest,
    ModelDiscoveryResponse,
    ModelChannelCreate,
    ModelChannelResponse,
    ModelChannelUpdate,
    ReportChannelSummary,
    ReportPushAdviceItem,
    ReportPushResponse,
    ReportSummaryResponse,
)
from app.services.ai_analysis import (
    ensure_ai_analysis_config,
    get_audit_advice_snapshot_map,
    refresh_audit_advices,
    test_ai_analysis_endpoint,
)
from app.services.model_discovery import fetch_models
from app.services.notifier import build_report_pdf_bytes, send_feishu_report_pdf, send_report_alerts, send_test_alert
from app.services.probe import execute_probe_task
from app.services.serialization import (
    apply_ai_analysis_config_payload,
    apply_alert_payload,
    apply_channel_payload,
    apply_task_payload,
    serialize_ai_analysis_config,
    serialize_alert,
    serialize_channel,
    serialize_incident,
    serialize_probe_run,
    serialize_task,
)
from app.services.time import as_beijing_time
import app.state as app_state

router = APIRouter(prefix="/api", tags=["monitoring"])


async def _run_immediate_probe_for_running_task(db: DBSession, task: ProbeTask) -> None:
    if task.status != "running":
        return
    await execute_probe_task(db, task, trigger="scheduled", concurrency_override=1)
    db.refresh(task)


def _build_report_summary_payload(db: DBSession, period: Literal["daily", "weekly", "monthly"]) -> ReportSummaryResponse:
    now = datetime.utcnow()
    delta = {"daily": timedelta(days=1), "weekly": timedelta(days=7), "monthly": timedelta(days=30)}[period]
    logs = list(db.scalars(select(ProbeRun).where(ProbeRun.timestamp >= now - delta)))
    total = len(logs)
    success_logs = [log for log in logs if log.success]
    success_rate = round((len(success_logs) / total) * 100, 2) if total else 100.0
    channels = list(db.scalars(select(ModelChannel)))

    channel_rows: list[ReportChannelSummary] = []
    for channel in channels:
        channel_logs = [log for log in logs if log.channel_id == channel.id]
        success_channel_logs = [log for log in channel_logs if log.success]
        compliant = [
            log
            for log in channel_logs
            if log.success and not log.violated_ttft and not log.violated_tps and not log.violated_ext_latency
        ]
        total_channel = len(channel_logs)
        avg_ttft = round(sum(log.ttft_ms for log in success_channel_logs) / len(success_channel_logs)) if success_channel_logs else 0
        avg_tps = round(sum(log.tps for log in success_channel_logs) / len(success_channel_logs), 2) if success_channel_logs else 0.0
        avg_itl = (
            round(
                sum((max(log.total_latency_ms - log.ttft_ms, 0) / max(log.tokens_count - 1, 1)) for log in success_channel_logs)
                / len(success_channel_logs),
                2,
            )
            if success_channel_logs
            else 0.0
        )
        worst_ttft = max((log.ttft_ms for log in success_channel_logs), default=0)
        channel_rows.append(
            ReportChannelSummary(
                channelId=channel.id,
                channelName=channel.name,
                total=total_channel,
                successRate=round((len(success_channel_logs) / total_channel) * 100, 2) if total_channel else 100.0,
                complianceRate=round((len(compliant) / total_channel) * 100, 2) if total_channel else 100.0,
                avgTtft=avg_ttft,
                avgTps=avg_tps,
                avgItl=avg_itl,
                worstTtft=worst_ttft,
            )
        )
    overall_sla = round(
        sum(channel.complianceRate for channel in channel_rows) / len(channel_rows),
        2,
    ) if channel_rows else 100.0
    return ReportSummaryResponse(
        period=period,
        totalDials=total,
        successRate=success_rate,
        overallSlaScore=overall_sla,
        channels=channel_rows,
    )


@router.get("/channels", response_model=list[ModelChannelResponse])
def list_channels(db: DBSession, _: CurrentUser):
    channels = list(db.scalars(select(ModelChannel).order_by(ModelChannel.created_at.desc())))
    return [serialize_channel(channel) for channel in channels]


@router.post("/channels", response_model=ModelChannelResponse)
def create_channel(payload: ModelChannelCreate, db: DBSession, _: CurrentAdminUser):
    channel = ModelChannel()
    apply_channel_payload(channel, payload.model_dump())
    db.add(channel)
    db.commit()
    db.refresh(channel)
    return serialize_channel(channel)


@router.post("/channels/discover-models", response_model=ModelDiscoveryResponse)
async def discover_channel_models(payload: ModelDiscoveryRequest, _: CurrentAdminUser):
    models, source_url = await fetch_models(payload.type, payload.apiEndpoint, payload.apiKey)
    return ModelDiscoveryResponse(models=models, sourceUrl=source_url)


@router.patch("/channels/{channel_id}", response_model=ModelChannelResponse)
def update_channel(channel_id: str, payload: ModelChannelUpdate, db: DBSession, _: CurrentAdminUser):
    channel = db.get(ModelChannel, channel_id)
    if not channel:
        raise HTTPException(status_code=404, detail="Channel not found")
    apply_channel_payload(channel, payload.model_dump(exclude_unset=True))
    db.commit()
    db.refresh(channel)
    return serialize_channel(channel)


@router.delete("/channels/{channel_id}")
def delete_channel(channel_id: str, db: DBSession, _: CurrentAdminUser):
    channel = db.get(ModelChannel, channel_id)
    if not channel:
        raise HTTPException(status_code=404, detail="Channel not found")
    db.delete(channel)
    db.commit()
    return {"ok": True}


@router.get("/tasks", response_model=list[DialTaskResponse])
def list_tasks(db: DBSession, _: CurrentUser):
    tasks = list(db.scalars(select(ProbeTask).order_by(ProbeTask.created_at.desc())))
    return [serialize_task(task) for task in tasks]


@router.get("/system/ai-analysis", response_model=AIAnalysisConfigResponse)
def get_ai_analysis_config(db: DBSession, _: CurrentAdminUser):
    config = ensure_ai_analysis_config(db)
    return serialize_ai_analysis_config(config)


@router.put("/system/ai-analysis", response_model=AIAnalysisConfigResponse)
async def update_ai_analysis_config(payload: AIAnalysisConfigUpdate, db: DBSession, _: CurrentAdminUser):
    config = ensure_ai_analysis_config(db)
    apply_ai_analysis_config_payload(config, payload.model_dump())
    db.commit()
    db.refresh(config)
    if config.enabled:
        await refresh_audit_advices(db, config, config.schedule_mode)
        db.refresh(config)
    return serialize_ai_analysis_config(config)


@router.post("/system/ai-analysis/test", response_model=AIAnalysisTestResponse)
async def test_ai_analysis_config(
    *,
    payload: AIAnalysisConfigTestRequest | None = Body(default=None),
    db: DBSession,
    _: CurrentAdminUser,
):
    config = ensure_ai_analysis_config(db)
    test_config = config
    if payload is not None:
        test_config = AIAnalysisConfig(
            enabled=config.enabled,
            provider_type=config.provider_type,
            api_endpoint=config.api_endpoint,
            api_key_encrypted=config.api_key_encrypted,
            model_identifier=config.model_identifier,
            schedule_mode=config.schedule_mode,
            status=config.status,
            last_run_at=config.last_run_at,
            last_success_at=config.last_success_at,
            last_error=config.last_error,
        )
        apply_ai_analysis_config_payload(test_config, payload.model_dump())
    try:
        message = await test_ai_analysis_endpoint(test_config)
        config.status = "healthy"
        config.last_error = None
        db.commit()
        return AIAnalysisTestResponse(ok=True, status="healthy", message=message)
    except Exception as exc:
        config.status = "error"
        config.last_error = str(exc)
        db.commit()
        return AIAnalysisTestResponse(ok=False, status="error", message=str(exc))


@router.post("/tasks", response_model=DialTaskResponse)
async def create_task(payload: DialTaskCreate, db: DBSession, _: CurrentAdminUser):
    if not db.get(ModelChannel, payload.channelId):
        raise HTTPException(status_code=400, detail="Associated channel does not exist")
    task = ProbeTask()
    apply_task_payload(task, payload.model_dump())
    db.add(task)
    db.commit()
    db.refresh(task)
    await _run_immediate_probe_for_running_task(db, task)
    if app_state.scheduler:
        await app_state.scheduler.sync_task(task.id)
    db.refresh(task)
    return serialize_task(task)


@router.patch("/tasks/{task_id}", response_model=DialTaskResponse)
async def update_task(task_id: str, payload: DialTaskUpdate, db: DBSession, _: CurrentAdminUser):
    task = db.get(ProbeTask, task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    updates = payload.model_dump(exclude_unset=True)
    previous_status = task.status
    apply_task_payload(task, updates)
    db.commit()
    db.refresh(task)
    has_non_status_updates = any(key != "status" for key in updates)
    should_run_immediately = task.status == "running" and (previous_status != "running" or has_non_status_updates)
    if should_run_immediately:
        await _run_immediate_probe_for_running_task(db, task)
    if app_state.scheduler:
        await app_state.scheduler.sync_task(task.id)
    db.refresh(task)
    return serialize_task(task)


@router.delete("/tasks/{task_id}")
async def delete_task(task_id: str, db: DBSession, _: CurrentAdminUser):
    task = db.get(ProbeTask, task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    db.delete(task)
    db.commit()
    if app_state.scheduler:
        await app_state.scheduler.sync_task(task_id)
    return {"ok": True}


@router.post("/tasks/{task_id}/probe", response_model=MetricLogResponse)
async def trigger_manual_probe(task_id: str, db: DBSession, _: CurrentAdminUser):
    task = db.get(ProbeTask, task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    runs = await execute_probe_task(db, task, trigger="manual", concurrency_override=1)
    return serialize_probe_run(runs[0])


@router.get("/alerts", response_model=list[AlertConfigResponse])
def list_alerts(db: DBSession, _: CurrentUser):
    alerts = list(db.scalars(select(AlertEndpoint).order_by(AlertEndpoint.created_at.desc())))
    return [serialize_alert(alert) for alert in alerts]


@router.post("/alerts", response_model=AlertConfigResponse)
def create_alert(payload: AlertConfigCreate, db: DBSession, _: CurrentAdminUser):
    alert = AlertEndpoint()
    apply_alert_payload(alert, payload.model_dump())
    db.add(alert)
    db.commit()
    db.refresh(alert)
    return serialize_alert(alert)


@router.patch("/alerts/{alert_id}", response_model=AlertConfigResponse)
def update_alert(alert_id: str, payload: AlertConfigUpdate, db: DBSession, _: CurrentAdminUser):
    alert = db.get(AlertEndpoint, alert_id)
    if not alert:
        raise HTTPException(status_code=404, detail="Alert endpoint not found")
    apply_alert_payload(alert, payload.model_dump(exclude_unset=True))
    db.commit()
    db.refresh(alert)
    return serialize_alert(alert)


@router.delete("/alerts/{alert_id}")
def delete_alert(alert_id: str, db: DBSession, _: CurrentAdminUser):
    alert = db.get(AlertEndpoint, alert_id)
    if not alert:
        raise HTTPException(status_code=404, detail="Alert endpoint not found")
    db.delete(alert)
    tasks = list(db.scalars(select(ProbeTask)))
    for task in tasks:
        if alert_id in (task.alert_channel_ids or []):
            task.alert_channel_ids = [value for value in task.alert_channel_ids if value != alert_id]
    db.commit()
    return {"ok": True}


@router.post("/alerts/{alert_id}/test")
async def test_alert(alert_id: str, db: DBSession, _: CurrentAdminUser):
    alert = db.get(AlertEndpoint, alert_id)
    if not alert:
        raise HTTPException(status_code=404, detail="Alert endpoint not found")
    return await send_test_alert(alert)


@router.get("/logs", response_model=list[MetricLogResponse])
def list_logs(
    db: DBSession,
    _: CurrentUser,
    channel_id: str | None = None,
    status: Literal["all", "normal", "abnormal", "unreachable"] = "all",
    range: Literal["all", "1h", "6h", "24h", "7d"] = "all",
    limit: int = Query(default=500, le=1000),
):
    stmt = select(ProbeRun).order_by(ProbeRun.timestamp.desc()).limit(limit)
    filters = []
    if channel_id:
        filters.append(ProbeRun.channel_id == channel_id)
    if status == "normal":
        filters.append(
            and_(
                ProbeRun.success.is_(True),
                ProbeRun.violated_ttft.is_(False),
                ProbeRun.violated_tps.is_(False),
                ProbeRun.violated_ext_latency.is_(False),
            )
        )
    elif status == "abnormal":
        filters.append(
            and_(
                ProbeRun.success.is_(True),
                (ProbeRun.violated_ttft.is_(True) | ProbeRun.violated_tps.is_(True) | ProbeRun.violated_ext_latency.is_(True)),
            )
        )
    elif status == "unreachable":
        filters.append(ProbeRun.success.is_(False))
    if range != "all":
        now = datetime.utcnow()
        hours_map = {"1h": 1, "6h": 6, "24h": 24, "7d": 24 * 7}
        filters.append(ProbeRun.timestamp >= now - timedelta(hours=hours_map[range]))
    if filters:
        stmt = stmt.where(*filters)
    logs = list(db.scalars(stmt))
    return [serialize_probe_run(log) for log in logs]


@router.get("/notifications", response_model=list[AlertNotificationResponse])
def list_notifications(db: DBSession, _: CurrentUser):
    incidents = list(db.scalars(select(AlertIncident).order_by(AlertIncident.opened_at.desc())))
    return [serialize_incident(incident) for incident in incidents]


@router.patch("/notifications/{notification_id}", response_model=AlertNotificationResponse)
def resolve_notification(notification_id: str, db: DBSession, _: CurrentAdminUser):
    incident = db.get(AlertIncident, notification_id)
    if not incident:
        raise HTTPException(status_code=404, detail="Notification not found")
    incident.status = "resolved"
    incident.resolved_at = datetime.utcnow()
    db.commit()
    db.refresh(incident)
    return serialize_incident(incident)


@router.get("/dashboard/summary", response_model=DashboardSummaryResponse)
def dashboard_summary(db: DBSession, _: CurrentUser):
    now = datetime.utcnow()
    since = now - timedelta(hours=24)
    total_channels = db.scalar(select(func.count(ModelChannel.id))) or 0
    total_tasks = db.scalar(select(func.count(ProbeTask.id))) or 0
    total_logs = db.scalar(select(func.count(ProbeRun.id)).where(ProbeRun.timestamp >= since)) or 0
    total_firing = db.scalar(select(func.count(AlertIncident.id)).where(AlertIncident.status == "firing")) or 0
    success_count = db.scalar(
        select(func.count(ProbeRun.id)).where(ProbeRun.timestamp >= since, ProbeRun.success.is_(True))
    ) or 0
    success_rate = round((success_count / total_logs) * 100, 2) if total_logs else 100.0
    return DashboardSummaryResponse(
        totalChannels=total_channels,
        totalTasks=total_tasks,
        totalLogs24h=total_logs,
        totalFiringNotifications=total_firing,
        averageSuccessRate24h=success_rate,
    )


@router.get("/dashboard/series", response_model=list[DashboardSeriesPoint])
def dashboard_series(db: DBSession, _: CurrentUser, channel_id: str | None = None, hours: int = 24):
    stmt = (
        select(ProbeRun)
        .where(ProbeRun.timestamp >= datetime.utcnow() - timedelta(hours=hours))
        .order_by(ProbeRun.timestamp.asc())
    )
    if channel_id:
        stmt = stmt.where(ProbeRun.channel_id == channel_id)
    logs = list(db.scalars(stmt))
    return [
        DashboardSeriesPoint(
            timestamp=as_beijing_time(log.timestamp),
            ttftMs=log.ttft_ms,
            totalLatencyMs=log.total_latency_ms,
            tps=log.tps,
            success=log.success,
            channelId=log.channel_id,
        )
        for log in logs
    ]


@router.get("/reports/summary", response_model=ReportSummaryResponse)
def report_summary(
    db: DBSession,
    _: CurrentAdminUser,
    period: Literal["daily", "weekly", "monthly"] = "weekly",
):
    return _build_report_summary_payload(db, period)


@router.get("/reports/audit-advices", response_model=AuditAdviceResponse)
async def report_audit_advices(
    db: DBSession,
    _: CurrentUser,
    period: Literal["daily", "weekly", "monthly"] = "weekly",
):
    config = ensure_ai_analysis_config(db)
    channels = list(db.scalars(select(ModelChannel).order_by(ModelChannel.created_at.desc())))
    snapshot_map = get_audit_advice_snapshot_map(db, period)
    items = []
    for channel in channels:
        snapshot = snapshot_map.get(channel.id)
        if not config.enabled:
            items.append(
                {
                    "channelId": channel.id,
                    "advice": "当前未启用 AI 建议",
                    "source": "disabled",
                    "generatedAt": None,
                    "analysisModelName": None,
                    "errorMessage": None,
                }
            )
            continue
        if snapshot is None:
            items.append(
                {
                    "channelId": channel.id,
                    "advice": "AI 建议生成中，请稍后刷新",
                    "source": "loading",
                    "generatedAt": None,
                    "analysisModelName": config.model_identifier or None,
                    "errorMessage": None,
                }
            )
            continue
        items.append(
            {
                "channelId": channel.id,
                "advice": snapshot.advice,
                "source": snapshot.source,
                "generatedAt": as_beijing_time(snapshot.generated_at),
                "analysisModelName": snapshot.analysis_model_name,
                "errorMessage": snapshot.error_message,
            }
        )
    return AuditAdviceResponse(
        period=period,
        items=items,
    )


@router.post("/reports/push", response_model=ReportPushResponse)
async def push_report(
    db: DBSession,
    _: CurrentUser,
    period: Literal["daily", "weekly", "monthly"] = "weekly",
):
    endpoints = list(
        db.scalars(
            select(AlertEndpoint).where(
                AlertEndpoint.status == "enabled",
                AlertEndpoint.type == "feishu",
            )
        )
    )
    if not endpoints:
        raise HTTPException(status_code=400, detail="未找到已启用的飞书告警通道，请先在联动告警终端中配置。")

    summary = _build_report_summary_payload(db, period)
    weakest_channels = sorted(summary.channels, key=lambda item: item.complianceRate)[:3]
    channels = list(db.scalars(select(ModelChannel).order_by(ModelChannel.created_at.desc())))
    snapshot_map = get_audit_advice_snapshot_map(db, period)
    period_labels = {"daily": "日报", "weekly": "周报", "monthly": "月报"}
    report_advices = [
        ReportPushAdviceItem(
            channelId=channel.id,
            channelName=channel.name,
            advice=(
                snapshot_map[channel.id].advice
                if channel.id in snapshot_map
                else "AI 建议生成中，请稍后刷新"
            ),
            source=(
                snapshot_map[channel.id].source
                if channel.id in snapshot_map
                else "loading"
            ),
            generatedAt=(
                as_beijing_time(snapshot_map[channel.id].generated_at)
                if channel.id in snapshot_map
                else None
            ),
            analysisModelName=(
                snapshot_map[channel.id].analysis_model_name
                if channel.id in snapshot_map
                else None
            ),
        )
        for channel in channels
    ]
    payload = {
        "kind": "report",
        "periodLabel": period_labels[period],
        "timestamp": as_beijing_time(datetime.utcnow()).strftime("%Y-%m-%d %H:%M:%S"),
        "summary": (
            f"本期 SLA {period_labels[period]}已生成。综合 SLA 达标率 {summary.overallSlaScore:.2f}%，"
            f"成功率 {summary.successRate:.2f}%，累计拨测 {summary.totalDials} 次。"
        ),
        "totalDials": summary.totalDials,
        "successRate": summary.successRate,
        "overallSlaScore": summary.overallSlaScore,
        "channelCount": len(summary.channels),
        "weakestChannels": [
            {
                "channelName": item.channelName,
                "complianceRate": item.complianceRate,
                "successRate": item.successRate,
            }
            for item in weakest_channels
        ],
        "reportAdvices": [item.model_dump() for item in report_advices],
    }
    result = await send_report_alerts(endpoints, payload)
    if result["deliveredCount"] == 0:
        raise HTTPException(
            status_code=502,
            detail="报告推送失败：" + ("；".join(result["errors"]) if result["errors"] else "未知错误"),
        )
    pdf_filename = f"LLM_Guardian_SLA_{period}_{datetime.utcnow().strftime('%Y%m%d_%H%M%S')}.pdf"
    attachment_sent, attachment_message = await send_feishu_report_pdf(
        payload=payload,
        pdf_bytes=build_report_pdf_bytes(payload),
        filename=pdf_filename,
    )
    return ReportPushResponse(
        period=period,
        attachmentSent=attachment_sent,
        attachmentMessage=attachment_message,
        **result,
    )
