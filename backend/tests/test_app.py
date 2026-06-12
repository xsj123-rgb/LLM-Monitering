from __future__ import annotations

import os
from pathlib import Path

os.environ["DATABASE_URL"] = "sqlite:///./backend/tests/test.db"
os.environ["LG_ADMIN_USERNAME"] = "admin"
os.environ["LG_ADMIN_PASSWORD"] = "admin12345"
os.environ["ENCRYPTION_SECRET"] = "test-secret"

db_path = Path("backend/tests/test.db")
if db_path.exists():
    db_path.unlink()

from fastapi.testclient import TestClient
from sqlalchemy import delete, select

from app.main import app
from app.config import get_settings
from app.core.rate_limit import login_rate_limiter
from app.core.security import hash_password
from app.db.base import Base
from app.db.session import SessionLocal, engine
from app.models.alert import AlertEndpoint, AlertIncident
from app.models.auth import User, UserSession
from app.models.monitoring import ModelChannel, ProbeRun, ProbeTask
from app.services.bootstrap import bootstrap_admin_user
from app.services.probe_types import ProbeExecutionResult


class FakeAdapter:
    def __init__(self, *, ttft_ms: int = 120, total_latency_ms: int = 900, tps: float = 52.0):
        self.ttft_ms = ttft_ms
        self.total_latency_ms = total_latency_ms
        self.tps = tps

    async def execute(self, channel, prompt):  # noqa: ANN001
        return ProbeExecutionResult(
            request_payload={
                "model": channel.model_identifier,
                "messages": [{"role": "user", "content": prompt}],
                "stream": True,
            },
            response_text="monitoring-ok",
            response_excerpt="monitoring-ok",
            dns_time_ms=4.0,
            tcp_time_ms=9.0,
            ttft_ms=self.ttft_ms,
            total_latency_ms=self.total_latency_ms,
            tokens_count=48,
            tps=self.tps,
            status_code=200,
            success=True,
            token_count_source="provider",
        )


client = TestClient(app)

Base.metadata.create_all(bind=engine)
with SessionLocal() as bootstrap_db:
    bootstrap_admin_user(bootstrap_db, get_settings())


def setup_function() -> None:
    client.cookies.clear()
    login_rate_limiter.reset()
    with SessionLocal() as db:
        db.execute(delete(ProbeRun))
        db.execute(delete(AlertIncident))
        db.execute(delete(ProbeTask))
        db.execute(delete(ModelChannel))
        db.execute(delete(AlertEndpoint))
        db.execute(delete(UserSession))
        admin = db.scalar(select(User).where(User.username == "admin"))
        if admin:
            admin.password_hash = hash_password("admin12345")
        db.commit()


def login(password: str = "admin12345"):
    response = client.post("/api/auth/login", json={"username": "admin", "password": password})
    assert response.status_code == 200
    return response


def test_auth_flow_and_protected_routes() -> None:
    unauthenticated = client.get("/api/auth/me")
    assert unauthenticated.status_code == 200
    assert unauthenticated.json()["authenticated"] is False

    protected = client.get("/api/channels")
    assert protected.status_code == 401

    bad_login = client.post("/api/auth/login", json={"username": "admin", "password": "wrong-password"})
    assert bad_login.status_code == 401

    auth = login()
    assert auth.json()["authenticated"] is True
    assert "lg_session" in auth.headers.get("set-cookie", "")

    channels = client.get("/api/channels")
    assert channels.status_code == 200
    assert channels.json() == []


def test_change_password_invalidates_existing_session() -> None:
    login()
    change = client.post(
        "/api/auth/change-password",
        json={"current_password": "admin12345", "new_password": "new-password-123"},
    )
    assert change.status_code == 200

    protected = client.get("/api/channels")
    assert protected.status_code == 401

    old_login = client.post("/api/auth/login", json={"username": "admin", "password": "admin12345"})
    assert old_login.status_code == 401

    new_login = client.post("/api/auth/login", json={"username": "admin", "password": "new-password-123"})
    assert new_login.status_code == 200

    reset = client.post(
        "/api/auth/change-password",
        json={"current_password": "new-password-123", "new_password": "admin12345"},
    )
    assert reset.status_code == 200


def test_manual_probe_writes_log_and_creates_incident(monkeypatch) -> None:
    import app.services.probe as probe_service

    monkeypatch.setattr(probe_service, "get_adapter", lambda channel_type: FakeAdapter(ttft_ms=950, total_latency_ms=1800, tps=12.0))

    login()

    channel = client.post(
        "/api/channels",
        json={
            "name": "Test OpenAI Channel",
            "apiEndpoint": "http://localhost:8000/v1/chat/completions",
            "apiKey": "sk-test",
            "modelIdentifier": "test-model",
            "type": "openai",
            "status": "active",
            "tags": ["test"],
            "description": "test",
        },
    ).json()

    task = client.post(
        "/api/tasks",
        json={
            "name": "Latency Guard",
            "channelId": channel["id"],
            "prompt": "ping",
            "intervalMinutes": 5,
            "concurrency": 1,
            "status": "running",
            "thresholds": {
                "maxTtftMs": 300,
                "minTps": 25,
                "maxTotalLatencyMs": 1200,
                "minSuccessRate": 0.95,
            },
            "alertChannels": [],
        },
    ).json()

    manual_probe = client.post(f"/api/tasks/{task['id']}/probe")
    assert manual_probe.status_code == 200
    assert manual_probe.json()["timestamp"].endswith("+08:00")
    assert manual_probe.json()["violatedTtft"] is True
    assert manual_probe.json()["violatedTps"] is True
    assert manual_probe.json()["violatedExtLatency"] is True

    logs = client.get("/api/logs")
    assert logs.status_code == 200
    assert len(logs.json()) == 1

    notifications = client.get("/api/notifications")
    assert notifications.status_code == 200
    payload = notifications.json()
    assert len(payload) == 3
    assert all(item["timestamp"].endswith("+08:00") for item in payload)
    assert {item["metricName"] for item in payload} == {
        "首字延迟 (TTFT)",
        "吞吐速率 (TPS)",
        "端到端总时间 (Latency)",
    }

    resolved = client.patch(f"/api/notifications/{payload[0]['id']}")
    assert resolved.status_code == 200
    assert resolved.json()["status"] == "resolved"
