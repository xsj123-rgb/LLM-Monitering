from __future__ import annotations

import asyncio
import hashlib
import hmac
import json
import smtplib
import time
from datetime import datetime
from email.message import EmailMessage
from io import BytesIO
from textwrap import shorten

import aiohttp
from sqlalchemy.orm import Session

from app.config import get_settings
from app.core.security import decrypt_value
from app.models.alert import AlertDelivery, AlertEndpoint, AlertIncident
from app.services.time import as_beijing_time


def build_notification_payload(incident: AlertIncident) -> dict:
    opened_at = incident.opened_at
    resolved_at = incident.resolved_at
    return {
        "id": incident.id,
        "status": incident.status,
        "timestamp": _format_card_time(resolved_at or opened_at),
        "openedAt": _format_card_time(opened_at),
        "resolvedAt": _format_card_time(resolved_at),
        "recoveryDuration": _format_recovery_duration(opened_at, resolved_at),
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
        "timestamp": _format_card_time(datetime.now()),
    }
    if endpoint.type == "email":
        await _send_email(endpoint.webhook_url, payload)
    else:
        await _send_webhook(endpoint, payload)
    return {"ok": True}


async def send_report_alerts(endpoints: list[AlertEndpoint], payload: dict) -> dict:
    delivered_names: list[str] = []
    errors: list[str] = []

    for endpoint in endpoints:
        try:
            if endpoint.type == "email":
                await _send_email(endpoint.webhook_url, payload)
            else:
                await _send_webhook(endpoint, payload)
            delivered_names.append(endpoint.name)
        except Exception as exc:
            errors.append(f"{endpoint.name}: {exc}")

    return {
        "deliveredCount": len(delivered_names),
        "failedCount": len(errors),
        "endpointNames": delivered_names,
        "errors": errors,
    }


async def send_feishu_report_pdf(
    *,
    payload: dict,
    pdf_bytes: bytes,
    filename: str,
) -> tuple[bool, str]:
    settings = get_settings()
    if not settings.feishu_app_id or not settings.feishu_app_secret or not settings.feishu_report_chat_id:
        return False, "未配置 FEISHU_APP_ID / FEISHU_APP_SECRET / FEISHU_REPORT_CHAT_ID，已跳过 PDF 附件发送。"

    tenant_access_token = await _get_feishu_tenant_access_token(settings.feishu_app_id, settings.feishu_app_secret)
    file_key = await _upload_feishu_file(
        tenant_access_token=tenant_access_token,
        chat_id=settings.feishu_report_chat_id,
        pdf_bytes=pdf_bytes,
        filename=filename,
    )
    await _send_feishu_file_message(
        tenant_access_token=tenant_access_token,
        chat_id=settings.feishu_report_chat_id,
        file_key=file_key,
    )
    return True, f"PDF 附件已发送到飞书群 {settings.feishu_report_chat_id}。"


async def _send_webhook(endpoint: AlertEndpoint, payload: dict) -> str:
    headers = {"Content-Type": "application/json"}
    body = _build_webhook_body(endpoint.type, payload)
    if endpoint.type == "feishu":
        pass
    elif endpoint.type == "dingtalk":
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


async def _get_feishu_tenant_access_token(app_id: str, app_secret: str) -> str:
    body = {"app_id": app_id, "app_secret": app_secret}
    async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=30)) as client:
        async with client.post(
            "https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal",
            json=body,
        ) as response:
            text = await response.text()
            if response.status >= 400:
                raise RuntimeError(f"获取飞书 tenant_access_token 失败: {response.status} {text[:200]}")
            payload = json.loads(text)
            token = payload.get("tenant_access_token")
            if not token:
                raise RuntimeError(f"飞书 tenant_access_token 响应异常: {text[:200]}")
            return str(token)


async def _upload_feishu_file(
    *,
    tenant_access_token: str,
    chat_id: str,
    pdf_bytes: bytes,
    filename: str,
) -> str:
    form = aiohttp.FormData()
    form.add_field("file_type", "pdf")
    form.add_field("file_name", filename)
    form.add_field("duration", "0")
    form.add_field("file", pdf_bytes, filename=filename, content_type="application/pdf")

    headers = {"Authorization": f"Bearer {tenant_access_token}"}
    async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=60)) as client:
        async with client.post(
            "https://open.feishu.cn/open-apis/im/v1/files",
            params={"receive_id_type": "chat_id"},
            headers=headers,
            data=form,
        ) as response:
            text = await response.text()
            if response.status >= 400:
                raise RuntimeError(f"飞书上传 PDF 失败: {response.status} {text[:200]}")
            payload = json.loads(text)
            file_key = ((payload.get("data") or {}).get("file_key"))
            if not file_key:
                raise RuntimeError(f"飞书上传 PDF 响应异常: {text[:200]}")
            return str(file_key)


async def _send_feishu_file_message(
    *,
    tenant_access_token: str,
    chat_id: str,
    file_key: str,
) -> None:
    headers = {"Authorization": f"Bearer {tenant_access_token}", "Content-Type": "application/json"}
    body = {
        "receive_id": chat_id,
        "msg_type": "file",
        "content": json.dumps({"file_key": file_key}, ensure_ascii=False),
    }
    async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=30)) as client:
        async with client.post(
            "https://open.feishu.cn/open-apis/im/v1/messages",
            params={"receive_id_type": "chat_id"},
            headers=headers,
            json=body,
        ) as response:
            text = await response.text()
            if response.status >= 400:
                raise RuntimeError(f"飞书发送 PDF 文件消息失败: {response.status} {text[:200]}")


def build_report_pdf_bytes(payload: dict) -> bytes:
    lines = [
        "LLM-Guardian SLA Report",
        "",
        f"Period: {payload.get('periodLabel', '-')}",
        f"Generated At: {payload.get('timestamp', '-')}",
        f"Total Dials: {payload.get('totalDials', 0)}",
        f"Success Rate: {payload.get('successRate', 0):.2f}%",
        f"Overall SLA: {payload.get('overallSlaScore', 0):.2f}%",
        f"Managed Channels: {payload.get('channelCount', 0)}",
        "",
        "Summary:",
        shorten(str(payload.get("summary", "-")), width=180, placeholder="..."),
        "",
        "Weakest Channels:",
    ]
    weakest_channels = payload.get("weakestChannels", [])
    if weakest_channels:
        for index, item in enumerate(weakest_channels, start=1):
            lines.append(
                f"{index}. {item.get('channelName', '-')} | SLA {float(item.get('complianceRate', 0)):.2f}% | Success {float(item.get('successRate', 0)):.2f}%"
            )
    else:
        lines.append("No weak channels identified.")

    text = "\n".join(lines)
    return _build_minimal_pdf(text)


def _build_minimal_pdf(text: str) -> bytes:
    safe_text = (
        text.replace("\\", "\\\\")
        .replace("(", "\\(")
        .replace(")", "\\)")
    )
    content_lines = ["BT", "/F1 12 Tf", "50 780 Td", "14 TL"]
    for index, line in enumerate(safe_text.splitlines()):
        if index == 0:
            content_lines.append(f"({line}) Tj")
        else:
            content_lines.append("T*")
            content_lines.append(f"({line}) Tj")
    content_lines.append("ET")
    content_stream = "\n".join(content_lines).encode("latin-1", errors="replace")

    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Count 1 /Kids [3 0 R] >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
        f"<< /Length {len(content_stream)} >>\nstream\n".encode("latin-1") + content_stream + b"\nendstream",
    ]

    buffer = BytesIO()
    buffer.write(b"%PDF-1.4\n")
    offsets = [0]
    for index, obj in enumerate(objects, start=1):
        offsets.append(buffer.tell())
        buffer.write(f"{index} 0 obj\n".encode("latin-1"))
        buffer.write(obj)
        buffer.write(b"\nendobj\n")
    xref_offset = buffer.tell()
    buffer.write(f"xref\n0 {len(objects) + 1}\n".encode("latin-1"))
    buffer.write(b"0000000000 65535 f \n")
    for offset in offsets[1:]:
        buffer.write(f"{offset:010d} 00000 n \n".encode("latin-1"))
    buffer.write(
        f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\nstartxref\n{xref_offset}\n%%EOF".encode("latin-1")
    )
    return buffer.getvalue()


def _build_webhook_body(endpoint_type: str, payload: dict) -> dict:
    if endpoint_type == "feishu":
        return _build_feishu_card(payload)
    if endpoint_type == "dingtalk":
        return {"msgtype": "text", "text": {"content": json.dumps(payload, ensure_ascii=False)}}
    return payload


def _build_feishu_card(payload: dict) -> dict:
    if payload.get("kind") == "test":
        return {
            "msg_type": "interactive",
            "card": {
                "config": {"wide_screen_mode": True, "enable_forward": True},
                "header": {
                    "template": "blue",
                    "title": {"tag": "plain_text", "content": "LLM-Guardian 联通性测试"},
                },
                "elements": [
                    {
                        "tag": "div",
                        "text": {
                            "tag": "lark_md",
                            "content": "已成功从平台发出一条测试消息，说明当前飞书机器人 webhook 可用。",
                        },
                    },
                    {
                        "tag": "div",
                        "fields": [
                            {
                                "is_short": True,
                                "text": {"tag": "lark_md", "content": f"**时间**\n{payload.get('timestamp', '-')}"}
                            },
                            {
                                "is_short": True,
                                "text": {"tag": "lark_md", "content": "**状态**\n测试成功"}
                            },
                        ],
                    },
                    {"tag": "note", "elements": [{"tag": "plain_text", "content": "后续真实 SLA 告警也会以卡片形式推送到本群。"}]},
                ],
            },
        }

    if payload.get("kind") == "report":
        period_label = payload.get("periodLabel", "周期报告")
        weakest_channels = payload.get("weakestChannels", [])
        weakest_lines = "\n".join(
            [
                f"{index}. {item.get('channelName', '-')} | SLA {item.get('complianceRate', 0):.2f}% | 成功率 {item.get('successRate', 0):.2f}%"
                for index, item in enumerate(weakest_channels, start=1)
            ]
        ) or "暂无低 SLA 节点，整体运行平稳。"

        return {
            "msg_type": "interactive",
            "card": {
                "config": {"wide_screen_mode": True, "enable_forward": True},
                "header": {
                    "template": "blue",
                    "title": {"tag": "plain_text", "content": f"LLM-Guardian SLA {period_label}"},
                },
                "elements": [
                    {
                        "tag": "div",
                        "text": {
                            "tag": "lark_md",
                            "content": payload.get("summary", "本期 SLA 合规审计报告已生成。"),
                        },
                    },
                    {
                        "tag": "div",
                        "fields": [
                            {
                                "is_short": True,
                                "text": {"tag": "lark_md", "content": f"**统计周期**\n{period_label}"},
                            },
                            {
                                "is_short": True,
                                "text": {"tag": "lark_md", "content": f"**生成时间**\n{payload.get('timestamp', '-')}"},
                            },
                            {
                                "is_short": True,
                                "text": {"tag": "lark_md", "content": f"**拨测总数**\n{payload.get('totalDials', 0)} 次"},
                            },
                            {
                                "is_short": True,
                                "text": {"tag": "lark_md", "content": f"**成功率**\n{payload.get('successRate', 0):.2f}%"},
                            },
                            {
                                "is_short": True,
                                "text": {"tag": "lark_md", "content": f"**综合 SLA**\n{payload.get('overallSlaScore', 0):.2f}%"},
                            },
                            {
                                "is_short": True,
                                "text": {"tag": "lark_md", "content": f"**纳管渠道**\n{payload.get('channelCount', 0)} 个"},
                            },
                        ],
                    },
                    {"tag": "hr"},
                    {
                        "tag": "div",
                        "text": {
                            "tag": "lark_md",
                            "content": f"**重点关注节点**\n{weakest_lines}",
                        },
                    },
                    {
                        "tag": "note",
                        "elements": [
                            {
                                "tag": "plain_text",
                                "content": "该报告由 LLM-Guardian 自动生成并推送，请结合平台中的 SLA 合规审计页查看详情。",
                            }
                        ],
                    },
                ],
            },
        }

    status = str(payload.get("status", "firing"))
    is_resolved = status == "resolved"
    header_title = "LLM-Guardian 告警恢复" if is_resolved else "LLM-Guardian SLA 告警"
    header_template = "green" if is_resolved else "red"
    status_label = "已恢复" if is_resolved else "告警中"
    status_icon = "🟢" if is_resolved else "🔴"

    summary = (
        f"{status_icon} **{payload.get('channelName', '-') }** 的 **{payload.get('metricName', '-') }** "
        f"{'已恢复到阈值范围内' if is_resolved else '触发阈值告警'}"
    )
    primary_time_label = "恢复时间" if is_resolved else "触发时间"

    return {
        "msg_type": "interactive",
        "card": {
            "config": {"wide_screen_mode": True, "enable_forward": True},
            "header": {
                "template": header_template,
                "title": {"tag": "plain_text", "content": header_title},
            },
            "elements": [
                {
                    "tag": "div",
                    "text": {
                        "tag": "lark_md",
                        "content": summary,
                    },
                },
                {
                    "tag": "div",
                    "fields": [
                        {
                            "is_short": True,
                            "text": {"tag": "lark_md", "content": f"**状态**\n{status_label}"},
                        },
                        {
                            "is_short": True,
                            "text": {"tag": "lark_md", "content": f"**{primary_time_label}**\n{payload.get('timestamp', '-')}"},
                        },
                        {
                            "is_short": True,
                            "text": {"tag": "lark_md", "content": f"**模型渠道**\n{payload.get('channelName', '-')}"},
                        },
                        {
                            "is_short": True,
                            "text": {"tag": "lark_md", "content": f"**拨测任务**\n{payload.get('taskName', '-')}"},
                        },
                        {
                            "is_short": True,
                            "text": {"tag": "lark_md", "content": f"**告警指标**\n{payload.get('metricName', '-')}"},
                        },
                        {
                            "is_short": True,
                            "text": {"tag": "lark_md", "content": f"**通知通道**\n{payload.get('alertChannelName', '-')}"},
                        },
                    ],
                },
                *(
                    [
                        {
                            "tag": "div",
                            "fields": [
                                {
                                    "is_short": True,
                                    "text": {"tag": "lark_md", "content": f"**告警开始**\n{payload.get('openedAt', '-')}"},
                                },
                                {
                                    "is_short": True,
                                    "text": {"tag": "lark_md", "content": f"**恢复耗时**\n{payload.get('recoveryDuration', '-')}"},
                                },
                            ],
                        }
                    ]
                    if is_resolved
                    else []
                ),
                {"tag": "hr"},
                {
                    "tag": "div",
                    "fields": [
                        {
                            "is_short": True,
                            "text": {"tag": "lark_md", "content": f"**当前值**\n{payload.get('metricValue', '-')}"},
                        },
                        {
                            "is_short": True,
                            "text": {"tag": "lark_md", "content": f"**阈值**\n{payload.get('thresholdValue', '-')}"},
                        },
                    ],
                },
                {
                    "tag": "note",
                    "elements": [
                        {
                            "tag": "plain_text",
                            "content": "该消息由 LLM-Guardian 自动发送，请结合平台日志与时序图进一步排查。",
                        }
                    ],
                },
            ],
        },
    }


def _format_card_time(value: datetime | None) -> str:
    if value is None:
        return "-"
    return as_beijing_time(value).strftime("%Y-%m-%d %H:%M:%S")


def _format_recovery_duration(opened_at: datetime | None, resolved_at: datetime | None) -> str | None:
    if opened_at is None or resolved_at is None:
        return None
    total_seconds = max(int((resolved_at - opened_at).total_seconds()), 0)
    hours, remainder = divmod(total_seconds, 3600)
    minutes, seconds = divmod(remainder, 60)
    parts: list[str] = []
    if hours:
        parts.append(f"{hours}小时")
    if minutes:
        parts.append(f"{minutes}分")
    if seconds or not parts:
        parts.append(f"{seconds}秒")
    return "".join(parts)


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
