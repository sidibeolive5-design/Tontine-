from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from lib.auth import current_user, ensure_permission, optional_user, require_staff
from lib.core import (
    assert_branches_available,
    assert_gerance_access,
    audit,
    branch_capacity,
    branches_held,
    branches_used,
    generate_due_dates,
    get_tontine,
    new_id,
    notify,
    now_utc,
    parse_date,
    position_dates,
)
from lib.db import db

router = APIRouter()

STATUSES = ["draft", "pending_validation", "open", "running", "finished", "suspended", "cancelled"]


class TontineInput(BaseModel):
    name: str = Field(min_length=2)
    description: str = ""
    member_count: int = Field(gt=0)
    daily_amount: int = Field(gt=0)
    payout_amount: int = Field(gt=0)
    interval_days: int = Field(gt=0)
    beneficiary_count: int = Field(gt=0)
    duration_days: int = Field(gt=0)
    start_date: str
    deadline_time: str = "18:00"
    penalty_per_day: int = 500
    timezone: str = "Africa/Abidjan"
    status: str = "open"
    is_existing: bool = False
    grace_days: Optional[int] = None
    total_branches: Optional[int] = None
    allow_multi_branch: bool = False
    max_branches_per_member: int = 1
    penalty_mode: str = "member"   # member | branch
    turn_mode: str = "manual"      # manual | auto
    payment_method_ids: list[str] = []


class TontineOut(BaseModel):
    id: str
    gerance_id: str
    gerance_name: str
    name: str
    description: str
    member_count: int
    daily_amount: int
    payout_amount: int
    interval_days: int
    beneficiary_count: int
    duration_days: int
    start_date: str
    end_date: str
    deadline_time: str
    penalty_per_day: int
    timezone: str
    status: str
    is_existing: bool
    created_by: str
    joined_count: int = 0
    grace_days: Optional[int] = None
    total_branches: Optional[int] = None
    allow_multi_branch: bool = False
    max_branches_per_member: int = 1
    penalty_mode: str = "member"
    turn_mode: str = "manual"
    payment_method_ids: list[str] = []
    branches_used: int = 0
    branches_available: int = 0


class PositionOut(BaseModel):
    id: str
    tontine_id: str
    gerance_id: str
    index: int
    payout_date: str
    member_id: Optional[str] = None
    member_name: Optional[str] = None
    branch_number: int = 1
    status: str


async def _enrich(t: dict[str, Any]) -> TontineOut:
    gerance = await db.gerances.find_one({"id": t["gerance_id"]}, {"_id": 0})
    joined = await db.tontine_members.count_documents({"tontine_id": t["id"], "status": "active"})
    used = await branches_used(t["id"])
    capacity = branch_capacity(t)
    return TontineOut(
        **t,
        gerance_name=gerance["name"] if gerance else "—",
        joined_count=joined,
        branches_used=used,
        branches_available=max(capacity - used, 0),
    )


@router.post("/tontines", response_model=TontineOut)
async def create_tontine(payload: TontineInput, user: dict[str, Any] = Depends(require_staff)):
    ensure_permission(user, "create_tontine")
    if payload.status not in STATUSES:
        raise HTTPException(status_code=422, detail="Statut invalide")
    gerance_id = user.get("gerance_id")
    if not gerance_id:
        raise HTTPException(status_code=400, detail="Aucune gérance rattachée à ce compte")
    start = parse_date(payload.start_date)
    from datetime import timedelta

    end = start + timedelta(days=payload.duration_days - 1)
    doc = {
        "id": new_id(),
        "gerance_id": gerance_id,  # always the creator's own gérance — never another one
        "end_date": end.isoformat(),
        "created_by": user["id"],
        "created_at": now_utc(),
        **payload.model_dump(),
    }
    if not doc.get("total_branches"):
        doc["total_branches"] = payload.member_count
    if not payload.allow_multi_branch:
        doc["max_branches_per_member"] = 1
    if doc["penalty_mode"] not in ("member", "branch"):
        raise HTTPException(status_code=422, detail="Mode de pénalité invalide")
    if doc["turn_mode"] not in ("manual", "auto"):
        raise HTTPException(status_code=422, detail="Mode de gestion des tours invalide")
    await db.tontines.insert_one(doc)
    positions = [
        {
            "id": new_id(),
            "tontine_id": doc["id"],
            "gerance_id": gerance_id,
            "index": i + 1,
            "payout_date": d,
            "member_id": None,
            "status": "open",
        }
        for i, d in enumerate(position_dates(start, payload.interval_days, payload.beneficiary_count))
    ]
    if positions:
        await db.positions.insert_many(positions)
    await audit(user, "tontine_created", "tontine", doc["id"], gerance_id, {"name": doc["name"]})
    doc.pop("_id", None)
    return await _enrich(doc)


@router.get("/tontines/public", response_model=list[TontineOut])
async def public_tontines():
    rows = await db.tontines.find({"status": {"$in": ["open", "running"]}}, {"_id": 0}).to_list(200)
    return [await _enrich(t) for t in rows]


@router.get("/tontines/mine", response_model=list[TontineOut])
async def my_gerance_tontines(user: dict[str, Any] = Depends(require_staff)):
    rows = await db.tontines.find({"gerance_id": user.get("gerance_id")}, {"_id": 0}).to_list(500)
    return [await _enrich(t) for t in rows]


@router.get("/tontines/all", response_model=list[TontineOut])
async def all_tontines(user: dict[str, Any] = Depends(require_staff), gerance_id: Optional[str] = None):
    if user["role"] != "admin":
        raise HTTPException(status_code=403, detail="Réservé à l'administrateur")
    query = {"gerance_id": gerance_id} if gerance_id else {}
    rows = await db.tontines.find(query, {"_id": 0}).to_list(1000)
    return [await _enrich(t) for t in rows]


@router.get("/tontines/{tontine_id}", response_model=TontineOut)
async def tontine_detail(tontine_id: str, _: Optional[dict[str, Any]] = Depends(optional_user)):
    return await _enrich(await get_tontine(tontine_id))


EDITABLE_FIELDS = {
    "name", "description", "status", "deadline_time", "penalty_per_day", "start_date",
    "interval_days", "duration_days", "daily_amount", "payout_amount", "member_count",
    "beneficiary_count", "grace_days", "total_branches", "allow_multi_branch",
    "max_branches_per_member", "penalty_mode", "turn_mode", "is_existing",
}
# Changing one of these rewrites the calendar / the payout dates, so it needs a confirmation.
STRUCTURAL_FIELDS = {"start_date", "interval_days", "duration_days", "beneficiary_count", "daily_amount",
                     "deadline_time"}


async def _resync_positions(tontine: dict[str, Any]) -> dict[str, Any]:
    """Rewrite payout dates. A position already paid out (received) is never touched."""
    start = parse_date(tontine["start_date"])
    wanted = position_dates(start, int(tontine["interval_days"]), int(tontine["beneficiary_count"]))
    existing = await db.positions.find({"tontine_id": tontine["id"]}, {"_id": 0}).sort("index", 1).to_list(500)
    by_index = {p["index"]: p for p in existing}
    protected = 0
    for i, d in enumerate(wanted, start=1):
        p = by_index.get(i)
        if not p:
            await db.positions.insert_one({
                "id": new_id(), "tontine_id": tontine["id"], "gerance_id": tontine["gerance_id"],
                "index": i, "payout_date": d, "member_id": None, "status": "open",
            })
        elif p.get("status") == "received":
            protected += 1
        elif p["payout_date"] != d:
            await db.positions.update_one({"id": p["id"]}, {"$set": {"payout_date": d}})
    removed = 0
    for p in existing:
        if p["index"] > len(wanted):
            if p.get("status") == "received":
                protected += 1
                continue
            await db.positions.delete_one({"id": p["id"]})
            removed += 1
    return {"positions": len(wanted), "protected_positions": protected, "removed_positions": removed}


async def _resync_due_dates(tontine: dict[str, Any]) -> dict[str, Any]:
    """Re-align every member's schedule on the tontine settings.

    Paid / processing days are protected: they are never deleted nor re-priced.
    """
    from datetime import timedelta

    start = parse_date(tontine["start_date"])
    wanted = [(start + timedelta(days=i)).isoformat() for i in range(int(tontine["duration_days"]))]
    wanted_set = set(wanted)
    deadline = tontine.get("deadline_time", "18:00")
    daily = int(tontine["daily_amount"])
    added = updated = removed = protected = 0
    members = await db.tontine_members.find({"tontine_id": tontine["id"], "status": "active"}, {"_id": 0}).to_list(2000)
    for m in members:
        branches = max(int(m.get("branches") or 1), 1)
        amount = daily * branches
        rows = await db.contribution_due_dates.find(
            {"tontine_id": tontine["id"], "member_id": m["member_id"]}, {"_id": 0}
        ).to_list(5000)
        by_date = {r["date"]: r for r in rows}
        for r in rows:
            locked = r["status"] in ("paid", "processing")
            if r["date"] not in wanted_set:
                if locked:
                    protected += 1
                    continue
                await db.contribution_due_dates.delete_one({"id": r["id"]})
                removed += 1
            elif locked:
                protected += 1
            elif r["amount"] != amount or r.get("deadline_time") != deadline:
                await db.contribution_due_dates.update_one(
                    {"id": r["id"]},
                    {"$set": {"amount": amount, "deadline_time": deadline, "branches": branches,
                              "synced_at": now_utc()}},
                )
                updated += 1
        new_rows = []
        for i, d in enumerate(wanted):
            if d in by_date:
                continue
            new_rows.append({
                "id": new_id(), "tontine_id": tontine["id"], "gerance_id": tontine["gerance_id"],
                "member_id": m["member_id"], "date": d, "deadline_time": deadline, "amount": amount,
                "branches": branches, "period": i + 1, "status": "pending", "payment_id": None,
                "source": "system", "created_at": now_utc(), "synced_at": now_utc(),
            })
        if new_rows:
            await db.contribution_due_dates.insert_many(new_rows)
            added += len(new_rows)
        # Periods are renumbered so "période n" stays consistent with the new calendar.
        for i, d in enumerate(wanted):
            await db.contribution_due_dates.update_one(
                {"tontine_id": tontine["id"], "member_id": m["member_id"], "date": d},
                {"$set": {"period": i + 1}},
            )
    return {"days_added": added, "days_updated": updated, "days_removed": removed,
            "protected_days": protected, "members_resynced": len(members)}


@router.get("/tontines/{tontine_id}/edit-impact")
async def edit_impact(
    tontine_id: str,
    start_date: Optional[str] = None,
    interval_days: Optional[int] = None,
    duration_days: Optional[int] = None,
    beneficiary_count: Optional[int] = None,
    user: dict[str, Any] = Depends(require_staff),
):
    """Old dates vs new dates, before confirming a structural change (spec §34)."""
    tontine = await get_tontine(tontine_id)
    assert_gerance_access(user, tontine["gerance_id"])
    old_positions = await db.positions.find({"tontine_id": tontine_id}, {"_id": 0}).sort("index", 1).to_list(500)
    try:
        new_start = parse_date(start_date or tontine["start_date"])
    except ValueError:
        raise HTTPException(status_code=422, detail="Date invalide (format AAAA-MM-JJ)")
    new_dates = position_dates(
        new_start,
        int(interval_days or tontine["interval_days"]),
        int(beneficiary_count or tontine["beneficiary_count"]),
    )
    locked_days = await db.contribution_due_dates.count_documents(
        {"tontine_id": tontine_id, "status": {"$in": ["paid", "processing"]}}
    )
    return {
        "old_dates": [p["payout_date"] for p in old_positions],
        "new_dates": new_dates,
        "received_positions": sum(1 for p in old_positions if p.get("status") == "received"),
        "locked_days": locked_days,
        "old_duration_days": int(tontine["duration_days"]),
        "new_duration_days": int(duration_days or tontine["duration_days"]),
    }


@router.patch("/tontines/{tontine_id}", response_model=TontineOut)
async def update_tontine(tontine_id: str, body: dict[str, Any], user: dict[str, Any] = Depends(require_staff)):
    ensure_permission(user, "edit_tontine")
    tontine = await get_tontine(tontine_id)
    assert_gerance_access(user, tontine["gerance_id"])
    updates = {k: v for k, v in body.items() if k in EDITABLE_FIELDS}
    if not updates:
        raise HTTPException(status_code=422, detail="Rien à mettre à jour")
    if updates.get("status") and updates["status"] not in STATUSES:
        raise HTTPException(status_code=422, detail="Statut invalide")
    if "penalty_mode" in updates and updates["penalty_mode"] not in ("member", "branch"):
        raise HTTPException(status_code=422, detail="Mode de pénalité invalide")
    if "turn_mode" in updates and updates["turn_mode"] not in ("manual", "auto"):
        raise HTTPException(status_code=422, detail="Mode de gestion des tours invalide")
    for field in ("daily_amount", "payout_amount", "interval_days", "duration_days", "member_count",
                  "beneficiary_count"):
        if field in updates and int(updates[field]) < 1:
            raise HTTPException(status_code=422, detail=f"{field} doit être supérieur à 0")
        if field in updates:
            updates[field] = int(updates[field])
    if "start_date" in updates:
        try:
            parse_date(str(updates["start_date"]))
        except ValueError:
            raise HTTPException(status_code=422, detail="Date de début invalide (format AAAA-MM-JJ)")
    if not updates.get("allow_multi_branch", tontine.get("allow_multi_branch")):
        updates["max_branches_per_member"] = 1
    merged = {**tontine, **updates}
    if "total_branches" in updates and not updates["total_branches"]:
        merged["total_branches"] = merged["member_count"]
        updates["total_branches"] = merged["member_count"]
    used = await branches_used(tontine_id)
    if branch_capacity(merged) and used > branch_capacity(merged):
        raise HTTPException(
            status_code=409,
            detail=f"{used} branche(s) sont déjà attribuées : la capacité ne peut pas descendre en dessous",
        )
    from datetime import timedelta

    new_start = parse_date(str(merged["start_date"]))
    updates["end_date"] = (new_start + timedelta(days=int(merged["duration_days"]) - 1)).isoformat()
    await db.tontines.update_one({"id": tontine_id}, {"$set": updates})
    fresh = await get_tontine(tontine_id)
    impact: dict[str, Any] = {}
    if STRUCTURAL_FIELDS & set(updates.keys()):
        impact.update(await _resync_positions(fresh))
        impact.update(await _resync_due_dates(fresh))
    await audit(user, "tontine_updated", "tontine", tontine_id, tontine["gerance_id"],
                {"updates": updates, "impact": impact})
    if impact.get("members_resynced"):
        for m in await db.tontine_members.find(
            {"tontine_id": tontine_id, "status": "active"}, {"_id": 0, "member_id": 1}
        ).to_list(2000):
            await notify(
                m["member_id"],
                "Tontine mise à jour",
                f"Les paramètres de {fresh['name']} ont été modifiés par votre gérance. "
                f"Consultez votre calendrier : {fresh['daily_amount']} FCFA/jour, "
                f"début le {fresh['start_date']}, heure limite {fresh['deadline_time']}. "
                "Vos jours déjà payés sont conservés.",
                tontine["gerance_id"],
                tontine_id,
                "tontine_updated",
            )
    return await _enrich(fresh)


@router.get("/tontines/{tontine_id}/positions", response_model=list[PositionOut])
async def list_positions(tontine_id: str, _: Optional[dict[str, Any]] = Depends(optional_user)):
    rows = await db.positions.find({"tontine_id": tontine_id}, {"_id": 0}).sort("index", 1).to_list(200)
    out = []
    for p in rows:
        name = None
        if p.get("member_id"):
            u = await db.users.find_one({"id": p["member_id"]}, {"_id": 0})
            name = f"{u['first_name']} {u['last_name']}" if u else None
        out.append(PositionOut(**p, member_name=name))
    return out


class AssignInput(BaseModel):
    member_id: Optional[str] = None
    branch_number: int = Field(default=1, ge=1)


@router.patch("/positions/{position_id}/assign", response_model=PositionOut)
async def assign_position(position_id: str, payload: AssignInput, user: dict[str, Any] = Depends(require_staff)):
    ensure_permission(user, "manage_positions")
    pos = await db.positions.find_one({"id": position_id}, {"_id": 0})
    if not pos:
        raise HTTPException(status_code=404, detail="Position introuvable")
    assert_gerance_access(user, pos["gerance_id"])
    if payload.member_id:
        member = await db.tontine_members.find_one({"tontine_id": pos["tontine_id"], "member_id": payload.member_id})
        if not member:
            raise HTTPException(status_code=422, detail="Ce membre n'appartient pas à cette tontine")
        branches = max(int(member.get("branches") or 1), 1)
        if payload.branch_number > branches:
            raise HTTPException(status_code=422, detail=f"Ce membre ne possède que {branches} branche(s) dans cette tontine")
        clash_query: dict[str, Any] = {
            "tontine_id": pos["tontine_id"], "member_id": payload.member_id, "id": {"$ne": position_id},
        }
        if payload.branch_number == 1:
            clash_query["$or"] = [{"branch_number": 1}, {"branch_number": {"$exists": False}}]
        else:
            clash_query["branch_number"] = payload.branch_number
        clash = await db.positions.find_one(clash_query)
        if clash:
            raise HTTPException(status_code=409, detail="Cette branche a déjà une prise attribuée à ce membre")
    await db.positions.update_one(
        {"id": position_id},
        {"$set": {"member_id": payload.member_id, "branch_number": payload.branch_number if payload.member_id else 1,
                   "status": "assigned" if payload.member_id else "open"}},
    )
    await audit(user, "position_assigned", "position", position_id, pos["gerance_id"], {"member_id": payload.member_id})
    if payload.member_id:
        await notify(
            payload.member_id,
            "Position attribuée",
            f"Votre position n°{pos['index']} est prévue le {pos['payout_date']}.",
            pos["gerance_id"],
            pos["tontine_id"],
            "position_assigned",
        )
    fresh = await db.positions.find_one({"id": position_id}, {"_id": 0})
    assert fresh is not None
    name = None
    if fresh.get("member_id"):
        u = await db.users.find_one({"id": fresh["member_id"]}, {"_id": 0})
        name = f"{u['first_name']} {u['last_name']}" if u else None
    return PositionOut(**fresh, member_name=name)


@router.post("/positions/{position_id}/queue", response_model=list[PositionOut])
async def send_to_queue(position_id: str, user: dict[str, Any] = Depends(require_staff)):
    """« Passer à la queue » — the occupant moves to the last position, others shift up."""
    ensure_permission(user, "manage_positions")
    pos = await db.positions.find_one({"id": position_id}, {"_id": 0})
    if not pos:
        raise HTTPException(status_code=404, detail="Position introuvable")
    assert_gerance_access(user, pos["gerance_id"])
    rows = await db.positions.find({"tontine_id": pos["tontine_id"]}, {"_id": 0}).sort("index", 1).to_list(200)
    occupants = [r["member_id"] for r in rows]
    idx = next(i for i, r in enumerate(rows) if r["id"] == position_id)
    moved = occupants.pop(idx)
    occupants.append(moved)
    for row, member_id in zip(rows, occupants):
        await db.positions.update_one(
            {"id": row["id"]},
            {"$set": {"member_id": member_id, "status": "assigned" if member_id else "open"}},
        )
    await audit(user, "position_queued", "position", position_id, pos["gerance_id"])
    return await list_positions(pos["tontine_id"])


class MembershipRequestOut(BaseModel):
    id: str
    tontine_id: str
    tontine_name: str
    gerance_id: str
    gerance_name: str
    member_id: str
    member_name: str
    member_phone: str
    branches: int = 1
    daily_total: int = 0
    status: str
    created_at: Any
    decided_at: Optional[Any] = None


async def _request_out(r: dict[str, Any]) -> MembershipRequestOut:
    t = await db.tontines.find_one({"id": r["tontine_id"]}, {"_id": 0})
    g = await db.gerances.find_one({"id": r["gerance_id"]}, {"_id": 0})
    u = await db.users.find_one({"id": r["member_id"]}, {"_id": 0})
    branches = max(int(r.get("branches") or 1), 1)
    return MembershipRequestOut(
        **{k: v for k, v in r.items() if k != "branches"},
        branches=branches,
        daily_total=int(t["daily_amount"]) * branches if t else 0,
        tontine_name=t["name"] if t else "—",
        gerance_name=g["name"] if g else "—",
        member_name=f"{u['first_name']} {u['last_name']}" if u else "—",
        member_phone=u["phone"] if u else "—",
    )


class JoinInput(BaseModel):
    tontine_id: str
    branches: int = 1


@router.post("/memberships/request", response_model=MembershipRequestOut)
async def request_membership(payload: JoinInput, user: dict[str, Any] = Depends(current_user)):
    tontine = await get_tontine(payload.tontine_id)
    if tontine["status"] not in ("open", "running"):
        raise HTTPException(status_code=400, detail="Cette tontine n'accepte pas d'adhésion actuellement")
    existing = await db.membership_requests.find_one(
        {"tontine_id": tontine["id"], "member_id": user["id"], "status": {"$in": ["pending", "checking", "accepted"]}}
    )
    if existing:
        raise HTTPException(status_code=409, detail="Vous avez déjà une demande en cours pour cette tontine")
    await assert_branches_available(tontine, int(payload.branches), user["id"])
    doc = {
        "id": new_id(),
        "tontine_id": tontine["id"],
        "gerance_id": tontine["gerance_id"],
        "member_id": user["id"],
        "branches": max(int(payload.branches), 1),
        "status": "pending",
        "created_at": now_utc(),
        "decided_at": None,
    }
    await db.membership_requests.insert_one(doc)
    await notify(
        user["id"],
        "Demande enregistrée",
        "Votre demande d'adhésion a bien été enregistrée ✅",
        tontine["gerance_id"],
        tontine["id"],
        "membership_requested",
    )
    gerance = await db.gerances.find_one({"id": tontine["gerance_id"]}, {"_id": 0})
    if gerance:
        await notify(
            gerance["owner_id"],
            "Nouvelle demande d'adhésion",
            f"{user['first_name']} {user['last_name']} demande à rejoindre {tontine['name']}.",
            tontine["gerance_id"],
            tontine["id"],
            "membership_requested",
        )
    await audit(user, "membership_requested", "membership_request", doc["id"], tontine["gerance_id"])
    doc.pop("_id", None)
    return await _request_out(doc)


@router.get("/memberships/requests", response_model=list[MembershipRequestOut])
async def list_requests(user: dict[str, Any] = Depends(current_user), gerance_id: Optional[str] = None):
    if user["role"] == "admin":
        query: dict[str, Any] = {"gerance_id": gerance_id} if gerance_id else {}
    elif user["role"] == "manager":
        query = {"gerance_id": user.get("gerance_id")}
    else:
        query = {"member_id": user["id"]}
    rows = await db.membership_requests.find(query, {"_id": 0}).sort("created_at", -1).to_list(500)
    return [await _request_out(r) for r in rows]


class DecideInput(BaseModel):
    action: str  # accept | reject | checking | to_correct


@router.post("/memberships/requests/{request_id}/decide", response_model=MembershipRequestOut)
async def decide_request(request_id: str, payload: DecideInput, user: dict[str, Any] = Depends(require_staff)):
    ensure_permission(user, "manage_requests")
    req = await db.membership_requests.find_one({"id": request_id}, {"_id": 0})
    if not req:
        raise HTTPException(status_code=404, detail="Demande introuvable")
    assert_gerance_access(user, req["gerance_id"])
    mapping = {"accept": "accepted", "reject": "rejected", "checking": "checking", "to_correct": "to_correct"}
    if payload.action not in mapping:
        raise HTTPException(status_code=422, detail="Action invalide")
    status = mapping[payload.action]
    tontine = await get_tontine(req["tontine_id"])
    requested = max(int(req.get("branches") or 1), 1)
    if status == "accepted":
        # Re-check capacity at decision time: another manager may have filled the branches.
        await assert_branches_available(tontine, requested, req["member_id"])
    await db.membership_requests.update_one(
        {"id": request_id}, {"$set": {"status": status, "decided_at": now_utc()}}
    )
    if status == "accepted":
        await db.tontine_members.update_one(
            {"tontine_id": req["tontine_id"], "member_id": req["member_id"]},
            {
                "$set": {"status": "active", "gerance_id": req["gerance_id"], "branches": requested},
                "$setOnInsert": {"id": new_id(), "joined_at": now_utc()},
            },
            upsert=True,
        )
        await generate_due_dates(tontine, req["member_id"], requested)
        if not await db.contracts.find_one({"tontine_id": tontine["id"], "member_id": req["member_id"]}):
            await db.contracts.insert_one(
                {
                    "id": new_id(),
                    "tontine_id": tontine["id"],
                    "gerance_id": tontine["gerance_id"],
                    "member_id": req["member_id"],
                    "status": "to_sign",
                    "terms": {
                        "daily_amount": tontine["daily_amount"],
                        "payout_amount": tontine["payout_amount"],
                        "duration_days": tontine["duration_days"],
                        "start_date": tontine["start_date"],
                        "end_date": tontine["end_date"],
                        "interval_days": tontine["interval_days"],
                        "penalty_per_day": tontine["penalty_per_day"],
                        "deadline_time": tontine["deadline_time"],
                    },
                    "generated_at": now_utc(),
                    "signed_at": None,
                }
            )
        await notify(
            req["member_id"],
            "Adhésion acceptée ✅",
            f"Votre adhésion à {tontine['name']} est acceptée. Votre contrat est prêt à être signé.",
            req["gerance_id"],
            tontine["id"],
            "membership_accepted",
        )
    else:
        await notify(
            req["member_id"],
            "Mise à jour de votre demande",
            f"Votre demande pour {tontine['name']} est maintenant: {status}.",
            req["gerance_id"],
            tontine["id"],
            "membership_updated",
        )
    await audit(user, f"membership_{status}", "membership_request", request_id, req["gerance_id"])
    fresh = await db.membership_requests.find_one({"id": request_id}, {"_id": 0})
    assert fresh is not None
    return await _request_out(fresh)


class ContractOut(BaseModel):
    id: str
    tontine_id: str
    tontine_name: str
    gerance_id: str
    gerance_name: str
    member_id: str
    member_name: str
    status: str
    terms: dict[str, Any]
    generated_at: Any
    signed_at: Optional[Any] = None
    position_index: Optional[int] = None
    payout_date: Optional[str] = None


async def _contract_out(c: dict[str, Any]) -> ContractOut:
    t = await db.tontines.find_one({"id": c["tontine_id"]}, {"_id": 0})
    g = await db.gerances.find_one({"id": c["gerance_id"]}, {"_id": 0})
    u = await db.users.find_one({"id": c["member_id"]}, {"_id": 0})
    pos = await db.positions.find_one({"tontine_id": c["tontine_id"], "member_id": c["member_id"]}, {"_id": 0})
    return ContractOut(
        **c,
        tontine_name=t["name"] if t else "—",
        gerance_name=g["name"] if g else "—",
        member_name=f"{u['first_name']} {u['last_name']}" if u else "—",
        position_index=pos["index"] if pos else None,
        payout_date=pos["payout_date"] if pos else None,
    )


@router.get("/contracts", response_model=list[ContractOut])
async def list_contracts(user: dict[str, Any] = Depends(current_user)):
    if user["role"] == "admin":
        query: dict[str, Any] = {}
    elif user["role"] == "manager":
        query = {"gerance_id": user.get("gerance_id")}
    else:
        query = {"member_id": user["id"]}
    rows = await db.contracts.find(query, {"_id": 0}).to_list(1000)
    return [await _contract_out(c) for c in rows]


@router.post("/contracts/{contract_id}/sign", response_model=ContractOut)
async def sign_contract(contract_id: str, user: dict[str, Any] = Depends(current_user)):
    contract = await db.contracts.find_one({"id": contract_id}, {"_id": 0})
    if not contract:
        raise HTTPException(status_code=404, detail="Contrat introuvable")
    if contract["member_id"] != user["id"]:
        raise HTTPException(status_code=403, detail="Ce contrat ne vous appartient pas")
    if contract["status"] == "signed":
        raise HTTPException(status_code=409, detail="Contrat déjà signé")
    await db.contracts.update_one({"id": contract_id}, {"$set": {"status": "signed", "signed_at": now_utc()}})
    await audit(user, "contract_signed", "contract", contract_id, contract["gerance_id"])
    await notify(user["id"], "Contrat signé", "Votre contrat a été signé avec succès.",
                 contract["gerance_id"], contract["tontine_id"], "contract_signed")
    fresh = await db.contracts.find_one({"id": contract_id}, {"_id": 0})
    assert fresh is not None
    return await _contract_out(fresh)


class MyTontineOut(BaseModel):
    tontine: TontineOut
    joined_at: Any
    branches: int = 1
    daily_total: int = 0
    position_index: Optional[int] = None
    payout_date: Optional[str] = None
    positions: list[dict[str, Any]] = []
    contract_status: Optional[str] = None


@router.get("/memberships/mine", response_model=list[MyTontineOut])
async def my_tontines(user: dict[str, Any] = Depends(current_user)):
    rows = await db.tontine_members.find({"member_id": user["id"]}, {"_id": 0}).to_list(200)
    out = []
    for r in rows:
        t = await db.tontines.find_one({"id": r["tontine_id"]}, {"_id": 0})
        if not t:
            continue
        positions = await db.positions.find({"tontine_id": t["id"], "member_id": user["id"]}, {"_id": 0}).sort("index", 1).to_list(200)
        pos = positions[0] if positions else None
        contract = await db.contracts.find_one({"tontine_id": t["id"], "member_id": user["id"]}, {"_id": 0})
        out.append(
            MyTontineOut(
                tontine=await _enrich(t),
                joined_at=r["joined_at"],
                branches=max(int(r.get("branches") or 1), 1),
                daily_total=int(t["daily_amount"]) * max(int(r.get("branches") or 1), 1),
                position_index=pos["index"] if pos else None,
                payout_date=pos["payout_date"] if pos else None,
                positions=[{"position_index": p["index"], "payout_date": p["payout_date"],
                            "branch_number": int(p.get("branch_number") or 1), "status": p.get("status", "assigned")}
                           for p in positions],
                contract_status=contract["status"] if contract else None,
            )
        )
    return out


@router.get("/tontines/{tontine_id}/members")
async def tontine_members(tontine_id: str, user: dict[str, Any] = Depends(require_staff)):
    tontine = await get_tontine(tontine_id)
    assert_gerance_access(user, tontine["gerance_id"])
    rows = await db.tontine_members.find({"tontine_id": tontine_id}, {"_id": 0}).to_list(500)
    out = []
    for r in rows:
        u = await db.users.find_one({"id": r["member_id"]}, {"_id": 0})
        out.append(
            {
                "member_id": r["member_id"],
                "name": f"{u['first_name']} {u['last_name']}" if u else "—",
                "phone": u["phone"] if u else "—",
                "status": r["status"],
                "branches": max(int(r.get("branches") or 1), 1),
                "joined_at": r["joined_at"],
                "positions": [{"position_index": p["index"], "payout_date": p["payout_date"],
                               "branch_number": int(p.get("branch_number") or 1), "status": p.get("status", "assigned")}
                              for p in await db.positions.find({"tontine_id": tontine_id, "member_id": r["member_id"]}, {"_id": 0}).sort("index", 1).to_list(200)],
            }
        )
    return out
