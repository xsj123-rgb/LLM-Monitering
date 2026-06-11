from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import Settings
from app.core.security import hash_password
from app.models.auth import User


def bootstrap_admin_user(db: Session, settings: Settings) -> None:
    user = db.scalar(select(User).limit(1))
    if user or not settings.admin_username or not settings.admin_password:
        return
    db.add(
        User(
            username=settings.admin_username,
            password_hash=hash_password(settings.admin_password),
            is_active=True,
        )
    )
    db.commit()
