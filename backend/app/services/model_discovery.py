from __future__ import annotations

from posixpath import dirname
from urllib.parse import urljoin, urlparse

import aiohttp
from fastapi import HTTPException


def _normalize_endpoint(api_endpoint: str) -> str:
    endpoint = api_endpoint.strip()
    if not endpoint:
        raise HTTPException(status_code=400, detail="请先填写 API 服务端点")
    return endpoint


def _replace_path(endpoint: str, new_path: str) -> str:
    parsed = urlparse(endpoint)
    if not parsed.scheme or not parsed.netloc:
        raise HTTPException(status_code=400, detail="API 服务端点格式不正确")
    path = new_path if new_path.startswith("/") else f"/{new_path}"
    return parsed._replace(path=path, params="", query="", fragment="").geturl()


def _replace_suffix(endpoint: str, old_suffix: str, new_suffix: str) -> str | None:
    parsed = urlparse(endpoint)
    path = parsed.path or "/"
    if not path.endswith(old_suffix):
        return None
    new_path = f"{path[: -len(old_suffix)]}{new_suffix}"
    return parsed._replace(path=new_path, params="", query="", fragment="").geturl()


def _join_same_level(endpoint: str, new_leaf: str) -> str:
    parsed = urlparse(endpoint)
    path = parsed.path or "/"
    base_dir = dirname(path.rstrip("/")) or "/"
    new_path = f"{base_dir.rstrip('/')}/{new_leaf.lstrip('/')}"
    return parsed._replace(path=new_path, params="", query="", fragment="").geturl()


def build_model_list_candidates(channel_type: str, api_endpoint: str) -> list[str]:
    endpoint = _normalize_endpoint(api_endpoint)
    candidates: list[str] = []
    if channel_type == "ollama":
        candidates.extend(
            [
                _replace_suffix(endpoint, "/api/chat", "/api/tags"),
                _replace_path(endpoint, "/api/tags"),
                _join_same_level(endpoint, "tags"),
                urljoin(endpoint.rstrip("/") + "/", "tags"),
            ]
        )
    elif channel_type in {"openai", "custom"}:
        candidates.extend(
            [
                _replace_suffix(endpoint, "/chat/completions", "/models"),
                _replace_suffix(endpoint, "/completions", "/models"),
                _replace_suffix(endpoint, "/chat", "/models"),
                _replace_path(endpoint, "/v1/models"),
                _replace_path(endpoint, "/models"),
                _join_same_level(endpoint, "models"),
                urljoin(endpoint.rstrip("/") + "/", "models"),
            ]
        )
    elif channel_type == "huggingface":
        candidates.append(endpoint)
    else:
        candidates.append(endpoint)
    # preserve order while removing duplicates
    return [item for item in dict.fromkeys(candidates) if item]


def extract_models(channel_type: str, payload: object) -> list[str]:
    if channel_type == "ollama" and isinstance(payload, dict):
        items = payload.get("models")
        if isinstance(items, list):
            names = [
                item.get("name")
                for item in items
                if isinstance(item, dict) and isinstance(item.get("name"), str) and item.get("name")
            ]
            return sorted(dict.fromkeys(names))

    if isinstance(payload, dict):
        data = payload.get("data")
        if isinstance(data, list):
            names = [
                item.get("id")
                for item in data
                if isinstance(item, dict) and isinstance(item.get("id"), str) and item.get("id")
            ]
            if names:
                return sorted(dict.fromkeys(names))

        if channel_type == "huggingface":
            model_id = payload.get("modelId") or payload.get("id")
            if isinstance(model_id, str) and model_id:
                return [model_id]

    if isinstance(payload, list):
        names: list[str] = []
        for item in payload:
            if isinstance(item, str) and item:
                names.append(item)
            elif isinstance(item, dict):
                model_id = item.get("id") or item.get("modelId") or item.get("name")
                if isinstance(model_id, str) and model_id:
                    names.append(model_id)
        if names:
            return sorted(dict.fromkeys(names))

    return []


async def fetch_models(channel_type: str, api_endpoint: str, api_key: str = "") -> tuple[list[str], str]:
    headers = {"Accept": "application/json"}
    if api_key.strip():
        headers["Authorization"] = f"Bearer {api_key.strip()}"

    errors: list[str] = []
    for candidate in build_model_list_candidates(channel_type, api_endpoint):
        try:
            timeout = aiohttp.ClientTimeout(total=20)
            connector = aiohttp.TCPConnector(force_close=True, ttl_dns_cache=0)
            async with aiohttp.ClientSession(timeout=timeout, connector=connector) as client:
                async with client.get(candidate, headers=headers) as response:
                    if response.status >= 400:
                        body = (await response.text())[:240]
                        errors.append(f"{candidate}: HTTP {response.status} {body}".strip())
                        continue
                    payload = await response.json(content_type=None)
                    models = extract_models(channel_type, payload)
                    if models:
                        return models, candidate
                    errors.append(f"{candidate}: 未解析出模型列表")
        except Exception as exc:  # noqa: BLE001
            errors.append(f"{candidate}: {exc}")

    detail = "未能获取模型列表"
    if errors:
        detail = f"{detail}，请检查 URL、密钥和接口协议是否正确。"
    raise HTTPException(status_code=400, detail=detail)
