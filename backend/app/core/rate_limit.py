from __future__ import annotations

from collections import defaultdict, deque
from time import time


class InMemoryRateLimiter:
    def __init__(self) -> None:
        self._attempts: dict[str, deque[float]] = defaultdict(deque)

    def allow(self, key: str, *, max_attempts: int, window_seconds: int) -> bool:
        now = time()
        attempts = self._attempts[key]
        while attempts and now - attempts[0] > window_seconds:
            attempts.popleft()
        if len(attempts) >= max_attempts:
            return False
        attempts.append(now)
        return True

    def reset(self, key: str | None = None) -> None:
        if key is None:
            self._attempts.clear()
            return
        self._attempts.pop(key, None)


login_rate_limiter = InMemoryRateLimiter()
