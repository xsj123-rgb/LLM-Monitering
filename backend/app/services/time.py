from __future__ import annotations

from datetime import UTC, datetime, timedelta, timezone


BEIJING_TZ = timezone(timedelta(hours=8))


def as_beijing_time(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    aware = value.replace(tzinfo=UTC) if value.tzinfo is None else value.astimezone(UTC)
    return aware.astimezone(BEIJING_TZ)
