from __future__ import annotations

from pydantic import BaseModel, Field

from app.schemas.common import APIModel


class LoginRequest(BaseModel):
    username: str = Field(min_length=1, max_length=128)
    password: str = Field(min_length=1, max_length=256)


class ChangePasswordRequest(BaseModel):
    current_password: str = Field(min_length=1, max_length=256)
    new_password: str = Field(min_length=8, max_length=256)


class UserResponse(APIModel):
    id: str
    username: str
    is_active: bool


class AuthStatusResponse(BaseModel):
    authenticated: bool
    user: UserResponse | None = None
