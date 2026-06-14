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
