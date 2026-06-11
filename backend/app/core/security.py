from __future__ import annotations

import hashlib
import secrets
from dataclasses import dataclass
from datetime import datetime, timedelta

from argon2 import PasswordHasher
from cryptography.fernet import Fernet

from app.config import get_settings

settings = get_settings()
password_hasher = PasswordHasher()
fernet = Fernet(settings.derived_fernet_key)


def hash_password(password: str) -> str:
    return password_hasher.hash(password)


def verify_password(password: str, hashed_password: str) -> bool:
    try:
        return password_hasher.verify(hashed_password, password)
    except Exception:
        return False


def encrypt_value(value: str | None) -> str:
    if not value:
        return ""
    return fernet.encrypt(value.encode("utf-8")).decode("utf-8")


def decrypt_value(value: str | None) -> str:
    if not value:
        return ""
    return fernet.decrypt(value.encode("utf-8")).decode("utf-8")


def generate_session_token() -> str:
    return secrets.token_urlsafe(32)


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


@dataclass
class SessionLifetime:
    expires_at: datetime
    max_expires_at: datetime


def build_session_lifetime(now: datetime | None = None) -> SessionLifetime:
    now = now or datetime.utcnow()
    return SessionLifetime(
        expires_at=now + timedelta(hours=settings.session_idle_hours),
        max_expires_at=now + timedelta(days=settings.session_max_days),
    )
