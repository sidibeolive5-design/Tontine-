"""Fiche membre : dossier complet d'un membre pour son responsable, + correction de ses infos.

Toujours cloisonné : un gérant ne peut ouvrir que la fiche d'un membre de sa gérance.
"""

from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, EmailStr, Field

from lib.auth import ensure_permission, require_staff
from lib.core import audit, effective_status, notify, now_utc, penalty_amount
from lib.dates import today_iso
from lib.db import db

router = APIRouter()

IDENTITY_STATUSES = ("none", "pending", "to_correct", "verified", "rejected")
USER_STATUSES = ("active", "suspended", "disabled")


class MemberTontineLine(BaseModel):
    tontine_id: str
    tontine_name: str
    gerance_id: str
    gerance_name: str
    status: str
    branches: int
    daily_amount: int
    total_days: int
    paid_days: int
    late_days: int
    processing_days: int
    total_expected: int
    total_paid: int
    penalties: int
    total_due: int
    progress: int
    next_due_date: Optional[str] = None
    position_index: Optional[int] = None
    payout_date: Optional[str] = None
    positions: list[dict[str, Any]] = []
    available_positions: list[dict[str, Any]] = []
    contract_status: Optional[str] = None


class MemberPaymentLine(BaseModel):
    id: str
    tontine_name: str
    amount: int
    days: int
    status: str
    source: str = "membre"
    receipt_number: Optional[str] = None
    created_at: Any


class MemberPayoutLine(BaseModel):
    id: str
    tontine_name: str
    amount: int
    payout_date: str
    position_index: int
    source: str
    receipt_number: Optional[str] = None


class MemberFile(BaseModel):
    id: str
    first_name: str
    last_name: str
    email: str
    phone: str
    role: str
    status: str
    identity_status: str
    address: Optional[str] = None
    extra_info: Optional[str] = None
    profile_complete: bool = False
    created_at: Any = None
    tontines: list[MemberTontineLine] = []
    payments: list[MemberPaymentLine] = []
    payouts: list[MemberPayoutLine] = []
    total_paid: int = 0
    total_due: int = 0
    unread_notifications: int = 0


async def _member_in_scope(member_id: str, user: dict[str, Any]) -> dict[str, Any]:
    member = await db.users.find_one({"id": member_id}, {"_id": 0})
    if not member:
        raise HTTPException(status_code=404, detail="Membre introuvable")
    if user["role"] != "admin":
        shared = await db.tontine_members.find_one(
            {"member_id": member_id, "gerance_id": user.get("gerance_id")}
        )
        if not shared:
            raise HTTPException(status_code=403, detail="Ce membre n'appartient pas à votre gérance")
    return member


@router.get("/members/{member_id}/file", response_model=MemberFile)
async def member_file(member_id: str, user: dict[str, Any] = Depends(require_staff)):
    member = await _member_in_scope(member_id, user)
    today = today_iso()
    memberships = await db.tontine_members.find({"member_id": member_id}, {"_id": 0}).to_list(200)
    if user["role"] != "admin":
        memberships = [m for m in memberships if m.get("gerance_id") == user.get("gerance_id")]

    lines: list[MemberTontineLine] = []
    grand_paid = grand_due = 0
    for m in memberships:
        tontine = await db.tontines.find_one({"id": m["tontine_id"]}, {"_id": 0})
        if not tontine:
            continue
        gerance = await db.gerances.find_one({"id": tontine["gerance_id"]}, {"_id": 0})
        dues = await db.contribution_due_dates.find(
            {"tontine_id": tontine["id"], "member_id": member_id}, {"_id": 0}
        ).to_list(20000)
        penalty_per_day = int(tontine.get("penalty_per_day", 500))
        grace = int(tontine.get("grace_days") or 0)
        per_branch = tontine.get("penalty_mode") == "branch"
        late = [d for d in dues if effective_status(d, today) == "late"]
        paid = [d for d in dues if d["status"] == "paid"]
        processing = [d for d in dues if d["status"] == "processing"]
        penalties = sum(
            penalty_amount(d, today, penalty_per_day, grace)
            * (max(int(d.get("branches") or 1), 1) if per_branch else 1)
            for d in late
        )
        expected = sum(d["amount"] for d in dues)
        paid_amount = sum(d["amount"] for d in paid)
        due_now = sum(d["amount"] for d in late) + penalties
        upcoming = sorted(d["date"] for d in dues if d["status"] == "pending" and d["date"] >= today)
        member_positions = await db.positions.find({"tontine_id": tontine["id"], "member_id": member_id}, {"_id": 0}).sort("index", 1).to_list(200)
        all_positions = await db.positions.find(
            {"tontine_id": tontine["id"]},
            {"_id": 0, "id": 1, "index": 1, "payout_date": 1, "member_id": 1, "branch_number": 1, "status": 1},
        ).sort("index", 1).to_list(200)
        position = member_positions[0] if member_positions else None
        contract = await db.contracts.find_one(
            {"tontine_id": tontine["id"], "member_id": member_id}, {"_id": 0}
        )
        grand_paid += paid_amount
        grand_due += due_now
        lines.append(
            MemberTontineLine(
                tontine_id=tontine["id"],
                tontine_name=tontine["name"],
                gerance_id=tontine["gerance_id"],
                gerance_name=gerance["name"] if gerance else "—",
                status=m.get("status", "active"),
                branches=max(int(m.get("branches") or 1), 1),
                daily_amount=int(tontine["daily_amount"]),
                total_days=len(dues),
                paid_days=len(paid),
                late_days=len(late),
                processing_days=len(processing),
                total_expected=expected,
                total_paid=paid_amount,
                penalties=penalties,
                total_due=due_now,
                progress=round(len(paid) / len(dues) * 100) if dues else 0,
                next_due_date=upcoming[0] if upcoming else None,
                position_index=(position or {}).get("index"),
                payout_date=(position or {}).get("payout_date"),
                positions=[{"id": p["id"], "position_index": p["index"], "payout_date": p["payout_date"],
                            "branch_number": int(p.get("branch_number") or 1), "status": p.get("status", "assigned")}
                           for p in member_positions],
                available_positions=[{"id": p["id"], "position_index": p["index"], "payout_date": p["payout_date"],
                                      "branch_number": int(p.get("branch_number") or 1), "status": p.get("status", "open")}
                                     for p in all_positions if not p.get("member_id") or p.get("member_id") == member_id],
                contract_status=(contract or {}).get("status"),
            )
        )

    pay_query: dict[str, Any] = {"member_id": member_id}
    if user["role"] != "admin":
        pay_query["gerance_id"] = user.get("gerance_id")
    payments = await db.payments.find(pay_query, {"_id": 0, "proof_image": 0}).sort("created_at", -1).to_list(300)
    payouts = await db.payouts.find(pay_query, {"_id": 0}).sort("created_at", -1).to_list(300)
    tnames: dict[str, str] = {}

    async def tname(tid: str) -> str:
        if tid not in tnames:
            t = await db.tontines.find_one({"id": tid}, {"_id": 0, "name": 1})
            tnames[tid] = (t or {}).get("name", "—")
        return tnames[tid]

    return MemberFile(
        id=member["id"],
        first_name=member["first_name"],
        last_name=member["last_name"],
        email=member["email"],
        phone=member["phone"],
        role=member.get("role", "member"),
        status=member.get("status", "active"),
        identity_status=member.get("identity_status", "none"),
        address=member.get("address"),
        extra_info=member.get("extra_info"),
        profile_complete=bool(member.get("profile_complete")),
        created_at=member.get("created_at"),
        tontines=lines,
        payments=[
            MemberPaymentLine(
                id=p["id"],
                tontine_name=await tname(p["tontine_id"]),
                amount=int(p["amount"]),
                days=len(p.get("days") or []),
                status=p["status"],
                source=p.get("source") or "membre",
                receipt_number=p.get("receipt_number"),
                created_at=p.get("created_at"),
            )
            for p in payments
        ],
        payouts=[
            MemberPayoutLine(
                id=p["id"],
                tontine_name=await tname(p["tontine_id"]),
                amount=int(p["amount"]),
                payout_date=p.get("payout_date", "—"),
                position_index=int(p.get("position_index") or 0),
                source=p.get("source", "confirmation"),
                receipt_number=p.get("receipt_number"),
            )
            for p in payouts
        ],
        total_paid=grand_paid,
        total_due=grand_due,
        unread_notifications=await db.notifications.count_documents({"user_id": member_id, "read": False}),
    )


class MemberUpdate(BaseModel):
    first_name: Optional[str] = Field(default=None, min_length=1)
    last_name: Optional[str] = Field(default=None, min_length=1)
    phone: Optional[str] = Field(default=None, min_length=6)
    email: Optional[EmailStr] = None
    address: Optional[str] = None
    extra_info: Optional[str] = None
    status: Optional[str] = None
    identity_status: Optional[str] = None


class MemberTontineUpdate(BaseModel):
    branches: int = Field(ge=1)


class MemberPositionUpdate(BaseModel):
    position_id: str
    branch_number: int = Field(ge=1)


async def _member_tontine(member_id: str, tontine_id: str, user: dict[str, Any]) -> tuple[dict[str, Any], dict[str, Any]]:
    member = await _member_in_scope(member_id, user)
    membership = await db.tontine_members.find_one({"member_id": member_id, "tontine_id": tontine_id}, {"_id": 0})
    if not membership:
        raise HTTPException(status_code=404, detail="Ce membre n'est pas inscrit à cette tontine")
    tontine = await db.tontines.find_one({"id": tontine_id}, {"_id": 0})
    if not tontine:
        raise HTTPException(status_code=404, detail="Tontine introuvable")
    if user["role"] != "admin" and tontine["gerance_id"] != user.get("gerance_id"):
        raise HTTPException(status_code=403, detail="Cette tontine appartient à une autre gérance")
    return membership, tontine


@router.patch("/members/{member_id}/tontines/{tontine_id}")
async def update_member_tontine(member_id: str, tontine_id: str, payload: MemberTontineUpdate,
                                user: dict[str, Any] = Depends(require_staff)):
    ensure_permission(user, "manage_members")
    membership, tontine = await _member_tontine(member_id, tontine_id, user)
    old_branches = max(int(membership.get("branches") or 1), 1)
    if payload.branches < old_branches:
        used_branches = await db.positions.count_documents({
            "tontine_id": tontine_id, "member_id": member_id, "branch_number": {"$gt": payload.branches},
        })
        if used_branches:
            raise HTTPException(status_code=409, detail="Une branche à retirer possède encore une prise attribuée")
    if payload.branches > old_branches:
        capacity = int(tontine.get("total_branches") or tontine.get("member_count") or 0)
        used = await db.tontine_members.aggregate([
            {"$match": {"tontine_id": tontine_id, "status": "active"}},
            {"$group": {"_id": None, "total": {"$sum": {"$ifNull": ["$branches", 1]}}}},
        ]).to_list(1)
        current_used = int((used[0] if used else {}).get("total") or 0)
        if capacity and current_used + payload.branches - old_branches > capacity:
            raise HTTPException(status_code=409, detail="Il ne reste pas assez de branches disponibles")
    await db.tontine_members.update_one({"tontine_id": tontine_id, "member_id": member_id}, {"$set": {"branches": payload.branches}})
    dues = await db.contribution_due_dates.find({
        "tontine_id": tontine_id, "member_id": member_id, "status": {"$nin": ["paid", "processing"]},
    }, {"_id": 0}).to_list(20000)
    for due in dues:
        await db.contribution_due_dates.update_one({"id": due["id"]}, {"$set": {
            "branches": payload.branches, "amount": int(tontine["daily_amount"]) * payload.branches, "synced_at": now_utc(),
        }})
    await audit(user, "member_branches_updated", "tontine_member", f"{tontine_id}:{member_id}", tontine["gerance_id"],
                {"old_branches": old_branches, "branches": payload.branches})
    return await member_file(member_id, user)


@router.patch("/members/{member_id}/positions")
async def update_member_position(member_id: str, payload: MemberPositionUpdate,
                                 user: dict[str, Any] = Depends(require_staff)):
    ensure_permission(user, "manage_members")
    member = await _member_in_scope(member_id, user)
    position = await db.positions.find_one({"id": payload.position_id}, {"_id": 0})
    if not position:
        raise HTTPException(status_code=404, detail="Position introuvable")
    if user["role"] != "admin" and position.get("gerance_id") != user.get("gerance_id"):
        raise HTTPException(status_code=403, detail="Cette position appartient à une autre gérance")
    if position.get("member_id") and position.get("member_id") != member_id:
        raise HTTPException(status_code=409, detail="Cette prise est déjà attribuée à un autre membre")
    membership = await db.tontine_members.find_one({"tontine_id": position["tontine_id"], "member_id": member_id}, {"_id": 0})
    if not membership:
        raise HTTPException(status_code=422, detail="Ce membre n'est pas inscrit à cette tontine")
    branches = max(int(membership.get("branches") or 1), 1)
    if payload.branch_number > branches:
        raise HTTPException(status_code=422, detail=f"Ce membre ne possède que {branches} branche(s)")
    clash_query: dict[str, Any] = {
        "tontine_id": position["tontine_id"], "member_id": member_id, "id": {"$ne": position["id"]},
    }
    if payload.branch_number == 1:
        clash_query["$or"] = [{"branch_number": 1}, {"branch_number": {"$exists": False}}]
    else:
        clash_query["branch_number"] = payload.branch_number
    clash = await db.positions.find_one(clash_query)
    if clash:
        raise HTTPException(status_code=409, detail="Cette branche a déjà une prise attribuée à ce membre")
    await db.positions.update_one({"id": position["id"]}, {"$set": {
        "member_id": member_id, "branch_number": payload.branch_number, "status": "assigned",
    }})
    await audit(user, "member_position_updated", "position", position["id"], position["gerance_id"],
                {"member_id": member_id, "branch_number": payload.branch_number})
    return await member_file(member_id, user)


@router.patch("/members/{member_id}", response_model=MemberFile)
async def update_member(
    member_id: str, payload: MemberUpdate, user: dict[str, Any] = Depends(require_staff)
):
    """Correct a member's own details (a responsable never sees nor sets his password)."""
    ensure_permission(user, "manage_members")
    member = await _member_in_scope(member_id, user)
    if member.get("role") != "member":
        raise HTTPException(status_code=403, detail="Seule la fiche d'un membre est modifiable ici")
    updates = {k: v for k, v in payload.model_dump(exclude_none=True).items()}
    if not updates:
        raise HTTPException(status_code=422, detail="Rien à mettre à jour")
    if "email" in updates:
        updates["email"] = str(updates["email"]).lower()
        clash = await db.users.find_one({"email": updates["email"], "id": {"$ne": member_id}})
        if clash:
            raise HTTPException(status_code=409, detail="Un autre compte utilise déjà cet email")
    if "status" in updates and updates["status"] not in USER_STATUSES:
        raise HTTPException(status_code=422, detail="Statut invalide")
    if "identity_status" in updates:
        if updates["identity_status"] not in IDENTITY_STATUSES:
            raise HTTPException(status_code=422, detail="Statut d'identité invalide")
        await db.identity_verifications.update_one(
            {"user_id": member_id}, {"$set": {"status": updates["identity_status"]}}
        )
    updates["updated_at"] = now_utc()
    await db.users.update_one({"id": member_id}, {"$set": updates})
    await audit(user, "member_updated", "user", member_id,
                member.get("gerance_id") or user.get("gerance_id"),
                {k: v for k, v in updates.items() if k != "updated_at"})
    await notify(
        member_id,
        "Vos informations ont été mises à jour",
        "Votre gérance a corrigé vos informations sur AIDONS-NOUS VIVANTS. "
        "Vérifiez-les dans « Mon profil » et signalez toute erreur.",
        member.get("gerance_id"),
        None,
        "member_updated",
    )
    return await member_file(member_id, user)


@router.delete("/members/{member_id}", response_model=MemberFile)
async def disable_member(member_id: str, user: dict[str, Any] = Depends(require_staff)):
    """Disable the account without deleting financial, position, or audit history."""
    ensure_permission(user, "manage_members")
    member = await _member_in_scope(member_id, user)
    if member.get("role") != "member":
        raise HTTPException(status_code=403, detail="Seul un compte membre peut être désactivé ici")
    await db.users.update_one({"id": member_id}, {"$set": {"status": "disabled", "updated_at": now_utc()}})
    await audit(user, "member_disabled", "user", member_id,
                member.get("gerance_id") or user.get("gerance_id"),
                {"history_preserved": True})
    return await member_file(member_id, user)
