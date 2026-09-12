from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, EmailStr, Field

from lib.auth import ALL_PERMISSIONS, current_user, hash_password, require_admin, require_staff
from lib.core import audit, new_id, notify, now_utc
from lib.db import db

router = APIRouter()


class ManagerInput(BaseModel):
    first_name: str = Field(min_length=1)
    last_name: str = Field(min_length=1)
    phone: str = Field(min_length=6)
    email: EmailStr
    password: str = Field(min_length=6)
    permissions: list[str] = []


class ManagerUpdate(BaseModel):
    status: Optional[str] = None
    permissions: Optional[list[str]] = None


class ManagerOut(BaseModel):
    id: str
    first_name: str
    last_name: str
    phone: str
    email: str
    status: str
    gerance_id: str
    gerance_name: str
    permissions: list[str]
    tontine_count: int = 0


class GeranceOut(BaseModel):
    id: str
    name: str
    owner_id: str
    owner_name: str
    is_admin_gerance: bool
    tontine_count: int
    member_count: int
    total_expected: int
    total_paid: int
    total_pending: int
    total_late: int
    total_penalties: int


@router.get("/permissions", response_model=list[str])
async def list_permissions(_: dict[str, Any] = Depends(require_staff)):
    return ALL_PERMISSIONS


@router.post("/managers", response_model=ManagerOut)
async def create_manager(payload: ManagerInput, admin: dict[str, Any] = Depends(require_admin)):
    if await db.users.find_one({"email": payload.email.lower()}):
        raise HTTPException(status_code=409, detail="Un compte existe déjà avec cet email")
    bad = [p for p in payload.permissions if p not in ALL_PERMISSIONS]
    if bad:
        raise HTTPException(status_code=422, detail=f"Permissions inconnues: {bad}")
    user_id = new_id()
    gerance = {
        "id": new_id(),
        "name": f"Gérance {payload.first_name} {payload.last_name}",
        "owner_id": user_id,
        "is_admin_gerance": False,
        "created_at": now_utc(),
    }
    await db.gerances.insert_one(gerance)
    user = {
        "id": user_id,
        "first_name": payload.first_name.strip(),
        "last_name": payload.last_name.strip(),
        "phone": payload.phone.strip(),
        "email": payload.email.lower(),
        "password_hash": hash_password(payload.password),
        "role": "manager",
        "status": "active",
        "gerance_id": gerance["id"],
        "permissions": payload.permissions,
        "profile_complete": True,
        "identity_status": "verified",
        "address": None,
        "extra_info": None,
        "created_at": now_utc(),
    }
    await db.users.insert_one(user)
    await audit(admin, "manager_created", "user", user_id, gerance["id"])
    await notify(
        user_id,
        "Votre gérance est ouverte",
        f"Vous êtes gérant sur AIDONS-NOUS VIVANTS. {gerance['name']} vous est attribuée.",
        gerance["id"],
        event="manager_created",
    )
    return ManagerOut(
        **{k: user[k] for k in ("id", "first_name", "last_name", "phone", "email", "status", "permissions")},
        gerance_id=gerance["id"],
        gerance_name=gerance["name"],
        tontine_count=0,
    )


@router.get("/managers", response_model=list[ManagerOut])
async def list_managers(_: dict[str, Any] = Depends(require_admin)):
    managers = await db.users.find({"role": "manager"}, {"_id": 0}).to_list(500)
    out: list[ManagerOut] = []
    for m in managers:
        gerance = await db.gerances.find_one({"id": m.get("gerance_id")}, {"_id": 0})
        count = await db.tontines.count_documents({"gerance_id": m.get("gerance_id")})
        out.append(
            ManagerOut(
                id=m["id"],
                first_name=m["first_name"],
                last_name=m["last_name"],
                phone=m["phone"],
                email=m["email"],
                status=m["status"],
                gerance_id=m.get("gerance_id") or "",
                gerance_name=gerance["name"] if gerance else "—",
                permissions=m.get("permissions") or [],
                tontine_count=count,
            )
        )
    return out


@router.patch("/managers/{manager_id}")
async def update_manager(manager_id: str, payload: ManagerUpdate, admin: dict[str, Any] = Depends(require_admin)):
    manager = await db.users.find_one({"id": manager_id, "role": "manager"}, {"_id": 0})
    if not manager:
        raise HTTPException(status_code=404, detail="Gérant introuvable")
    updates: dict[str, Any] = {}
    if payload.status:
        if payload.status not in ("pending", "invited", "active", "suspended", "disabled"):
            raise HTTPException(status_code=422, detail="Statut invalide")
        updates["status"] = payload.status
    if payload.permissions is not None:
        bad = [p for p in payload.permissions if p not in ALL_PERMISSIONS]
        if bad:
            raise HTTPException(status_code=422, detail=f"Permissions inconnues: {bad}")
        updates["permissions"] = payload.permissions
    if not updates:
        raise HTTPException(status_code=422, detail="Rien à mettre à jour")
    await db.users.update_one({"id": manager_id}, {"$set": updates})
    await audit(admin, "manager_updated", "user", manager_id, manager.get("gerance_id"), updates)
    return {"ok": True, **updates}


async def _gerance_stats(gerance_id: str) -> dict[str, int]:
    dues = await db.contribution_due_dates.find({"gerance_id": gerance_id}, {"_id": 0}).to_list(20000)
    from lib.core import effective_status, penalty_amount
    from lib.dates import today_iso

    today = today_iso()
    penalty_by_tontine: dict[str, int] = {}
    async for t in db.tontines.find({"gerance_id": gerance_id}, {"_id": 0, "id": 1, "penalty_per_day": 1}):
        penalty_by_tontine[t["id"]] = int(t.get("penalty_per_day", 500))
    expected = sum(d["amount"] for d in dues)
    paid = sum(d["amount"] for d in dues if d["status"] == "paid")
    late_rows = [d for d in dues if effective_status(d, today) == "late"]
    late = sum(d["amount"] for d in late_rows)
    pending = expected - paid - late
    penalties = sum(
        penalty_amount(d, today, penalty_by_tontine.get(d["tontine_id"], 500)) for d in late_rows
    )
    return {
        "total_expected": expected,
        "total_paid": paid,
        "total_pending": max(pending, 0),
        "total_late": late,
        "total_penalties": penalties,
    }


@router.get("/gerances", response_model=list[GeranceOut])
async def list_gerances(_: dict[str, Any] = Depends(require_admin)):
    gerances = await db.gerances.find({}, {"_id": 0}).to_list(200)
    out: list[GeranceOut] = []
    for g in sorted(gerances, key=lambda x: (not x["is_admin_gerance"], x["name"])):
        owner = await db.users.find_one({"id": g["owner_id"]}, {"_id": 0})
        tontines = await db.tontines.count_documents({"gerance_id": g["id"]})
        active_member_ids = await db.tontine_members.distinct("member_id", {"gerance_id": g["id"], "status": "active"})
        members = await db.users.count_documents({"id": {"$in": active_member_ids}, "role": "member", "status": {"$ne": "trashed"}})
        out.append(
            GeranceOut(
                id=g["id"],
                name=g["name"],
                owner_id=g["owner_id"],
                owner_name=f"{owner['first_name']} {owner['last_name']}" if owner else "—",
                is_admin_gerance=g["is_admin_gerance"],
                tontine_count=tontines,
                member_count=members,
                **(await _gerance_stats(g["id"])),
            )
        )
    return out


class MyGeranceOut(BaseModel):
    id: str
    name: str
    is_admin_gerance: bool
    tontine_count: int
    member_count: int
    total_expected: int
    total_paid: int
    total_pending: int
    total_late: int
    total_penalties: int


@router.get("/my-gerance", response_model=MyGeranceOut)
async def my_gerance(user: dict[str, Any] = Depends(require_staff)):
    gerance = await db.gerances.find_one({"id": user.get("gerance_id")}, {"_id": 0})
    if not gerance:
        raise HTTPException(status_code=404, detail="Aucune gérance rattachée à ce compte")
    active_member_ids = await db.tontine_members.distinct(
        "member_id", {"gerance_id": gerance["id"], "status": "active"}
    )
    active_member_count = await db.users.count_documents(
        {"id": {"$in": active_member_ids}, "role": "member", "status": {"$ne": "trashed"}}
    )
    return MyGeranceOut(
        id=gerance["id"],
        name=gerance["name"],
        is_admin_gerance=gerance["is_admin_gerance"],
        tontine_count=await db.tontines.count_documents({"gerance_id": gerance["id"]}),
        member_count=active_member_count,
        **(await _gerance_stats(gerance["id"])),
    )


class MemberRow(BaseModel):
    id: str
    first_name: str
    last_name: str
    email: str
    phone: str
    identity_status: str
    status: str
    tontine_count: int


@router.get("/members", response_model=list[MemberRow])
async def list_members(user: dict[str, Any] = Depends(require_staff), gerance_id: Optional[str] = None):
    if user["role"] == "admin":
        scope = {"gerance_id": gerance_id} if gerance_id else {}
    else:
        scope = {"gerance_id": user.get("gerance_id")}
    if scope:
        member_ids = await db.tontine_members.distinct("member_id", scope)
        query: dict[str, Any] = {"id": {"$in": member_ids}, "status": {"$ne": "trashed"}}
    else:
        query = {"role": "member", "status": {"$ne": "trashed"}}
    members = await db.users.find(query, {"_id": 0}).to_list(1000)
    out: list[MemberRow] = []
    for m in members:
        out.append(
            MemberRow(
                id=m["id"],
                first_name=m["first_name"],
                last_name=m["last_name"],
                email=m["email"],
                phone=m["phone"],
                identity_status=m.get("identity_status", "none"),
                status=m.get("status", "active"),
                tontine_count=await db.tontine_members.count_documents({"member_id": m["id"]}),
            )
        )
    return out


class AuditRow(BaseModel):
    id: str
    actor_name: str
    actor_role: str
    action: str
    entity: str
    entity_id: str
    gerance_id: Optional[str] = None
    created_at: Any


@router.get("/audit", response_model=list[AuditRow])
async def list_audit(user: dict[str, Any] = Depends(require_staff)):
    query = {} if user["role"] == "admin" else {"gerance_id": user.get("gerance_id")}
    rows = await db.audit_logs.find(query, {"_id": 0}).sort("created_at", -1).to_list(200)
    return [AuditRow(**r) for r in rows]


@router.get("/identities")
async def list_identities(user: dict[str, Any] = Depends(require_staff)):
    rows = await db.identity_verifications.find({}, {"_id": 0, "id_document": 0, "selfie": 0}).to_list(500)
    enriched = []
    for r in rows:
        u = await db.users.find_one({"id": r["user_id"]}, {"_id": 0})
        enriched.append({**r, "member_name": f"{u['first_name']} {u['last_name']}" if u else "—"})
    return enriched


@router.patch("/identities/{user_id}")
async def decide_identity(user_id: str, body: dict[str, str], staff: dict[str, Any] = Depends(require_staff)):
    status = body.get("status")
    if status not in ("pending", "to_correct", "verified", "rejected"):
        raise HTTPException(status_code=422, detail="Statut invalide")
    await db.identity_verifications.update_one({"user_id": user_id}, {"$set": {"status": status}})
    await db.users.update_one({"id": user_id}, {"$set": {"identity_status": status}})
    await audit(staff, "identity_decided", "identity", user_id, None, {"status": status})
    await notify(user_id, "Vérification d'identité", f"Le statut de votre identité est: {status}.",
                 event="identity_decided")
    return {"ok": True, "status": status}


@router.get("/whoami-scope")
async def whoami_scope(user: dict[str, Any] = Depends(current_user)):
    return {"role": user["role"], "gerance_id": user.get("gerance_id")}
