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


def ensure_ai_analysis_tables(engine: Engine) -> None:
    if engine.dialect.name != "sqlite":
        return
    with engine.begin() as conn:
        conn.execute(
            text(
                """
                CREATE TABLE IF NOT EXISTS ai_analysis_configs (
                    id VARCHAR(64) PRIMARY KEY NOT NULL,
                    enabled BOOLEAN NOT NULL DEFAULT 0,
                    provider_type VARCHAR(32) NOT NULL DEFAULT 'openai-compatible',
                    api_endpoint VARCHAR(1024) NOT NULL DEFAULT '',
                    api_key_encrypted TEXT NOT NULL DEFAULT '',
                    model_identifier VARCHAR(255) NOT NULL DEFAULT '',
                    schedule_mode VARCHAR(16) NOT NULL DEFAULT 'weekly',
                    status VARCHAR(16) NOT NULL DEFAULT 'idle',
                    last_run_at DATETIME,
                    last_success_at DATETIME,
                    last_error TEXT,
                    created_at DATETIME NOT NULL,
                    updated_at DATETIME NOT NULL
                )
                """
            )
        )
        conn.execute(
            text(
                """
                CREATE TABLE IF NOT EXISTS audit_advice_snapshots (
                    id VARCHAR(64) PRIMARY KEY NOT NULL,
                    channel_id VARCHAR(64) NOT NULL,
                    period VARCHAR(16) NOT NULL,
                    advice TEXT NOT NULL DEFAULT '',
                    source VARCHAR(16) NOT NULL DEFAULT 'disabled',
                    generated_at DATETIME NOT NULL,
                    analysis_model_name VARCHAR(255),
                    analysis_window_start DATETIME,
                    analysis_window_end DATETIME,
                    error_message TEXT,
                    FOREIGN KEY(channel_id) REFERENCES model_channels(id) ON DELETE CASCADE
                )
                """
            )
        )
        conn.execute(
            text(
                "CREATE UNIQUE INDEX IF NOT EXISTS uq_audit_advice_channel_period "
                "ON audit_advice_snapshots(channel_id, period)"
            )
        )
        conn.execute(
            text("CREATE INDEX IF NOT EXISTS ix_audit_advice_snapshots_period ON audit_advice_snapshots(period)")
        )
        conn.execute(
            text("CREATE INDEX IF NOT EXISTS ix_audit_advice_snapshots_channel_id ON audit_advice_snapshots(channel_id)")
        )
