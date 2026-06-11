from __future__ import annotations

import base64
import hashlib
from functools import lru_cache
from typing import Literal

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    app_name: str = "LLM-Guardian Backend"
    environment: Literal["development", "test", "production"] = "development"
    api_host: str = "0.0.0.0"
    api_port: int = 8000
    database_url: str = "sqlite:///./backend/llm_guardian.db"
    cors_origins: list[str] = Field(
        default_factory=lambda: [
            "http://localhost:3000",
            "http://127.0.0.1:3000",
        ]
    )

    encryption_secret: str = "llm-guardian-dev-secret"
    login_rate_limit_window_seconds: int = 300
    login_rate_limit_max_attempts: int = 5
    session_cookie_name: str = "lg_session"
    session_idle_hours: int = 12
    session_max_days: int = 7

    admin_username: str | None = Field(default=None, alias="LG_ADMIN_USERNAME")
    admin_password: str | None = Field(default=None, alias="LG_ADMIN_PASSWORD")

    smtp_host: str | None = None
    smtp_port: int = 587
    smtp_username: str | None = None
    smtp_password: str | None = None
    smtp_from: str | None = None
    smtp_use_tls: bool = True

    @property
    def is_production(self) -> bool:
        return self.environment == "production"

    @property
    def derived_fernet_key(self) -> bytes:
        digest = hashlib.sha256(self.encryption_secret.encode("utf-8")).digest()
        return base64.urlsafe_b64encode(digest)


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
