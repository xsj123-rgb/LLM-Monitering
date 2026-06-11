from __future__ import annotations

from fastapi import APIRouter, HTTPException, Request, Response, status

from app.config import get_settings
from app.dependencies import CurrentUser, DBSession
from app.schemas.auth import AuthStatusResponse, ChangePasswordRequest, LoginRequest, UserResponse
from app.services.auth import (
    authenticate_user,
    change_password,
    clear_session_cookie,
    create_session,
    enforce_login_rate_limit,
    logout_session,
    require_user,
)

router = APIRouter(prefix="/api/auth", tags=["auth"])


@router.post("/login", response_model=AuthStatusResponse)
def login(payload: LoginRequest, request: Request, response: Response, db: DBSession):
    settings = get_settings()
    enforce_login_rate_limit(request, settings)
    user = authenticate_user(db, payload.username, payload.password)
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")
    create_session(db, user=user, request=request, response=response, settings=settings)
    return AuthStatusResponse(authenticated=True, user=UserResponse.model_validate(user))


@router.post("/logout")
def logout(request: Request, response: Response, db: DBSession):
    logout_session(db, request)
    clear_session_cookie(response)
    return {"ok": True}


@router.get("/me", response_model=AuthStatusResponse)
def me(request: Request, response: Response, db: DBSession):
    try:
        user = require_user(db, request, response)
    except HTTPException:
        return AuthStatusResponse(authenticated=False, user=None)
    return AuthStatusResponse(authenticated=True, user=UserResponse.model_validate(user))


@router.post("/change-password")
def update_password(payload: ChangePasswordRequest, db: DBSession, user: CurrentUser, response: Response):
    change_password(db, user, payload.current_password, payload.new_password)
    clear_session_cookie(response)
    return {"ok": True}
