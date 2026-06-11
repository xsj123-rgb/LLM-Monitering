from __future__ import annotations

import json
import time

import aiohttp

from app.adapters.base import ProbeAdapter
from app.core.security import decrypt_value
from app.models.monitoring import ModelChannel
from app.services.probe_types import ProbeExecutionResult


class OllamaProbeAdapter(ProbeAdapter):
    async def execute(self, channel: ModelChannel, prompt: str) -> ProbeExecutionResult:
        request_payload = {
            "model": channel.model_identifier,
            "messages": [{"role": "user", "content": prompt}],
            "stream": True,
            "options": {"temperature": 0.1},
        }
        start_time = time.perf_counter()
        accumulated_text = ""
        ttft_ms = 0
        eval_count: int | None = None
        eval_duration_ns: int | None = None
        headers = {"Content-Type": "application/json"}
        api_key = decrypt_value(channel.api_key_encrypted)
        if api_key:
            headers["Authorization"] = f"Bearer {api_key}"

        try:
            timeout = aiohttp.ClientTimeout(total=90)
            connector = aiohttp.TCPConnector(force_close=True, ttl_dns_cache=0)
            async with aiohttp.ClientSession(timeout=timeout, connector=connector) as client:
                async with client.post(channel.api_endpoint, headers=headers, json=request_payload) as resp:
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
                        for line in raw_chunk.decode("utf-8", errors="ignore").splitlines():
                            if not line.strip():
                                continue
                            try:
                                data = json.loads(line)
                            except json.JSONDecodeError:
                                continue
                            content = data.get("message", {}).get("content") or ""
                            if content:
                                accumulated_text += content
                                if ttft_ms == 0:
                                    ttft_ms = int((time.perf_counter() - start_time) * 1000)
                            if data.get("done"):
                                eval_count = data.get("eval_count")
                                eval_duration_ns = data.get("eval_duration")
            total_latency_ms = int((time.perf_counter() - start_time) * 1000)
            if eval_count is not None and eval_duration_ns:
                decode_seconds = max(eval_duration_ns / 1_000_000_000, 0.001)
                tokens_count = int(eval_count)
                tps = round(tokens_count / decode_seconds, 2)
                token_source = "provider"
            else:
                tokens_count = max(1, len(accumulated_text.strip()) // 4) if accumulated_text.strip() else 0
                decode_seconds = max((total_latency_ms - ttft_ms) / 1000, 0.001)
                tps = round(tokens_count / decode_seconds, 2) if tokens_count else 0.0
                token_source = "estimated"

            return ProbeExecutionResult(
                request_payload=request_payload,
                response_text=accumulated_text[:2048],
                response_excerpt=accumulated_text[:512] or None,
                dns_time_ms=0.0,
                tcp_time_ms=0.0,
                ttft_ms=ttft_ms,
                total_latency_ms=total_latency_ms,
                tokens_count=tokens_count,
                tps=tps,
                status_code=200,
                success=True,
                token_count_source=token_source,
            )
        except Exception as exc:
            return ProbeExecutionResult(
                request_payload=request_payload,
                total_latency_ms=int((time.perf_counter() - start_time) * 1000),
                error_msg=str(exc),
                error_type=exc.__class__.__name__,
            )
