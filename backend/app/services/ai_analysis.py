from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Literal

import aiohttp
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.core.security import decrypt_value
from app.models.monitoring import AIAnalysisConfig, AuditAdviceSnapshot, ModelChannel, ProbeRun, ProbeTask
from app.services.provider_endpoints import normalize_openai_chat_endpoint


@dataclass
class AdviceGenerationResult:
    channel_id: str
    advice: str
    source: Literal["ai", "template", "disabled", "error"]
    generated_at: datetime | None = None
    analysis_model_name: str | None = None
    analysis_window_start: datetime | None = None
    analysis_window_end: datetime | None = None
    error_message: str | None = None


def get_period_window(period: Literal["daily", "weekly", "monthly"]) -> timedelta:
    return {
        "daily": timedelta(days=1),
        "weekly": timedelta(days=7),
        "monthly": timedelta(days=30),
    }[period]


def ensure_ai_analysis_config(db: Session) -> AIAnalysisConfig:
    config = db.scalar(select(AIAnalysisConfig).order_by(AIAnalysisConfig.created_at.asc()))
    if config:
        return config
    config = AIAnalysisConfig()
    db.add(config)
    db.commit()
    db.refresh(config)
    return config


def _get_itl(log: ProbeRun) -> float:
    if not log.success:
        return 0.0
    decode_time = max(0, log.total_latency_ms - log.ttft_ms)
    decode_tokens = max(1, log.tokens_count - 1)
    return round(decode_time / decode_tokens, 2)


def build_channel_summary(channel: ModelChannel, task: ProbeTask | None, logs: list[ProbeRun], period: str) -> dict:
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
    analysis_window_start = min((log.timestamp for log in logs), default=None)
    analysis_window_end = max((log.timestamp for log in logs), default=None)
    return {
        "period": period,
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
            "analysisWindowStart": analysis_window_start.isoformat() if analysis_window_start else None,
            "analysisWindowEnd": analysis_window_end.isoformat() if analysis_window_end else None,
        },
    }


def _build_prompt(summary: dict, config: AIAnalysisConfig) -> str:
    return (
        "你是大模型推理平台 SRE 与性能诊断专家。"
        "请结合 SLA 指标和部署信息，输出中文诊断建议。"
        "格式要求：先一句性能总结；再一句瓶颈判断；最后一句部署优化建议。"
        "必须基于提供的数据，不要编造不存在的集群、显卡、框架或拓扑。"
        "如果部署信息不足，可以明确指出信息不足。"
        "控制在120字以内，不要使用 markdown。"
        f"\n输入数据：{json.dumps(summary, ensure_ascii=False)}"
        f"\n分析模型：{config.model_identifier}"
    )


def _period_text(period: Literal["daily", "weekly", "monthly"]) -> str:
    return {
        "daily": "日报周期（最近 24 小时）",
        "weekly": "周报周期（最近 7 天）",
        "monthly": "月报周期（最近 30 天）",
    }[period]


def _build_default_rule_template(summary: dict) -> str:
    metrics = summary["metrics"]
    return (
        f"规则模板摘要：{_period_text(summary['period'])}内共完成 {metrics['totalDials']} 次拨测，"
        f"成功率 {metrics['successRate']}%，SLA 达标率 {metrics['complianceRate']}%。"
        f"吞吐率均值 {metrics['avgTps']} Tok/s，首字延迟均值 {metrics['avgTtft']} ms，"
        f"字间延迟均值 {metrics['avgItl']} ms/字，平均总时延 {metrics['avgTotalLatency']} ms，"
        f"峰值首字延迟 {metrics['peakTtft']} ms。"
    )


async def _call_openai_like(config: AIAnalysisConfig, prompt: str) -> str:
    headers = {"Content-Type": "application/json"}
    api_key = decrypt_value(config.api_key_encrypted)
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"
    payload = {
        "model": config.model_identifier,
        "messages": [
            {"role": "system", "content": "你是大模型基础设施性能诊断助手。"},
            {"role": "user", "content": prompt},
        ],
        "temperature": 0.2,
        "max_tokens": 220,
        "stream": False,
    }
    timeout = aiohttp.ClientTimeout(total=60)
    target_endpoint = normalize_openai_chat_endpoint(config.api_endpoint)
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


async def generate_single_advice(
    db: Session,
    config: AIAnalysisConfig,
    channel: ModelChannel,
    period: Literal["daily", "weekly", "monthly"],
) -> AdviceGenerationResult:
    if not config.enabled:
        return AdviceGenerationResult(channel_id=channel.id, advice="当前未启用 AI 建议", source="disabled")

    since = datetime.utcnow() - get_period_window(period)
    logs = list(
        db.scalars(
            select(ProbeRun).where(ProbeRun.timestamp >= since, ProbeRun.channel_id == channel.id).order_by(ProbeRun.timestamp.desc())
        )
    )
    task = db.scalar(select(ProbeTask).where(ProbeTask.channel_id == channel.id))
    if not logs:
        return AdviceGenerationResult(channel_id=channel.id, advice="当前周期暂无足够拨测数据，暂无法生成 AI 建议", source="disabled")

    summary = build_channel_summary(channel, task, logs, period)
    analysis_window_start = datetime.fromisoformat(summary["metrics"]["analysisWindowStart"]) if summary["metrics"]["analysisWindowStart"] else None
    analysis_window_end = datetime.fromisoformat(summary["metrics"]["analysisWindowEnd"]) if summary["metrics"]["analysisWindowEnd"] else None
    prompt = _build_prompt(summary, config)
    try:
        advice = await _call_openai_like(config, prompt)
        return AdviceGenerationResult(
            channel_id=channel.id,
            advice=advice,
            source="ai",
            generated_at=datetime.utcnow(),
            analysis_model_name=config.model_identifier,
            analysis_window_start=analysis_window_start,
            analysis_window_end=analysis_window_end,
        )
    except Exception as exc:  # noqa: BLE001
        fallback_summary = _build_default_rule_template(summary)
        return AdviceGenerationResult(
            channel_id=channel.id,
            advice=fallback_summary,
            source="template",
            generated_at=datetime.utcnow(),
            analysis_model_name=None,
            analysis_window_start=analysis_window_start,
            analysis_window_end=analysis_window_end,
            error_message=str(exc),
        )


async def refresh_audit_advices(
    db: Session,
    config: AIAnalysisConfig,
    period: Literal["daily", "weekly", "monthly"],
) -> list[AdviceGenerationResult]:
    config.last_run_at = datetime.utcnow()
    config.status = "running"
    config.last_error = None
    db.commit()

    channels = list(db.scalars(select(ModelChannel).order_by(ModelChannel.created_at.desc())))
    results: list[AdviceGenerationResult] = []
    for channel in channels:
        result = await generate_single_advice(db, config, channel, period)
        results.append(result)

        existing = db.scalar(
            select(AuditAdviceSnapshot).where(
                AuditAdviceSnapshot.channel_id == channel.id,
                AuditAdviceSnapshot.period == period,
            )
        )
        if existing is None:
            existing = AuditAdviceSnapshot(channel_id=channel.id, period=period)
            db.add(existing)
        existing.advice = result.advice
        existing.source = result.source
        existing.generated_at = result.generated_at or datetime.utcnow()
        existing.analysis_model_name = result.analysis_model_name
        existing.analysis_window_start = result.analysis_window_start
        existing.analysis_window_end = result.analysis_window_end
        if result.source in {"error", "template"}:
            existing.error_message = result.error_message
        else:
            existing.error_message = None
        if result.source == "ai":
            config.last_success_at = result.generated_at

    has_ai = any(item.source == "ai" for item in results)
    has_fallback_or_error = any(item.source in {"template", "error"} for item in results)
    config.status = "error" if has_fallback_or_error else ("healthy" if has_ai else "idle")
    if has_fallback_or_error:
        config.last_error = next((item.error_message for item in results if item.error_message), "AI 诊断入口不可用")
    db.commit()
    return results


def read_audit_advices(db: Session, period: Literal["daily", "weekly", "monthly"]) -> list[AuditAdviceSnapshot]:
    return list(
        db.scalars(
            select(AuditAdviceSnapshot)
            .where(AuditAdviceSnapshot.period == period)
            .order_by(AuditAdviceSnapshot.generated_at.desc())
        )
    )


async def test_ai_analysis_endpoint(config: AIAnalysisConfig) -> str:
    if not config.enabled:
        return "AI 分析入口未启用"
    response = await _call_openai_like(
        config,
        "请用一句中文输出：连通性测试通过。",
    )
    return response


def get_audit_advice_snapshot_map(
    db: Session,
    period: Literal["daily", "weekly", "monthly"],
) -> dict[str, AuditAdviceSnapshot]:
    return {
        snapshot.channel_id: snapshot
        for snapshot in read_audit_advices(db, period)
    }
