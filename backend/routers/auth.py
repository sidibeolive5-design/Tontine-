from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, EmailStr, Field

from lib.auth import (
    clear_session,
    current_user,
    hash_password,
    optional_user,
    public_user,
    set_session,
    verify_password,
)
from lib.core import audit, new_id, notify, now_utc
from lib.db import db

router = APIRouter()


class RegisterInput(BaseModel):
    first_name: str = Field(min_length=1)
    last_name: str = Field(min_length=1)
    phone: str = Field(min_length=6)
    email: EmailStr
    password: str = Field(min_length=6)


class LoginInput(BaseModel):
    email: EmailStr
    password: str


class ProfileInput(BaseModel):
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    phone: Optional[str] = None
    address: Optional[str] = None
    id_document: Optional[str] = None
    selfie: Optional[str] = None
    extra_info: Optional[str] = None


class UserOut(BaseModel):
    id: str
    first_name: str
    last_name: str
    phone: str
    email: str
    role: str
    status: str
    gerance_id: Optional[str] = None
    permissions: list[str] = []
    profile_complete: bool = False
    identity_status: str = "none"
    address: Optional[str] = None
    extra_info: Optional[str] = None


def _out(user: dict[str, Any]) -> UserOut:
    return UserOut(**{k: v for k, v in public_user(user).items() if k in UserOut.model_fields})


@router.post("/auth/register", response_model=UserOut)
async def register(payload: RegisterInput, response: Response):
    if await db.users.find_one({"email": payload.email.lower()}):
        raise HTTPException(status_code=409, detail="Un compte existe déjà avec cet email")
    # The very first account created on the platform becomes the principal administrator.
    is_first = await db.users.count_documents({}) == 0
    user = {
        "id": new_id(),
        "first_name": payload.first_name.strip(),
        "last_name": payload.last_name.strip(),
        "phone": payload.phone.strip(),
        "email": payload.email.lower(),
        "password_hash": hash_password(payload.password),
        "role": "admin" if is_first else "member",
        "status": "active",
        "gerance_id": None,
        "permissions": [],
        "profile_complete": False,
        "identity_status": "none",
        "address": None,
        "extra_info": None,
        "created_at": now_utc(),
    }
    if is_first:
        gerance = {
            "id": new_id(),
            "name": "Ma gérance — Administrateur principal",
            "owner_id": user["id"],
            "is_admin_gerance": True,
            "created_at": now_utc(),
        }
        await db.gerances.insert_one(gerance)
        user["gerance_id"] = gerance["id"]
    await db.users.insert_one(user)
    set_session(response, user["id"])
    await notify(
        user["id"],
        "Bienvenue sur AIDONS-NOUS VIVANTS",
        "Votre compte a bien été créé. Complétez vos informations personnelles pour adhérer à une tontine.",
        event="account_created",
    )
    return _out(user)


@router.post("/auth/login", response_model=UserOut)
async def login(payload: LoginInput, response: Response):
    user = await db.users.find_one({"email": payload.email.lower()})
    if not user or not verify_password(payload.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Email ou mot de passe incorrect")
    if user.get("status") in ("suspended", "disabled", "trashed"):
        raise HTTPException(status_code=403, detail="Ce compte est suspendu ou désactivé")
    set_session(response, user["id"])
    return _out(user)


@router.post("/auth/logout")
async def logout(response: Response):
    clear_session(response)
    return {"ok": True}


@router.get("/auth/me", response_model=Optional[UserOut])
async def me(user: Optional[dict[str, Any]] = Depends(optional_user)):
    return _out(user) if user else None


@router.patch("/auth/profile", response_model=UserOut)
async def update_profile(payload: ProfileInput, user: dict[str, Any] = Depends(current_user)):
    updates = {k: v for k, v in payload.model_dump().items() if v is not None}
    if not updates:
        raise HTTPException(status_code=422, detail="Aucune information fournie")
    identity_doc = updates.pop("id_document", None)
    selfie = updates.pop("selfie", None)
    if identity_doc:
        await db.identity_verifications.update_one(
            {"user_id": user["id"]},
            {
                "$set": {
                    "id_document": identity_doc,
                    "selfie": selfie,
                    "status": "pending",
                    "submitted_at": now_utc(),
                },
                "$setOnInsert": {"id": new_id(), "user_id": user["id"]},
            },
            upsert=True,
        )
        updates["identity_status"] = "pending"
    updates["profile_complete"] = True
    await db.users.update_one({"id": user["id"]}, {"$set": updates})
    await audit(user, "profile_updated", "user", user["id"])
    fresh = await db.users.find_one({"id": user["id"]}, {"_id": 0})
    return _out(fresh or user)
