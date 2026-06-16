from __future__ import annotations

from urllib.parse import urlparse


def normalize_openai_chat_endpoint(api_endpoint: str) -> str:
    endpoint = api_endpoint.strip()
    if not endpoint:
        return endpoint

    parsed = urlparse(endpoint)
    if not parsed.scheme or not parsed.netloc:
        return endpoint

    path = parsed.path or "/"
    normalized_path = path.rstrip("/") or "/"

    if normalized_path.endswith("/chat/completions"):
        target_path = normalized_path
    elif normalized_path.endswith("/models"):
        target_path = f"{normalized_path[:-len('/models')]}/chat/completions" or "/chat/completions"
    elif normalized_path.endswith("/completions"):
        target_path = f"{normalized_path[:-len('/completions')]}/chat/completions" or "/chat/completions"
    elif normalized_path.endswith("/chat"):
        target_path = f"{normalized_path}/completions"
    elif normalized_path in {"/", ""}:
        target_path = "/v1/chat/completions"
    else:
        target_path = f"{normalized_path}/chat/completions"

    return parsed._replace(path=target_path, params="", query="", fragment="").geturl()
