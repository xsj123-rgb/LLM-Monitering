from __future__ import annotations

from sqlalchemy import text
from sqlalchemy.engine import Engine


def ensure_auth_columns(engine: Engine) -> None:
    if engine.dialect.name != "sqlite":
        return
    with engine.begin() as conn:
        columns = {
            row[1]
            for row in conn.execute(text("PRAGMA table_info(users)")).fetchall()
        }
        if not columns:
            return
        if "role" not in columns:
            conn.execute(text("ALTER TABLE users ADD COLUMN role VARCHAR(32) NOT NULL DEFAULT 'admin'"))
        if "password_ciphertext" not in columns:
            conn.execute(text("ALTER TABLE users ADD COLUMN password_ciphertext VARCHAR(2048)"))
        conn.execute(text("UPDATE users SET password_ciphertext = NULL WHERE password_ciphertext IS NOT NULL"))


def ensure_channel_deployment_columns(engine: Engine) -> None:
    if engine.dialect.name != "sqlite":
        return
    with engine.begin() as conn:
        columns = {
            row[1]
            for row in conn.execute(text("PRAGMA table_info(model_channels)")).fetchall()
        }
        if not columns:
            return
        if "deployment_mode" not in columns:
            conn.execute(text("ALTER TABLE model_channels ADD COLUMN deployment_mode VARCHAR(32)"))
        if "deployment_config" not in columns:
            conn.execute(text("ALTER TABLE model_channels ADD COLUMN deployment_config TEXT"))
        if "deployment_env" not in columns:
            conn.execute(text("ALTER TABLE model_channels ADD COLUMN deployment_env TEXT"))
        if "deployment_args" not in columns:
            conn.execute(text("ALTER TABLE model_channels ADD COLUMN deployment_args TEXT"))
        if "ai_diagnostic_enabled" not in columns:
            conn.execute(text("ALTER TABLE model_channels ADD COLUMN ai_diagnostic_enabled BOOLEAN NOT NULL DEFAULT 0"))
