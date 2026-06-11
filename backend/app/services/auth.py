from __future__ import annotations

from datetime import datetime, timedelta

from fastapi import HTTPException, Request, Response, status
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.config import Settings, get_settings
from app.core.rate_limit import login_rate_limiter
from app.core.security import (
    SessionLifetime,
    build_session_lifetime,
    generate_session_token,
    hash_password,
    hash_token,
    verify_password,
)
from app.models.auth import User, UserSession


def authenticate_user(db: Session, username: str, password: str) -> User | None:
    user = db.scalar(select(User).where(User.username == username))
    if not user or not user.is_active:
        return None
    if not verify_password(password, user.password_hash):
        return None
    return user


def create_session(
    db: Session, *, user: User, request: Request, response: Response, settings: Settings | None = None
) -> UserSession:
    settings = settings or get_settings()
    token = generate_session_token()
    lifetime = build_session_lifetime()
    session = UserSession(
        user_id=user.id,
        session_token_hash=hash_token(token),
        expires_at=lifetime.expires_at,
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
    )
    db.add(session)
    user.last_login_at = datetime.utcnow()
    db.commit()
    db.refresh(session)
    set_session_cookie(response, token, lifetime, settings)
    return session


def set_session_cookie(response: Response, token: str, lifetime: SessionLifetime, settings: Settings) -> None:
    max_age = int((lifetime.expires_at - datetime.utcnow()).total_seconds())
    response.set_cookie(
        settings.session_cookie_name,
        token,
        httponly=True,
        samesite="lax",
        secure=settings.is_production,
        max_age=max_age,
        expires=max_age,
        path="/",
    )


def clear_session_cookie(response: Response, settings: Settings | None = None) -> None:
    settings = settings or get_settings()
    response.delete_cookie(settings.session_cookie_name, path="/")


def get_request_ip(request: Request) -> str:
    return request.client.host if request.client else "unknown"


def enforce_login_rate_limit(request: Request, settings: Settings | None = None) -> None:
    settings = settings or get_settings()
    ip = get_request_ip(request)
    allowed = login_rate_limiter.allow(
        ip,
        max_attempts=settings.login_rate_limit_max_attempts,
        window_seconds=settings.login_rate_limit_window_seconds,
    )
    if not allowed:
        raise HTTPException(status_code=status.HTTP_429_TOO_MANY_REQUESTS, detail="Too many login attempts")


def get_session_user(db: Session, request: Request, response: Response | None = None) -> User | None:
    settings = get_settings()
    token = request.cookies.get(settings.session_cookie_name)
    if not token:
        return None
    session = db.scalar(select(UserSession).where(UserSession.session_token_hash == hash_token(token)))
    if not session:
        return None
    now = datetime.utcnow()
    if session.expires_at <= now:
        db.delete(session)
        db.commit()
        return None
    user = db.get(User, session.user_id)
    if not user or not user.is_active:
        db.delete(session)
        db.commit()
        return None
    session.last_seen_at = now
    max_expires_at = session.created_at + timedelta(days=settings.session_max_days)
    new_expiry = min(max_expires_at, now + timedelta(hours=settings.session_idle_hours))
    if new_expiry > session.expires_at:
        session.expires_at = new_expiry
    db.commit()
    if response is not None:
        set_session_cookie(
            response,
            token,
            SessionLifetime(expires_at=session.expires_at, max_expires_at=max_expires_at),
            settings,
        )
    return user


def require_user(db: Session, request: Request, response: Response | None = None) -> User:
    user = get_session_user(db, request, response)
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Authentication required")
    return user


def logout_session(db: Session, request: Request) -> None:
    settings = get_settings()
    token = request.cookies.get(settings.session_cookie_name)
    if not token:
        return
    db.execute(delete(UserSession).where(UserSession.session_token_hash == hash_token(token)))
    db.commit()


def change_password(db: Session, user: User, current_password: str, new_password: str) -> None:
    if not verify_password(current_password, user.password_hash):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Current password is incorrect")
    user.password_hash = hash_password(new_password)
    db.execute(delete(UserSession).where(UserSession.user_id == user.id))
    db.commit()
