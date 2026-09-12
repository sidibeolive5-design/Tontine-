"""Auth helpers: pbkdf2 password hashing + httpOnly JWT cookie session."""

import hashlib
import os
import secrets
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

import jwt
from fastapi import Depends, HTTPException, Request, Response

from lib.db import db

SECRET = os.environ.get("SESSION_SECRET", "aidons-nous-vivants-dev-secret")
COOKIE = "anv_session"
ALGO = "HS256"

ALL_PERMISSIONS = [
    "create_tontine",
    "edit_tontine",
    "manage_members",
    "invite_members",
    "manage_requests",
    "verify_identity",
    "manage_contracts",
    "view_contributions",
    "record_history",
    "verify_payments",
    "manage_penalties",
    "manage_positions",
    "confirm_payouts",
    "send_notifications",
]


def hash_password(password: str) -> str:
    salt = secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), 120_000).hex()
    return f"{salt}${digest}"


def verify_password(password: str, stored: str) -> bool:
    try:
        salt, digest = stored.split("$", 1)
    except ValueError:
        return False
    calc = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), 120_000).hex()
    return secrets.compare_digest(calc, digest)


def set_session(response: Response, user_id: str) -> None:
    token = jwt.encode(
        {"sub": user_id, "exp": datetime.now(timezone.utc) + timedelta(days=30)}, SECRET, algorithm=ALGO
    )
    response.set_cookie(COOKIE, token, httponly=True, samesite="lax", max_age=60 * 60 * 24 * 30, path="/")


def clear_session(response: Response) -> None:
    response.delete_cookie(COOKIE, path="/")


async def optional_user(request: Request) -> Optional[dict[str, Any]]:
    token = request.cookies.get(COOKIE)
    if not token:
        return None
    try:
        payload = jwt.decode(token, SECRET, algorithms=[ALGO])
    except jwt.PyJWTError:
        return None
    user = await db.users.find_one({"id": payload.get("sub")}, {"_id": 0})
    if not user or user.get("status") in ("suspended", "disabled", "trashed"):
        return None
    return user


async def current_user(user: Optional[dict[str, Any]] = Depends(optional_user)) -> dict[str, Any]:
    if not user:
        raise HTTPException(status_code=401, detail="Non authentifié")
    return user


async def require_admin(user: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
    if user["role"] != "admin":
        raise HTTPException(status_code=403, detail="Réservé à l'administrateur")
    return user


async def require_staff(user: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
    if user["role"] not in ("admin", "manager"):
        raise HTTPException(status_code=403, detail="Réservé aux gérants")
    return user


def has_permission(user: dict[str, Any], permission: str) -> bool:
    if user["role"] == "admin":
        return True
    return permission in (user.get("permissions") or [])


def ensure_permission(user: dict[str, Any], permission: str) -> None:
    if not has_permission(user, permission):
        raise HTTPException(status_code=403, detail=f"Permission manquante: {permission}")


def public_user(user: dict[str, Any]) -> dict[str, Any]:
    return {k: v for k, v in user.items() if k != "password_hash"}
