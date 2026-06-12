from __future__ import annotations

import asyncio
from types import SimpleNamespace

from app.adapters.custom import CustomProbeAdapter, extract_text_and_usage


def test_extract_text_and_usage_supports_common_shapes() -> None:
    text, usage = extract_text_and_usage({"response": "hello"})
    assert text == "hello"
    assert usage is None

    text, usage = extract_text_and_usage({"choices": [{"message": {"content": "hi"}}]})
    assert text == "hi"
    assert usage is None


def test_custom_adapter_builds_expected_request_payload(monkeypatch) -> None:
    class FakeResponse:
        status = 200
        headers = {"Content-Type": "application/json"}

        async def text(self) -> str:
            return '{"response":"blue in tune"}'

        @property
        def content(self):  # pragma: no cover - streaming path is not used here
            async def _iter():
                if False:
                    yield b""
            return _iter()

    class FakePostContext:
        async def __aenter__(self):
            return FakeResponse()

        async def __aexit__(self, exc_type, exc, tb):
            return None

    class FakeSession:
        def __init__(self, *args, **kwargs):
            self.kwargs = kwargs

        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            return None

        def post(self, url, headers=None, json=None):  # noqa: A002
            assert url == "http://localhost:1234/api/v1/chat"
            assert json["model"] == "qwen2.5-0.5b-instruct-mlx"
            assert json["system_prompt"] == "You answer only in rhymes."
            assert json["input"] == "What is your favorite color?"
            assert headers["Content-Type"] == "application/json"
            return FakePostContext()

    monkeypatch.setattr("app.adapters.custom.aiohttp.ClientSession", FakeSession)
    monkeypatch.setattr("app.adapters.custom.aiohttp.TCPConnector", lambda *args, **kwargs: object())
    monkeypatch.setattr("app.adapters.custom.aiohttp.ClientTimeout", lambda *args, **kwargs: object())
    monkeypatch.setattr("app.adapters.custom.decrypt_value", lambda value: value)

    channel = SimpleNamespace(
        api_endpoint="http://localhost:1234/api/v1/chat",
        api_key_encrypted="sk-test",
        model_identifier="qwen2.5-0.5b-instruct-mlx",
    )

    result = asyncio.run(CustomProbeAdapter().execute(channel, "What is your favorite color?"))
    assert result.success is True
    assert result.response_text == "blue in tune"
