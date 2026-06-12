from __future__ import annotations

from app.core.security import decrypt_value, encrypt_value
from app.models.alert import AlertEndpoint, AlertIncident
from app.models.monitoring import ModelChannel, ProbeRun, ProbeTask
from app.schemas.monitoring import (
    AlertConfigResponse,
    AlertNotificationResponse,
    DialTaskResponse,
    MetricLogResponse,
    ModelChannelResponse,
    SLAThresholds,
)
from app.services.time import as_beijing_time


def serialize_channel(channel: ModelChannel) -> ModelChannelResponse:
    return ModelChannelResponse(
        id=channel.id,
        name=channel.name,
        apiEndpoint=channel.api_endpoint,
        apiKey=decrypt_value(channel.api_key_encrypted),
        modelIdentifier=channel.model_identifier,
        type=channel.type,
        status=channel.status,
        tags=list(channel.tags or []),
        createdAt=as_beijing_time(channel.created_at),
        updatedAt=as_beijing_time(channel.updated_at),
        lastProbeAt=as_beijing_time(channel.last_probe_at),
        lastOkAt=as_beijing_time(channel.last_ok_at),
        description=channel.description,
    )


def apply_channel_payload(channel: ModelChannel, payload: dict) -> None:
    if "name" in payload and payload["name"] is not None:
        channel.name = payload["name"]
    if "apiEndpoint" in payload and payload["apiEndpoint"] is not None:
        channel.api_endpoint = payload["apiEndpoint"]
    if "apiKey" in payload and payload["apiKey"] is not None:
        channel.api_key_encrypted = encrypt_value(payload["apiKey"])
    if "modelIdentifier" in payload and payload["modelIdentifier"] is not None:
        channel.model_identifier = payload["modelIdentifier"]
    if "type" in payload and payload["type"] is not None:
        channel.type = payload["type"]
    if "status" in payload and payload["status"] is not None:
        channel.status = payload["status"]
    if "tags" in payload and payload["tags"] is not None:
        channel.tags = list(payload["tags"])
    if "description" in payload:
        channel.description = payload["description"]


def serialize_task(task: ProbeTask) -> DialTaskResponse:
    return DialTaskResponse(
        id=task.id,
        name=task.name,
        channelId=task.channel_id,
        prompt=task.prompt,
        intervalMinutes=task.interval_minutes,
        concurrency=task.concurrency,
        status=task.status,
        thresholds=SLAThresholds(
            maxTtftMs=task.max_ttft_ms,
            minTps=task.min_tps,
            maxTotalLatencyMs=task.max_total_latency_ms,
            minSuccessRate=task.min_success_rate,
        ),
        alertChannels=list(task.alert_channel_ids or []),
        createdAt=as_beijing_time(task.created_at),
        updatedAt=as_beijing_time(task.updated_at),
        nextRunAt=as_beijing_time(task.next_run_at),
        lastRunAt=as_beijing_time(task.last_run_at),
    )


def apply_task_payload(task: ProbeTask, payload: dict) -> None:
    if "name" in payload and payload["name"] is not None:
        task.name = payload["name"]
    if "channelId" in payload and payload["channelId"] is not None:
        task.channel_id = payload["channelId"]
    if "prompt" in payload and payload["prompt"] is not None:
        task.prompt = payload["prompt"]
    if "intervalMinutes" in payload and payload["intervalMinutes"] is not None:
        task.interval_minutes = payload["intervalMinutes"]
    if "concurrency" in payload and payload["concurrency"] is not None:
        task.concurrency = payload["concurrency"]
    if "status" in payload and payload["status"] is not None:
        task.status = payload["status"]
    thresholds = payload.get("thresholds")
    if thresholds is not None:
        if isinstance(thresholds, dict):
            task.max_ttft_ms = thresholds["maxTtftMs"]
            task.min_tps = thresholds["minTps"]
            task.max_total_latency_ms = thresholds["maxTotalLatencyMs"]
            task.min_success_rate = thresholds["minSuccessRate"]
        else:
            task.max_ttft_ms = thresholds.maxTtftMs
            task.min_tps = thresholds.minTps
            task.max_total_latency_ms = thresholds.maxTotalLatencyMs
            task.min_success_rate = thresholds.minSuccessRate
    if "alertChannels" in payload and payload["alertChannels"] is not None:
        task.alert_channel_ids = list(payload["alertChannels"])


def serialize_alert(alert: AlertEndpoint) -> AlertConfigResponse:
    return AlertConfigResponse(
        id=alert.id,
        name=alert.name,
        type=alert.type,
        webhookUrl=alert.webhook_url,
        secret=decrypt_value(alert.secret_encrypted),
        status=alert.status,
        createdAt=as_beijing_time(alert.created_at),
        updatedAt=as_beijing_time(alert.updated_at),
    )


def apply_alert_payload(alert: AlertEndpoint, payload: dict) -> None:
    if "name" in payload and payload["name"] is not None:
        alert.name = payload["name"]
    if "type" in payload and payload["type"] is not None:
        alert.type = payload["type"]
    if "webhookUrl" in payload and payload["webhookUrl"] is not None:
        alert.webhook_url = payload["webhookUrl"]
    if "secret" in payload and payload["secret"] is not None:
        alert.secret_encrypted = encrypt_value(payload["secret"])
    if "status" in payload and payload["status"] is not None:
        alert.status = payload["status"]


def serialize_probe_run(run: ProbeRun) -> MetricLogResponse:
    return MetricLogResponse(
        id=run.id,
        taskId=run.task_id,
        taskName=run.task_name,
        channelId=run.channel_id,
        channelName=run.channel_name,
        timestamp=as_beijing_time(run.timestamp),
        prompt=run.prompt,
        responseText=run.response_text,
        dnsTimeMs=run.dns_time_ms,
        tcpTimeMs=run.tcp_time_ms,
        ttftMs=run.ttft_ms,
        totalLatencyMs=run.total_latency_ms,
        tokensCount=run.tokens_count,
        tps=run.tps,
        statusCode=run.status_code,
        success=run.success,
        errorMsg=run.error_msg,
        violatedTtft=run.violated_ttft,
        violatedTps=run.violated_tps,
        violatedExtLatency=run.violated_ext_latency,
        requestPayloadJson=run.request_payload_json or {},
        responseExcerpt=run.response_excerpt,
        tokenCountSource=run.token_count_source,
        trigger=run.trigger,
        sampleNo=run.sample_no,
        errorType=run.error_type,
    )


def serialize_incident(incident: AlertIncident) -> AlertNotificationResponse:
    return AlertNotificationResponse(
        id=incident.id,
        timestamp=as_beijing_time(incident.resolved_at or incident.opened_at),
        channelName=incident.channel_name,
        taskName=incident.task_name,
        metricName=incident.metric_name,
        metricValue=incident.metric_value,
        thresholdValue=incident.threshold_value,
        status=incident.status,
        alertChannelName=incident.alert_channel_name,
    )
