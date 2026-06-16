from __future__ import annotations

import json
import time
from typing import Any

import aiohttp

from app.adapters.base import ProbeAdapter
from app.core.security import decrypt_value
from app.models.monitoring import ModelChannel
from app.services.provider_endpoints import normalize_openai_chat_endpoint
from app.services.probe_types import ProbeExecutionResult


class OpenAICompatibleProbeAdapter(ProbeAdapter):
    async def execute(self, channel: ModelChannel, prompt: str) -> ProbeExecutionResult:
        request_payload = {
            "model": channel.model_identifier,
            "messages": [{"role": "user", "content": prompt}],
            "temperature": 0.1,
            "max_tokens": 256,
            "stream": True,
            "stream_options": {"include_usage": True},
        }
        start_time = time.perf_counter()
        trace_times: dict[str, float] = {}
        usage_tokens: int | None = None
        accumulated_text = ""
        ttft_ms = 0

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

        headers = {"Accept": "text/event-stream", "Content-Type": "application/json"}
        api_key = decrypt_value(channel.api_key_encrypted)
        if api_key:
            headers["Authorization"] = f"Bearer {api_key}"
        target_endpoint = normalize_openai_chat_endpoint(channel.api_endpoint)

        try:
            timeout = aiohttp.ClientTimeout(total=90)
            connector = aiohttp.TCPConnector(force_close=True, ttl_dns_cache=0)
            async with aiohttp.ClientSession(timeout=timeout, connector=connector, trace_configs=[trace]) as client:
                async with client.post(target_endpoint, headers=headers, json=request_payload) as resp:
                    if resp.status >= 400:
                        error_body = (await resp.text())[:2048]
                        return ProbeExecutionResult(
                            request_payload=request_payload,
                            status_code=resp.status,
                            total_latency_ms=int((time.perf_counter() - start_time) * 1000),
                            error_msg=error_body or f"HTTP {resp.status}",
                            error_type="http_error",
                        )

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
                            choices = data.get("choices")
                            first_choice = choices[0] if isinstance(choices, list) and choices else {}
                            delta = first_choice.get("delta", {}).get("content") if isinstance(first_choice, dict) else None
                            if delta:
                                accumulated_text += delta
                                if ttft_ms == 0:
                                    ttft_ms = int((time.perf_counter() - start_time) * 1000)
                            usage = data.get("usage")
                            if usage and usage.get("completion_tokens") is not None:
                                usage_tokens = int(usage["completion_tokens"])
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
                status_code=200,
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
