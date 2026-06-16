from __future__ import annotations

import asyncio
import os
from pathlib import Path

import pytest

os.environ["DATABASE_URL"] = "sqlite:///./backend/tests/test.db"
os.environ["LG_ADMIN_USERNAME"] = "admin"
os.environ["LG_ADMIN_PASSWORD"] = "admin12345"
os.environ["ENCRYPTION_SECRET"] = "test-secret"

db_path = Path("backend/tests/test.db")
if db_path.exists():
    db_path.unlink()

from fastapi.testclient import TestClient
from sqlalchemy import delete, select

import app.state as app_state
from app.main import app
from app.config import get_settings
from app.core.rate_limit import login_rate_limiter
from app.core.security import encrypt_value, hash_password
from app.db.base import Base
from app.db.session import SessionLocal, engine
from app.models.alert import AlertEndpoint, AlertIncident
from app.models.auth import User, UserSession
from app.models.monitoring import ModelChannel, ProbeRun, ProbeTask
from app.services.bootstrap import bootstrap_admin_user
from app.services import model_discovery as model_discovery_service
from app.services.provider_endpoints import normalize_openai_chat_endpoint
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


def test_admin_user_management_does_not_expose_plaintext_passwords() -> None:
    login()

    created = client.post(
        "/api/auth/users",
        json={
            "username": "viewer",
            "password": "viewer-pass-123",
            "role": "user",
            "is_active": True,
        },
    )
    assert created.status_code == 200
    created_payload = created.json()
    assert "password" not in created_payload

    users = client.get("/api/auth/users")
    assert users.status_code == 200
    users_payload = users.json()
    assert all("password" not in item for item in users_payload)

    reset = client.post(
        f"/api/auth/users/{created_payload['id']}/reset-password",
        json={"new_password": "viewer-pass-456"},
    )
    assert reset.status_code == 200
    assert "password" not in reset.json()

    relogin = client.post("/api/auth/login", json={"username": "viewer", "password": "viewer-pass-456"})
    assert relogin.status_code == 200


def test_admin_can_delete_managed_user_but_not_self() -> None:
    login()

    created = client.post(
        "/api/auth/users",
        json={
            "username": "temp-user",
            "password": "temp-pass-123",
            "role": "user",
            "is_active": True,
        },
    )
    assert created.status_code == 200
    created_payload = created.json()

    deleted = client.delete(f"/api/auth/users/{created_payload['id']}")
    assert deleted.status_code == 200
    assert deleted.json() == {"ok": True}

    users = client.get("/api/auth/users")
    assert users.status_code == 200
    assert all(item["id"] != created_payload["id"] for item in users.json())

    relogin = client.post("/api/auth/login", json={"username": "temp-user", "password": "temp-pass-123"})
    assert relogin.status_code == 401

    with SessionLocal() as db:
        admin = db.scalar(select(User).where(User.username == "admin"))
        assert admin is not None
        self_delete = client.delete(f"/api/auth/users/{admin.id}")
    assert self_delete.status_code == 400


def test_discover_models_for_openai_compatible_endpoint(monkeypatch) -> None:
    async def fake_fetch_models(channel_type: str, api_endpoint: str, api_key: str = "") -> tuple[list[str], str]:
        assert channel_type == "openai"
        assert api_endpoint == "http://example.com/v1/chat/completions"
        assert api_key == "sk-test"
        return ["deepseek-chat", "qwen3-32b"], "http://example.com/v1/models"

    monkeypatch.setattr(model_discovery_service, "fetch_models", fake_fetch_models)
    monkeypatch.setattr("app.api.monitoring.fetch_models", fake_fetch_models)

    login()

    response = client.post(
        "/api/channels/discover-models",
        json={
            "apiEndpoint": "http://example.com/v1/chat/completions",
            "apiKey": "sk-test",
            "type": "openai",
        },
    )
    assert response.status_code == 200
    assert response.json() == {
        "models": ["deepseek-chat", "qwen3-32b"],
        "sourceUrl": "http://example.com/v1/models",
    }


def test_discover_models_for_openai_base_v1_endpoint(monkeypatch) -> None:
    async def fake_fetch_models(channel_type: str, api_endpoint: str, api_key: str = "") -> tuple[list[str], str]:
        assert channel_type == "openai"
        assert api_endpoint == "https://api.siliconflow.cn/v1"
        assert api_key == "sk-test"
        return ["Qwen/Qwen3-32B", "deepseek-ai/DeepSeek-V3"], "https://api.siliconflow.cn/v1/models"

    monkeypatch.setattr(model_discovery_service, "fetch_models", fake_fetch_models)
    monkeypatch.setattr("app.api.monitoring.fetch_models", fake_fetch_models)

    login()

    response = client.post(
        "/api/channels/discover-models",
        json={
            "apiEndpoint": "https://api.siliconflow.cn/v1",
            "apiKey": "sk-test",
            "type": "openai",
        },
    )
    assert response.status_code == 200
    assert response.json()["sourceUrl"] == "https://api.siliconflow.cn/v1/models"


def test_discover_models_for_ollama_endpoint(monkeypatch) -> None:
    async def fake_fetch_models(channel_type: str, api_endpoint: str, api_key: str = "") -> tuple[list[str], str]:
        assert channel_type == "ollama"
        assert api_endpoint == "http://localhost:11434/api/chat"
        assert api_key == ""
        return ["llama3.1:8b", "qwen2.5:14b"], "http://localhost:11434/api/tags"

    monkeypatch.setattr(model_discovery_service, "fetch_models", fake_fetch_models)
    monkeypatch.setattr("app.api.monitoring.fetch_models", fake_fetch_models)

    login()

    response = client.post(
        "/api/channels/discover-models",
        json={
            "apiEndpoint": "http://localhost:11434/api/chat",
            "apiKey": "",
            "type": "ollama",
        },
    )
    assert response.status_code == 200
    assert response.json()["models"] == ["llama3.1:8b", "qwen2.5:14b"]
    assert response.json()["sourceUrl"] == "http://localhost:11434/api/tags"


def test_normalize_openai_chat_endpoint_supports_base_and_models_paths() -> None:
    assert (
        normalize_openai_chat_endpoint("https://api.siliconflow.cn/v1")
        == "https://api.siliconflow.cn/v1/chat/completions"
    )
    assert (
        normalize_openai_chat_endpoint("https://api.siliconflow.cn/v1/")
        == "https://api.siliconflow.cn/v1/chat/completions"
    )
    assert (
        normalize_openai_chat_endpoint("https://api.siliconflow.cn/v1/models")
        == "https://api.siliconflow.cn/v1/chat/completions"
    )
    assert (
        normalize_openai_chat_endpoint("https://api.siliconflow.cn/v1/chat/completions")
        == "https://api.siliconflow.cn/v1/chat/completions"
    )


def test_openai_probe_adapter_normalizes_base_v1_endpoint(monkeypatch: pytest.MonkeyPatch) -> None:
    from app.adapters.openai import OpenAICompatibleProbeAdapter

    captured: dict[str, object] = {}

    class FakeResponse:
        status = 200
        headers = {"Content-Type": "text/event-stream"}

        def __init__(self) -> None:
            self.content = self
            self._chunks = iter(
                [
                    b'data: {"choices":[{"delta":{"content":"ok"}}]}\n\n',
                    b'data: {"usage":{"completion_tokens":2}}\n\n',
                    b"data: [DONE]\n\n",
                ]
            )

        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            return False

        async def text(self) -> str:
            return ""

        def __aiter__(self):
            return self

        async def __anext__(self):
            try:
                return next(self._chunks)
            except StopIteration as exc:
                raise StopAsyncIteration from exc

    class FakeSession:
        def __init__(self, *args, **kwargs) -> None:  # noqa: ANN002, ANN003
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            return False

        def post(self, url, *, headers=None, json=None):  # noqa: ANN001
            captured["url"] = url
            captured["headers"] = headers
            captured["json"] = json
            return FakeResponse()

    monkeypatch.setattr("app.adapters.openai.aiohttp.ClientSession", FakeSession)
    channel = ModelChannel(
        name="SiliconFlow",
        api_endpoint="https://api.siliconflow.cn/v1",
        api_key_encrypted=encrypt_value("sk-test"),
        model_identifier="Qwen/Qwen3-30B-A3B-Instruct-2507",
        type="openai",
        status="active",
        tags=[],
    )
    result = asyncio.run(OpenAICompatibleProbeAdapter().execute(channel, "ping"))

    assert result.success is True
    assert captured["url"] == "https://api.siliconflow.cn/v1/chat/completions"


def test_openai_probe_adapter_ignores_empty_choices_chunks(monkeypatch: pytest.MonkeyPatch) -> None:
    from app.adapters.openai import OpenAICompatibleProbeAdapter

    class FakeResponse:
        status = 200
        headers = {"Content-Type": "text/event-stream"}

        def __init__(self) -> None:
            self.content = self
            self._chunks = iter(
                [
                    b'data: {"choices":[{"delta":{"content":"hello"}}]}\n\n',
                    b'data: {"choices":[],"usage":{"completion_tokens":1}}\n\n',
                    b"data: [DONE]\n\n",
                ]
            )

        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            return False

        async def text(self) -> str:
            return ""

        def __aiter__(self):
            return self

        async def __anext__(self):
            try:
                return next(self._chunks)
            except StopIteration as exc:
                raise StopAsyncIteration from exc

    class FakeSession:
        def __init__(self, *args, **kwargs) -> None:  # noqa: ANN002, ANN003
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            return False

        def post(self, url, *, headers=None, json=None):  # noqa: ANN001, ARG002
            return FakeResponse()

    monkeypatch.setattr("app.adapters.openai.aiohttp.ClientSession", FakeSession)

    channel = ModelChannel(
        name="SiliconFlow",
        api_endpoint="https://api.siliconflow.cn/v1/chat/completions",
        api_key_encrypted=encrypt_value("sk-test"),
        model_identifier="Qwen/Qwen3-30B-A3B-Instruct-2507",
        type="openai",
        status="active",
        tags=[],
    )
    result = asyncio.run(OpenAICompatibleProbeAdapter().execute(channel, "ping"))

    assert result.success is True
    assert result.response_excerpt == "hello"
    assert result.tokens_count == 1


def test_create_openai_channel_normalizes_base_v1_endpoint() -> None:
    login()

    response = client.post(
        "/api/channels",
        json={
            "name": "SiliconFlow",
            "apiEndpoint": "https://api.siliconflow.cn/v1",
            "apiKey": "sk-test",
            "modelIdentifier": "Qwen/Qwen3-30B-A3B-Instruct-2507",
            "type": "openai",
            "status": "active",
            "tags": ["test"],
            "description": "test",
        },
    )

    assert response.status_code == 200
    assert response.json()["apiEndpoint"] == "https://api.siliconflow.cn/v1/chat/completions"


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

    logs_after_create = client.get("/api/logs")
    assert logs_after_create.status_code == 200
    assert len(logs_after_create.json()) == 1
    assert logs_after_create.json()[0]["trigger"] == "scheduled"

    manual_probe = client.post(f"/api/tasks/{task['id']}/probe")
    assert manual_probe.status_code == 200
    assert manual_probe.json()["timestamp"].endswith("+08:00")
    assert manual_probe.json()["requestPayloadJson"]["_probeContext"]["intervalMinutes"] == 5
    assert manual_probe.json()["requestPayloadJson"]["_probeContext"]["trigger"] == "manual"
    assert manual_probe.json()["violatedTtft"] is True
    assert manual_probe.json()["violatedTps"] is True
    assert manual_probe.json()["violatedExtLatency"] is True

    logs = client.get("/api/logs")
    assert logs.status_code == 200
    assert len(logs.json()) == 2

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


def test_auto_resolved_incident_uses_current_recovery_metric(monkeypatch) -> None:
    import app.services.probe as probe_service

    state = {"adapter": FakeAdapter(ttft_ms=120, total_latency_ms=900, tps=250.0)}
    monkeypatch.setattr(probe_service, "get_adapter", lambda channel_type: state["adapter"])

    login()

    channel = client.post(
        "/api/channels",
        json={
            "name": "TPS Recovery Channel",
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
            "name": "TPS Recovery Guard",
            "channelId": channel["id"],
            "prompt": "ping",
            "intervalMinutes": 5,
            "concurrency": 1,
            "status": "running",
            "thresholds": {
                "maxTtftMs": 300,
                "minTps": 300,
                "maxTotalLatencyMs": 1200,
                "minSuccessRate": 0.95,
            },
            "alertChannels": [],
        },
    ).json()

    firing_notifications = client.get("/api/notifications").json()
    assert len(firing_notifications) == 1
    assert firing_notifications[0]["status"] == "firing"
    assert firing_notifications[0]["metricValue"] == "250.0 Tok/s"

    state["adapter"] = FakeAdapter(ttft_ms=120, total_latency_ms=900, tps=320.0)
    second_probe = client.post(f"/api/tasks/{task['id']}/probe")
    assert second_probe.status_code == 200
    assert second_probe.json()["violatedTps"] is False

    notifications = client.get("/api/notifications").json()
    assert len(notifications) == 1
    assert notifications[0]["status"] == "resolved"
    assert notifications[0]["metricValue"] == "320.0 Tok/s"
    assert notifications[0]["thresholdValue"] == ">= 300.0 Tok/s"


def test_task_mutations_sync_runtime_scheduler(monkeypatch) -> None:
    import app.services.probe as probe_service

    class DummyScheduler:
        def __init__(self) -> None:
            self.synced_task_ids: list[str] = []

        async def sync_task(self, task_id: str) -> None:
            self.synced_task_ids.append(task_id)

    monkeypatch.setattr(probe_service, "get_adapter", lambda channel_type: FakeAdapter())

    runtime_scheduler = DummyScheduler()
    previous_scheduler = app_state.scheduler
    app_state.scheduler = runtime_scheduler
    monkeypatch.setattr("app.api.monitoring.app_state.scheduler", runtime_scheduler)

    try:
        login()

        channel = client.post(
            "/api/channels",
            json={
                "name": "Scheduler Sync Channel",
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
                "name": "Scheduler Sync Guard",
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

        updated = client.patch(
            f"/api/tasks/{task['id']}",
            json={
                "intervalMinutes": 1,
            },
        )
        assert updated.status_code == 200

        deleted = client.delete(f"/api/tasks/{task['id']}")
        assert deleted.status_code == 200

        assert runtime_scheduler.synced_task_ids == [task["id"], task["id"], task["id"]]
    finally:
        app_state.scheduler = previous_scheduler


def test_running_task_create_executes_immediately_and_resets_next_run(monkeypatch) -> None:
    import app.services.probe as probe_service

    monkeypatch.setattr(probe_service, "get_adapter", lambda channel_type: FakeAdapter())

    login()

    channel = client.post(
        "/api/channels",
        json={
            "name": "Immediate Create Channel",
            "apiEndpoint": "http://localhost:8000/v1/chat/completions",
            "apiKey": "sk-test",
            "modelIdentifier": "test-model",
            "type": "openai",
            "status": "active",
            "tags": ["test"],
            "description": "test",
        },
    ).json()

    response = client.post(
        "/api/tasks",
        json={
            "name": "Immediate Create Guard",
            "channelId": channel["id"],
            "prompt": "ping",
            "intervalMinutes": 5,
            "concurrency": 2,
            "status": "running",
            "thresholds": {
                "maxTtftMs": 300,
                "minTps": 25,
                "maxTotalLatencyMs": 1200,
                "minSuccessRate": 0.95,
            },
            "alertChannels": [],
        },
    )
    assert response.status_code == 200
    task = response.json()
    assert task["lastRunAt"] is not None
    assert task["nextRunAt"] is not None

    logs = [log for log in client.get("/api/logs").json() if log["taskId"] == task["id"]]
    assert len(logs) == 1
    assert logs[0]["trigger"] == "scheduled"
    assert logs[0]["sampleNo"] == 1


def test_running_task_update_executes_immediately_with_new_interval(monkeypatch) -> None:
    import app.services.probe as probe_service

    monkeypatch.setattr(probe_service, "get_adapter", lambda channel_type: FakeAdapter())

    login()

    channel = client.post(
        "/api/channels",
        json={
            "name": "Immediate Update Channel",
            "apiEndpoint": "http://localhost:8000/v1/chat/completions",
            "apiKey": "sk-test",
            "modelIdentifier": "test-model",
            "type": "openai",
            "status": "active",
            "tags": ["test"],
            "description": "test",
        },
    ).json()

    created = client.post(
        "/api/tasks",
        json={
            "name": "Immediate Update Guard",
            "channelId": channel["id"],
            "prompt": "ping",
            "intervalMinutes": 5,
            "concurrency": 1,
            "status": "paused",
            "thresholds": {
                "maxTtftMs": 300,
                "minTps": 25,
                "maxTotalLatencyMs": 1200,
                "minSuccessRate": 0.95,
            },
            "alertChannels": [],
        },
    ).json()

    response = client.patch(
        f"/api/tasks/{created['id']}",
        json={
            "intervalMinutes": 1,
            "status": "running",
            "prompt": "ping again",
        },
    )
    assert response.status_code == 200
    updated = response.json()
    assert updated["intervalMinutes"] == 1
    assert updated["lastRunAt"] is not None
    assert updated["nextRunAt"] is not None

    logs = [log for log in client.get("/api/logs").json() if log["taskId"] == created["id"]]
    assert len(logs) == 1
    assert logs[0]["trigger"] == "scheduled"
    assert logs[0]["requestPayloadJson"]["_probeContext"]["intervalMinutes"] == 1


def test_editing_running_task_triggers_fresh_probe(monkeypatch) -> None:
    import app.services.probe as probe_service

    monkeypatch.setattr(probe_service, "get_adapter", lambda channel_type: FakeAdapter())

    login()

    channel = client.post(
        "/api/channels",
        json={
            "name": "Edit Running Channel",
            "apiEndpoint": "http://localhost:8000/v1/chat/completions",
            "apiKey": "sk-test",
            "modelIdentifier": "test-model",
            "type": "openai",
            "status": "active",
            "tags": ["test"],
            "description": "test",
        },
    ).json()

    created = client.post(
        "/api/tasks",
        json={
            "name": "Edit Running Guard",
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

    first_logs = [log for log in client.get("/api/logs").json() if log["taskId"] == created["id"]]
    assert len(first_logs) == 1

    updated = client.patch(
        f"/api/tasks/{created['id']}",
        json={
            "thresholds": {
                "maxTtftMs": 100,
                "minTps": 25,
                "maxTotalLatencyMs": 1200,
                "minSuccessRate": 0.95,
            },
        },
    )
    assert updated.status_code == 200

    second_logs = [log for log in client.get("/api/logs").json() if log["taskId"] == created["id"]]
    assert len(second_logs) == 2


def test_push_report_delivers_to_enabled_feishu_channels(monkeypatch) -> None:
    import app.services.notifier as notifier_service
    import app.services.probe as probe_service

    sent_payloads: list[tuple[str, dict]] = []

    async def fake_send_webhook(endpoint, payload):  # noqa: ANN001
        sent_payloads.append((endpoint.name, payload))
        return "ok"

    async def fake_send_pdf(**kwargs):  # noqa: ANN003
        return False, "未配置 FEISHU_APP_ID / FEISHU_APP_SECRET / FEISHU_REPORT_CHAT_ID，已跳过 PDF 附件发送。"

    monkeypatch.setattr(probe_service, "get_adapter", lambda channel_type: FakeAdapter())
    monkeypatch.setattr(notifier_service, "_send_webhook", fake_send_webhook)
    monkeypatch.setattr(notifier_service, "send_feishu_report_pdf", fake_send_pdf)

    login()

    feishu_alert = client.post(
        "/api/alerts",
        json={
            "name": "DevOps 飞书群",
            "type": "feishu",
            "webhookUrl": "https://open.feishu.cn/open-apis/bot/v2/hook/test",
            "secret": "",
            "status": "enabled",
        },
    )
    assert feishu_alert.status_code == 200

    disabled_alert = client.post(
        "/api/alerts",
        json={
            "name": "Disabled 飞书群",
            "type": "feishu",
            "webhookUrl": "https://open.feishu.cn/open-apis/bot/v2/hook/disabled",
            "secret": "",
            "status": "disabled",
        },
    )
    assert disabled_alert.status_code == 200

    channel = client.post(
        "/api/channels",
        json={
            "name": "Report Channel",
            "apiEndpoint": "http://localhost:8000/v1/chat/completions",
            "apiKey": "sk-test",
            "modelIdentifier": "test-model",
            "type": "openai",
            "status": "active",
            "tags": ["test"],
            "description": "test",
        },
    ).json()

    created_task = client.post(
        "/api/tasks",
        json={
            "name": "Report Guard",
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
    )
    assert created_task.status_code == 200

    response = client.post("/api/reports/push?period=weekly")
    assert response.status_code == 200
    payload = response.json()
    assert payload["period"] == "weekly"
    assert payload["deliveredCount"] == 1
    assert payload["failedCount"] == 0
    assert payload["endpointNames"] == ["DevOps 飞书群"]
    assert payload["attachmentSent"] is False
    assert "已跳过 PDF 附件发送" in payload["attachmentMessage"]
    assert len(sent_payloads) == 1
    assert sent_payloads[0][0] == "DevOps 飞书群"
    assert sent_payloads[0][1]["kind"] == "report"
    assert sent_payloads[0][1]["periodLabel"] == "周报"
