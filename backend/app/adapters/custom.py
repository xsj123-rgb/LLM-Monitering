from __future__ import annotations

import json
import time
from typing import Any

import aiohttp

from app.adapters.base import ProbeAdapter
from app.core.security import decrypt_value
from app.models.monitoring import ModelChannel
from app.services.probe_types import ProbeExecutionResult


class CustomProbeAdapter(ProbeAdapter):
    async def execute(self, channel: ModelChannel, prompt: str) -> ProbeExecutionResult:
        request_payload = {
            "model": channel.model_identifier,
            "system_prompt": "You answer only in rhymes.",
            "input": prompt,
        }
        start_time = time.perf_counter()
        trace_times: dict[str, float] = {}
        accumulated_text = ""
        status_code = 0
        ttft_ms = 0
        usage_tokens: int | None = None

        trace = aiohttp.TraceConfig()

        async def on_dns_start(*_: Any) -> None:
            trace_times["dns_start"] = time.perf_counter()

        async def on_dns_end(*_: Any) -> None:
            trace_times["dns_end"] = time.perf_counter()

        async def on_connection_create_start(*_: Any) -> None:
            trace_times["tcp_start"] = time.perf_counter()

        async def on_connection_create_end(*_: Any) -> None:
            trace_times["tcp_end"] = time.perf_counter()

        trace.on_dns_resolvehost_start.append(on_dns_start)
        trace.on_dns_resolvehost_end.append(on_dns_end)
        trace.on_connection_create_start.append(on_connection_create_start)
        trace.on_connection_create_end.append(on_connection_create_end)

        headers = {"Content-Type": "application/json"}
        api_key = decrypt_value(channel.api_key_encrypted)
        if api_key:
            headers["Authorization"] = f"Bearer {api_key}"

        try:
            timeout = aiohttp.ClientTimeout(total=90)
            connector = aiohttp.TCPConnector(force_close=True, ttl_dns_cache=0)
            async with aiohttp.ClientSession(timeout=timeout, connector=connector, trace_configs=[trace]) as client:
                async with client.post(channel.api_endpoint, headers=headers, json=request_payload) as resp:
                    status_code = resp.status
                    if resp.status >= 400:
                        error_body = (await resp.text())[:2048]
                        return ProbeExecutionResult(
                            request_payload=request_payload,
                            status_code=resp.status,
                            total_latency_ms=int((time.perf_counter() - start_time) * 1000),
                            error_msg=error_body or f"HTTP {resp.status}",
                            error_type="http_error",
                        )

                    content_type = resp.headers.get("Content-Type", "")
                    if "text/event-stream" in content_type:
                        async for raw_chunk in resp.content:
                            chunk = raw_chunk.decode("utf-8", errors="ignore")
                            for line in chunk.splitlines():
                                if not line.startswith("data:"):
                                    continue
                                payload = line[5:].strip()
                                if payload == "[DONE]":
                                    continue
                                try:
                                    data = json.loads(payload)
                                except json.JSONDecodeError:
                                    continue
                                text, usage = extract_text_and_usage(data)
                                if text:
                                    accumulated_text += text
                                    if ttft_ms == 0:
                                        ttft_ms = int((time.perf_counter() - start_time) * 1000)
                                if usage is not None:
                                    usage_tokens = usage
                    else:
                        body_text = await resp.text()
                        data = try_parse_json(body_text)
                        if isinstance(data, dict):
                            text, usage = extract_text_and_usage(data)
                            accumulated_text = text or body_text
                            usage_tokens = usage
                        else:
                            accumulated_text = body_text

            total_latency_ms = int((time.perf_counter() - start_time) * 1000)
            response_excerpt = accumulated_text[:512] or None
            response_text = accumulated_text[:2048]
            tokens_count = usage_tokens if usage_tokens is not None else estimate_tokens(response_text)
            decode_seconds = max((total_latency_ms - ttft_ms) / 1000, 0.001)
            tps = round(tokens_count / decode_seconds, 2) if tokens_count else 0.0
            return ProbeExecutionResult(
                request_payload=request_payload,
                response_text=response_text,
                response_excerpt=response_excerpt,
                dns_time_ms=elapsed_ms(trace_times, "dns_start", "dns_end"),
                tcp_time_ms=elapsed_ms(trace_times, "tcp_start", "tcp_end"),
                ttft_ms=ttft_ms,
                total_latency_ms=total_latency_ms,
                tokens_count=tokens_count,
                tps=tps,
                status_code=status_code or 200,
                success=True,
                token_count_source="provider" if usage_tokens is not None else "estimated",
            )
        except Exception as exc:
            return ProbeExecutionResult(
                request_payload=request_payload,
                total_latency_ms=int((time.perf_counter() - start_time) * 1000),
                error_msg=str(exc),
                error_type=exc.__class__.__name__,
            )


def try_parse_json(value: str) -> Any:
    try:
        return json.loads(value)
    except json.JSONDecodeError:
        return None


def extract_text_and_usage(data: dict[str, Any]) -> tuple[str, int | None]:
    choices = data.get("choices")
    if isinstance(choices, list) and choices:
        first = choices[0] or {}
        delta = first.get("delta", {}) if isinstance(first, dict) else {}
        message = first.get("message", {}) if isinstance(first, dict) else {}
        text = (
            delta.get("content")
            if isinstance(delta, dict)
            else None
        ) or (
            message.get("content")
            if isinstance(message, dict)
            else None
        ) or ""
        usage = data.get("usage")
        completion_tokens = usage.get("completion_tokens") if isinstance(usage, dict) else None
        return text, int(completion_tokens) if completion_tokens is not None else None

    for key in ("response", "output", "content", "text", "answer", "result"):
        value = data.get(key)
        if isinstance(value, str) and value:
            return value, None

    message = data.get("message")
    if isinstance(message, dict):
        content = message.get("content")
        if isinstance(content, str) and content:
            return content, None

    if isinstance(data.get("data"), str):
        return data["data"], None

    return "", None


def elapsed_ms(trace_times: dict[str, float], start_key: str, end_key: str) -> float:
    if start_key not in trace_times or end_key not in trace_times:
        return 0.0
    return round((trace_times[end_key] - trace_times[start_key]) * 1000, 2)


def estimate_tokens(text: str) -> int:
    stripped = text.strip()
    if not stripped:
        return 0
    whitespace_count = len(stripped.split())
    char_based = max(1, len(stripped) // 4)
    return max(whitespace_count, char_based)
