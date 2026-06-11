from __future__ import annotations

import argparse
import getpass

from sqlalchemy import select

from app.core.security import hash_password
from app.db.session import SessionLocal
from app.models.auth import User


def reset_admin_password(username: str) -> int:
    with SessionLocal() as db:
        user = db.scalar(select(User).where(User.username == username))
        if not user:
            raise SystemExit(f"User '{username}' not found")
        password = getpass.getpass("New password: ")
        user.password_hash = hash_password(password)
        db.commit()
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="LLM-Guardian backend CLI")
    parser.add_argument("command", choices=["reset-admin-password"])
    parser.add_argument("--username", default="admin")
    args = parser.parse_args()
    if args.command == "reset-admin-password":
        return reset_admin_password(args.username)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
