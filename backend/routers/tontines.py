from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from lib.auth import current_user, ensure_permission, optional_user, require_staff
from lib.core import (
    assert_gerance_access,
    audit,
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


class PositionOut(BaseModel):
    id: str
    tontine_id: str
    gerance_id: str
    index: int
    payout_date: str
    member_id: Optional[str] = None
    member_name: Optional[str] = None
    status: str


async def _enrich(t: dict[str, Any]) -> TontineOut:
    gerance = await db.gerances.find_one({"id": t["gerance_id"]}, {"_id": 0})
    joined = await db.tontine_members.count_documents({"tontine_id": t["id"], "status": "active"})
    return TontineOut(**t, gerance_name=gerance["name"] if gerance else "—", joined_count=joined)


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


@router.patch("/tontines/{tontine_id}", response_model=TontineOut)
async def update_tontine(tontine_id: str, body: dict[str, Any], user: dict[str, Any] = Depends(require_staff)):
    ensure_permission(user, "edit_tontine")
    tontine = await get_tontine(tontine_id)
    assert_gerance_access(user, tontine["gerance_id"])
    allowed = {"name", "description", "status", "deadline_time", "penalty_per_day", "description", "start_date",
               "interval_days", "duration_days"}
    updates = {k: v for k, v in body.items() if k in allowed}
    if not updates:
        raise HTTPException(status_code=422, detail="Rien à mettre à jour")
    if updates.get("status") and updates["status"] not in STATUSES:
        raise HTTPException(status_code=422, detail="Statut invalide")
    await db.tontines.update_one({"id": tontine_id}, {"$set": updates})
    await audit(user, "tontine_updated", "tontine", tontine_id, tontine["gerance_id"], updates)
    return await _enrich(await get_tontine(tontine_id))


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


@router.patch("/positions/{position_id}/assign", response_model=PositionOut)
async def assign_position(position_id: str, payload: AssignInput, user: dict[str, Any] = Depends(require_staff)):
    ensure_permission(user, "manage_positions")
    pos = await db.positions.find_one({"id": position_id}, {"_id": 0})
    if not pos:
        raise HTTPException(status_code=404, detail="Position introuvable")
    assert_gerance_access(user, pos["gerance_id"])
    if payload.member_id:
        clash = await db.positions.find_one(
            {"tontine_id": pos["tontine_id"], "member_id": payload.member_id, "id": {"$ne": position_id}}
        )
        if clash:
            raise HTTPException(status_code=409, detail="Ce membre occupe déjà une position dans cette tontine")
        member = await db.tontine_members.find_one({"tontine_id": pos["tontine_id"], "member_id": payload.member_id})
        if not member:
            raise HTTPException(status_code=422, detail="Ce membre n'appartient pas à cette tontine")
    await db.positions.update_one(
        {"id": position_id},
        {"$set": {"member_id": payload.member_id, "status": "assigned" if payload.member_id else "open"}},
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
    status: str
    created_at: Any
    decided_at: Optional[Any] = None


async def _request_out(r: dict[str, Any]) -> MembershipRequestOut:
    t = await db.tontines.find_one({"id": r["tontine_id"]}, {"_id": 0})
    g = await db.gerances.find_one({"id": r["gerance_id"]}, {"_id": 0})
    u = await db.users.find_one({"id": r["member_id"]}, {"_id": 0})
    return MembershipRequestOut(
        **r,
        tontine_name=t["name"] if t else "—",
        gerance_name=g["name"] if g else "—",
        member_name=f"{u['first_name']} {u['last_name']}" if u else "—",
        member_phone=u["phone"] if u else "—",
    )


class JoinInput(BaseModel):
    tontine_id: str


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
    doc = {
        "id": new_id(),
        "tontine_id": tontine["id"],
        "gerance_id": tontine["gerance_id"],
        "member_id": user["id"],
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
    await db.membership_requests.update_one(
        {"id": request_id}, {"$set": {"status": status, "decided_at": now_utc()}}
    )
    tontine = await get_tontine(req["tontine_id"])
    if status == "accepted":
        await db.tontine_members.update_one(
            {"tontine_id": req["tontine_id"], "member_id": req["member_id"]},
            {
                "$set": {"status": "active", "gerance_id": req["gerance_id"]},
                "$setOnInsert": {"id": new_id(), "joined_at": now_utc()},
            },
            upsert=True,
        )
        await generate_due_dates(tontine, req["member_id"])
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
    position_index: Optional[int] = None
    payout_date: Optional[str] = None
    contract_status: Optional[str] = None


@router.get("/memberships/mine", response_model=list[MyTontineOut])
async def my_tontines(user: dict[str, Any] = Depends(current_user)):
    rows = await db.tontine_members.find({"member_id": user["id"]}, {"_id": 0}).to_list(200)
    out = []
    for r in rows:
        t = await db.tontines.find_one({"id": r["tontine_id"]}, {"_id": 0})
        if not t:
            continue
        pos = await db.positions.find_one({"tontine_id": t["id"], "member_id": user["id"]}, {"_id": 0})
        contract = await db.contracts.find_one({"tontine_id": t["id"], "member_id": user["id"]}, {"_id": 0})
        out.append(
            MyTontineOut(
                tontine=await _enrich(t),
                joined_at=r["joined_at"],
                position_index=pos["index"] if pos else None,
                payout_date=pos["payout_date"] if pos else None,
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
                "joined_at": r["joined_at"],
            }
        )
    return out
