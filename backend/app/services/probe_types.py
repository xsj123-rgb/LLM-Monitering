from __future__ import annotations

from dataclasses import dataclass, field


@dataclass
class ProbeExecutionResult:
    request_payload: dict
    response_text: str = ""
    response_excerpt: str | None = None
    dns_time_ms: float = 0.0
    tcp_time_ms: float = 0.0
    ttft_ms: int = 0
    total_latency_ms: int = 0
    tokens_count: int = 0
    tps: float = 0.0
    status_code: int = 0
    success: bool = False
    error_msg: str | None = None
    token_count_source: str = "estimated"
    error_type: str | None = None
    raw_metadata: dict = field(default_factory=dict)
