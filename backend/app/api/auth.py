from __future__ import annotations

from fastapi import APIRouter, HTTPException, Request, Response, status
from sqlalchemy import select

from app.config import get_settings
from app.dependencies import CurrentAdminUser, CurrentUser, DBSession
from app.schemas.auth import (
    AdminResetPasswordRequest,
    AuthStatusResponse,
    ChangePasswordRequest,
    LoginRequest,
    ManagedUserResponse,
    UserCreateRequest,
    UserResponse,
    UserUpdateRequest,
)
from app.services.auth import admin_reset_password, create_user, delete_user, update_user_status
from app.services.auth import (
    authenticate_user,
    change_password,
    clear_session_cookie,
    create_session,
    enforce_login_rate_limit,
    logout_session,
    require_user,
)
from app.models.auth import User

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


@router.get("/users", response_model=list[ManagedUserResponse])
def list_users(db: DBSession, _: CurrentAdminUser):
    users = list(db.scalars(select(User).order_by(User.role.asc(), User.created_at.asc())))
    return [ManagedUserResponse(**UserResponse.model_validate(user).model_dump()) for user in users]


@router.post("/users", response_model=ManagedUserResponse)
def create_managed_user(payload: UserCreateRequest, db: DBSession, _: CurrentAdminUser):
    user = create_user(
        db,
        username=payload.username.strip(),
        password=payload.password,
        role=payload.role,
        is_active=payload.is_active,
    )
    return ManagedUserResponse(**UserResponse.model_validate(user).model_dump())


@router.patch("/users/{user_id}", response_model=ManagedUserResponse)
def update_managed_user(user_id: str, payload: UserUpdateRequest, db: DBSession, admin_user: CurrentAdminUser):
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if payload.is_active is not None:
        if admin_user.id == user.id and payload.is_active is False:
            raise HTTPException(status_code=400, detail="Cannot deactivate current admin account")
        user = update_user_status(db, user=user, is_active=payload.is_active)
    return ManagedUserResponse(**UserResponse.model_validate(user).model_dump())


@router.post("/users/{user_id}/reset-password", response_model=ManagedUserResponse)
def reset_managed_user_password(user_id: str, payload: AdminResetPasswordRequest, db: DBSession, _: CurrentAdminUser):
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    user = admin_reset_password(db, user=user, new_password=payload.new_password)
    return ManagedUserResponse(**UserResponse.model_validate(user).model_dump())


@router.delete("/users/{user_id}")
def delete_managed_user(user_id: str, db: DBSession, admin_user: CurrentAdminUser):
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if admin_user.id == user.id:
        raise HTTPException(status_code=400, detail="Cannot delete current admin account")
    delete_user(db, user=user)
    return {"ok": True}
