from __future__ import annotations

from typing import Annotated

from fastapi import Depends, HTTPException, Request, Response, status
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.models.auth import User
from app.services.auth import require_admin_user, require_user

DBSession = Annotated[Session, Depends(get_db)]


def get_current_user(db: DBSession, request: Request, response: Response) -> User:
    return require_user(db, request, response)


CurrentUser = Annotated[User, Depends(get_current_user)]


def get_current_admin_user(db: DBSession, request: Request, response: Response) -> User:
    user = require_user(db, request, response)
    if not require_admin_user(user):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin privileges required")
    return user


CurrentAdminUser = Annotated[User, Depends(get_current_admin_user)]
