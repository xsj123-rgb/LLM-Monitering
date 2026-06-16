from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Literal

import aiohttp
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.security import decrypt_value
from app.models.monitoring import ModelChannel, ProbeRun, ProbeTask
from app.services.provider_endpoints import normalize_openai_chat_endpoint


@dataclass
class AdviceChannelResult:
    channel_id: str
    advice: str
    source: Literal["ai", "disabled", "error"]


def _get_period_delta(period: Literal["daily", "weekly", "monthly"]) -> timedelta:
    return {
        "daily": timedelta(days=1),
        "weekly": timedelta(days=7),
        "monthly": timedelta(days=30),
    }[period]


def _get_itl(log: ProbeRun) -> float:
    if not log.success:
        return 0.0
    decode_time = max(0, log.total_latency_ms - log.ttft_ms)
    decode_tokens = max(1, log.tokens_count - 1)
    return round(decode_time / decode_tokens, 2)


def _build_channel_summary(channel: ModelChannel, task: ProbeTask | None, logs: list[ProbeRun]) -> dict:
    total = len(logs)
    success_logs = [log for log in logs if log.success]
    compliant_logs = [
        log
        for log in logs
        if log.success and not log.violated_ttft and not log.violated_tps and not log.violated_ext_latency
    ]
    avg_tps = round(sum(log.tps for log in success_logs) / len(success_logs), 2) if success_logs else 0.0
    avg_ttft = round(sum(log.ttft_ms for log in success_logs) / len(success_logs)) if success_logs else 0
    avg_itl = round(sum(_get_itl(log) for log in success_logs) / len(success_logs), 2) if success_logs else 0.0
    peak_ttft = max((log.ttft_ms for log in success_logs), default=0)
    avg_total_latency = round(sum(log.total_latency_ms for log in success_logs) / len(success_logs)) if success_logs else 0
    success_rate = round((len(success_logs) / total) * 100, 2) if total else 100.0
    compliance_rate = round((len(compliant_logs) / total) * 100, 2) if total else 100.0
    failures = [log.error_msg for log in logs if not log.success and log.error_msg]
    return {
        "channel": {
            "name": channel.name,
            "modelIdentifier": channel.model_identifier,
            "type": channel.type,
            "status": channel.status,
            "description": channel.description or "",
        },
        "deployment": {
            "mode": channel.deployment_mode or "unknown",
            "config": channel.deployment_config or "",
            "env": channel.deployment_env or "",
            "args": channel.deployment_args or "",
        },
        "task": {
            "name": task.name if task else "",
            "intervalMinutes": task.interval_minutes if task else None,
            "concurrency": task.concurrency if task else None,
            "thresholds": {
                "maxTtftMs": task.max_ttft_ms if task else None,
                "minTps": task.min_tps if task else None,
                "maxTotalLatencyMs": task.max_total_latency_ms if task else None,
                "minSuccessRate": task.min_success_rate if task else None,
            },
        },
        "metrics": {
            "totalDials": total,
            "successRate": success_rate,
            "complianceRate": compliance_rate,
            "avgTps": avg_tps,
            "avgTtft": avg_ttft,
            "avgItl": avg_itl,
            "avgTotalLatency": avg_total_latency,
            "peakTtft": peak_ttft,
            "latestFailures": failures[:3],
        },
    }


def _build_prompt(summary: dict, period: Literal["daily", "weekly", "monthly"]) -> str:
    period_label = {"daily": "近24小时", "weekly": "近一周", "monthly": "近一月"}[period]
    return (
        "你是大模型推理平台 SRE 与性能诊断专家。"
        "请结合 SLA 指标和部署信息，输出中文诊断建议。"
        "格式要求：先一句性能总结；再一句瓶颈判断；最后一句部署优化建议。"
        "必须基于提供的数据，不要编造不存在的集群、显卡、框架或拓扑。"
        "如果部署信息不足，可以明确指出信息不足。"
        "控制在120字以内，不要使用 markdown。"
        f"\n分析周期：{period_label}\n"
        f"输入数据：{json.dumps(summary, ensure_ascii=False)}"
    )


async def _generate_openai_like(channel: ModelChannel, prompt: str) -> str:
    headers = {"Content-Type": "application/json"}
    api_key = decrypt_value(channel.api_key_encrypted)
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"
    target_endpoint = normalize_openai_chat_endpoint(channel.api_endpoint)
    payload = {
        "model": channel.model_identifier,
        "messages": [
            {"role": "system", "content": "你是大模型基础设施性能诊断助手。"},
            {"role": "user", "content": prompt},
        ],
        "temperature": 0.2,
        "max_tokens": 220,
        "stream": False,
    }
    timeout = aiohttp.ClientTimeout(total=60)
    async with aiohttp.ClientSession(timeout=timeout) as client:
        async with client.post(target_endpoint, headers=headers, json=payload) as resp:
            body = await resp.text()
            if resp.status >= 400:
                raise RuntimeError(body or f"HTTP {resp.status}")
            data = json.loads(body)
            choices = data.get("choices") or []
            if choices:
                first = choices[0] or {}
                message = first.get("message") or {}
                content = message.get("content")
                if isinstance(content, str) and content.strip():
                    return content.strip()
            raise RuntimeError("AI 模型未返回可用建议内容")


async def _generate_ollama(channel: ModelChannel, prompt: str) -> str:
    headers = {"Content-Type": "application/json"}
    api_key = decrypt_value(channel.api_key_encrypted)
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"
    payload = {
        "model": channel.model_identifier,
        "messages": [{"role": "user", "content": prompt}],
        "stream": False,
        "options": {"temperature": 0.2},
    }
    timeout = aiohttp.ClientTimeout(total=60)
    async with aiohttp.ClientSession(timeout=timeout) as client:
        async with client.post(channel.api_endpoint, headers=headers, json=payload) as resp:
            body = await resp.text()
            if resp.status >= 400:
                raise RuntimeError(body or f"HTTP {resp.status}")
            data = json.loads(body)
            content = (data.get("message") or {}).get("content")
            if isinstance(content, str) and content.strip():
                return content.strip()
            raise RuntimeError("AI 模型未返回可用建议内容")


async def _generate_custom(channel: ModelChannel, prompt: str) -> str:
    headers = {"Content-Type": "application/json"}
    api_key = decrypt_value(channel.api_key_encrypted)
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"
    payload = {
        "model": channel.model_identifier,
        "input": prompt,
    }
    timeout = aiohttp.ClientTimeout(total=60)
    async with aiohttp.ClientSession(timeout=timeout) as client:
        async with client.post(channel.api_endpoint, headers=headers, json=payload) as resp:
            body = await resp.text()
            if resp.status >= 400:
                raise RuntimeError(body or f"HTTP {resp.status}")
            try:
                data = json.loads(body)
            except json.JSONDecodeError:
                text = body.strip()
                if text:
                    return text
                raise RuntimeError("AI 模型未返回可用建议内容")
            for key in ("response", "output", "content", "text", "answer", "result"):
                value = data.get(key)
                if isinstance(value, str) and value.strip():
                    return value.strip()
            message = data.get("message")
            if isinstance(message, dict):
                content = message.get("content")
                if isinstance(content, str) and content.strip():
                    return content.strip()
            raise RuntimeError("AI 模型未返回可用建议内容")


async def _generate_advice_text(channel: ModelChannel, prompt: str) -> str:
    if channel.type == "ollama":
        return await _generate_ollama(channel, prompt)
    if channel.type == "custom":
        return await _generate_custom(channel, prompt)
    return await _generate_openai_like(channel, prompt)


async def generate_audit_advices(
    db: Session,
    period: Literal["daily", "weekly", "monthly"],
) -> list[AdviceChannelResult]:
    since = datetime.utcnow() - _get_period_delta(period)
    channels = list(db.scalars(select(ModelChannel).order_by(ModelChannel.created_at.desc())))
    advice_channel = next((channel for channel in channels if channel.ai_diagnostic_enabled), None)
    if not advice_channel:
        return [
            AdviceChannelResult(channel_id=channel.id, advice="当前未启用 AI 建议", source="disabled")
            for channel in channels
        ]

    tasks = list(db.scalars(select(ProbeTask)))
    all_logs = list(
        db.scalars(
            select(ProbeRun).where(ProbeRun.timestamp >= since).order_by(ProbeRun.timestamp.desc())
        )
    )
    results: list[AdviceChannelResult] = []
    for channel in channels:
        channel_logs = [log for log in all_logs if log.channel_id == channel.id]
        task = next((item for item in tasks if item.channel_id == channel.id), None)
        if not channel_logs:
            results.append(
                AdviceChannelResult(
                    channel_id=channel.id,
                    advice="当前周期暂无足够拨测数据，暂无法生成 AI 建议",
                    source="disabled",
                )
            )
            continue
        summary = _build_channel_summary(channel, task, channel_logs)
        prompt = _build_prompt(summary, period)
        try:
            advice = await _generate_advice_text(advice_channel, prompt)
            results.append(AdviceChannelResult(channel_id=channel.id, advice=advice, source="ai"))
        except Exception as exc:
            results.append(
                AdviceChannelResult(
                    channel_id=channel.id,
                    advice=f"AI 建议生成失败：{exc}",
                    source="error",
                )
            )
    return results
