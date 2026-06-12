from __future__ import annotations

import asyncio
import hashlib
import hmac
import json
import smtplib
import time
from email.message import EmailMessage

import aiohttp
from sqlalchemy.orm import Session

from app.config import get_settings
from app.core.security import decrypt_value
from app.models.alert import AlertDelivery, AlertEndpoint, AlertIncident
from app.services.time import as_beijing_time


def build_notification_payload(incident: AlertIncident) -> dict:
    return {
        "id": incident.id,
        "status": incident.status,
        "timestamp": as_beijing_time(incident.resolved_at or incident.opened_at).isoformat(),
        "taskName": incident.task_name,
        "channelName": incident.channel_name,
        "metricName": incident.metric_name,
        "metricValue": incident.metric_value,
        "thresholdValue": incident.threshold_value,
        "alertChannelName": incident.alert_channel_name,
    }


async def deliver_incident(db: Session, incident: AlertIncident, endpoints: list[AlertEndpoint]) -> None:
    payload = build_notification_payload(incident)
    for endpoint in endpoints:
        delivery = AlertDelivery(
            incident_id=incident.id,
            alert_endpoint_id=endpoint.id,
            payload_json=payload,
            status="pending",
        )
        db.add(delivery)
        db.flush()
        try:
            if endpoint.type == "email":
                response_excerpt = await _send_email(endpoint.webhook_url, payload)
            else:
                response_excerpt = await _send_webhook(endpoint, payload)
            delivery.status = "sent"
            delivery.response_excerpt = response_excerpt
        except Exception as exc:
            delivery.status = "failed"
            delivery.error_msg = str(exc)
        db.flush()
    db.commit()


async def send_test_alert(endpoint: AlertEndpoint) -> dict:
    payload = {
        "kind": "test",
        "message": "LLM-Guardian alert channel connectivity test",
        "timestamp": int(time.time()),
    }
    if endpoint.type == "email":
        await _send_email(endpoint.webhook_url, payload)
    else:
        await _send_webhook(endpoint, payload)
    return {"ok": True}


async def _send_webhook(endpoint: AlertEndpoint, payload: dict) -> str:
    headers = {"Content-Type": "application/json"}
    body = payload
    if endpoint.type == "feishu":
        body = {"msg_type": "text", "content": {"text": json.dumps(payload, ensure_ascii=False)}}
    elif endpoint.type == "dingtalk":
        body = {"msgtype": "text", "text": {"content": json.dumps(payload, ensure_ascii=False)}}
        secret = decrypt_value(endpoint.secret_encrypted)
        if secret:
            timestamp = str(round(time.time() * 1000))
            sign = hmac.new(secret.encode("utf-8"), timestamp.encode("utf-8"), hashlib.sha256).hexdigest()
            headers["X-LLM-Guardian-Timestamp"] = timestamp
            headers["X-LLM-Guardian-Signature"] = sign
    async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=30)) as client:
        async with client.post(endpoint.webhook_url, headers=headers, json=body) as response:
            text = await response.text()
            if response.status >= 400:
                raise RuntimeError(f"Webhook delivery failed: {response.status} {text[:200]}")
            return text[:500]


async def _send_email(recipient: str, payload: dict) -> str:
    settings = get_settings()
    if not settings.smtp_host or not settings.smtp_from:
        raise RuntimeError("SMTP is not configured")

    def _blocking_send() -> str:
        message = EmailMessage()
        message["Subject"] = f"[LLM-Guardian] Alert {payload.get('status', 'test')}"
        message["From"] = settings.smtp_from
        message["To"] = recipient
        message.set_content(json.dumps(payload, ensure_ascii=False, indent=2))

        with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=30) as server:
            if settings.smtp_use_tls:
                server.starttls()
            if settings.smtp_username and settings.smtp_password:
                server.login(settings.smtp_username, settings.smtp_password)
            server.send_message(message)
        return "email-sent"

    return await asyncio.to_thread(_blocking_send)
