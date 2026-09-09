from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from lib.auth import current_user, ensure_permission, require_staff
from lib.core import (
    assert_gerance_access,
    audit,
    effective_status,
    get_tontine,
    late_days,
    new_id,
    notify,
    now_utc,
)
from lib.dates import today_iso
from lib.db import db

router = APIRouter()

PAYMENT_METHODS = [
    {"code": "wave", "label": "Wave", "emoji": "🌊", "available": True},
    {"code": "orange", "label": "Orange Money", "emoji": "🟠", "available": False},
    {"code": "mtn", "label": "MTN Money", "emoji": "🟡", "available": False},
    {"code": "moov", "label": "Moov Money", "emoji": "🔵", "available": False},
    {"code": "bank", "label": "Virement bancaire", "emoji": "🏦", "available": False},
]

WAVE_NUMBER = "+225 07 00 00 00 00"


class DueDateOut(BaseModel):
    id: str
    tontine_id: str
    tontine_name: str
    gerance_id: str
    member_id: str
    member_name: str
    date: str
    deadline_time: str
    amount: int
    period: int
    status: str
    display_status: str
    late_days: int
    penalty: int
    source: str


class SummaryOut(BaseModel):
    tontine_id: str
    tontine_name: str
    total_days: int
    paid_days: int
    remaining_days: int
    late_days_count: int
    processing_days: int
    total_expected: int
    total_paid: int
    total_remaining: int
    penalties: int
    progress: int
    next_due_date: Optional[str] = None


async def _due_rows(query: dict[str, Any]) -> list[DueDateOut]:
    rows = await db.contribution_due_dates.find(query, {"_id": 0}).sort("date", 1).to_list(20000)
    today = today_iso()
    names: dict[str, str] = {}
    tnames: dict[str, str] = {}
    out = []
    for r in rows:
        if r["member_id"] not in names:
            u = await db.users.find_one({"id": r["member_id"]}, {"_id": 0})
            names[r["member_id"]] = f"{u['first_name']} {u['last_name']}" if u else "—"
        if r["tontine_id"] not in tnames:
            t = await db.tontines.find_one({"id": r["tontine_id"]}, {"_id": 0})
            tnames[r["tontine_id"]] = t["name"] if t else "—"
        ld = late_days(r, today)
        out.append(
            DueDateOut(
                **r,
                tontine_name=tnames[r["tontine_id"]],
                member_name=names[r["member_id"]],
                display_status=effective_status(r, today),
                late_days=ld,
                penalty=ld * 500,
            )
        )
    return out


def _scope(user: dict[str, Any], gerance_id: Optional[str], tontine_id: Optional[str],
           member_id: Optional[str]) -> dict[str, Any]:
    query: dict[str, Any] = {}
    if user["role"] == "member":
        query["member_id"] = user["id"]
    elif user["role"] == "manager":
        query["gerance_id"] = user.get("gerance_id")
    else:
        if gerance_id:
            query["gerance_id"] = gerance_id
    if tontine_id:
        query["tontine_id"] = tontine_id
    if member_id and user["role"] != "member":
        query["member_id"] = member_id
    return query


@router.get("/due-dates", response_model=list[DueDateOut])
async def due_dates(
    user: dict[str, Any] = Depends(current_user),
    gerance_id: Optional[str] = None,
    tontine_id: Optional[str] = None,
    member_id: Optional[str] = None,
):
    return await _due_rows(_scope(user, gerance_id, tontine_id, member_id))


@router.get("/summary", response_model=list[SummaryOut])
async def summary(
    user: dict[str, Any] = Depends(current_user),
    gerance_id: Optional[str] = None,
    tontine_id: Optional[str] = None,
    member_id: Optional[str] = None,
):
    rows = await _due_rows(_scope(user, gerance_id, tontine_id, member_id))
    grouped: dict[str, list[DueDateOut]] = {}
    for r in rows:
        grouped.setdefault(r.tontine_id, []).append(r)
    out = []
    for tid, items in grouped.items():
        paid = [i for i in items if i.status == "paid"]
        processing = [i for i in items if i.status == "processing"]
        late = [i for i in items if i.display_status == "late"]
        upcoming = [i for i in items if i.status == "pending" and i.display_status != "late"]
        total_expected = sum(i.amount for i in items)
        total_paid = sum(i.amount for i in paid)
        out.append(
            SummaryOut(
                tontine_id=tid,
                tontine_name=items[0].tontine_name,
                total_days=len(items),
                paid_days=len(paid),
                remaining_days=len(items) - len(paid),
                late_days_count=len(late),
                processing_days=len(processing),
                total_expected=total_expected,
                total_paid=total_paid,
                total_remaining=total_expected - total_paid,
                penalties=sum(i.penalty for i in items),
                progress=round(total_paid * 100 / total_expected) if total_expected else 0,
                next_due_date=upcoming[0].date if upcoming else None,
            )
        )
    return out


class ArrearRow(BaseModel):
    member_id: str
    member_name: str
    member_phone: str
    tontine_id: str
    tontine_name: str
    gerance_id: str
    gerance_name: str
    late_days: int
    late_amount: int
    penalties: int
    total_due: int
    oldest_unpaid: str
    paid_days: int
    total_days: int


@router.get("/arrears", response_model=list[ArrearRow])
async def arrears(
    user: dict[str, Any] = Depends(require_staff),
    gerance_id: Optional[str] = None,
    tontine_id: Optional[str] = None,
):
    """Members ranked by what they actually owe today — arrears + penalties."""
    query = _scope(user, gerance_id, tontine_id, None)
    rows = await db.contribution_due_dates.find(query, {"_id": 0}).to_list(50000)
    today = today_iso()
    buckets: dict[tuple[str, str], list[dict[str, Any]]] = {}
    for r in rows:
        buckets.setdefault((r["member_id"], r["tontine_id"]), []).append(r)

    out: list[ArrearRow] = []
    for (member_id, tid), items in buckets.items():
        late = [i for i in items if effective_status(i, today) == "late"]
        if not late:
            continue
        tontine = await db.tontines.find_one({"id": tid}, {"_id": 0})
        gerance = await db.gerances.find_one({"id": items[0]["gerance_id"]}, {"_id": 0})
        member = await db.users.find_one({"id": member_id}, {"_id": 0})
        penalty_per_day = int(tontine.get("penalty_per_day", 500)) if tontine else 500
        late_amount = sum(i["amount"] for i in late)
        penalties = sum(late_days(i, today) * penalty_per_day for i in late)
        out.append(
            ArrearRow(
                member_id=member_id,
                member_name=f"{member['first_name']} {member['last_name']}" if member else "—",
                member_phone=member["phone"] if member else "—",
                tontine_id=tid,
                tontine_name=tontine["name"] if tontine else "—",
                gerance_id=items[0]["gerance_id"],
                gerance_name=gerance["name"] if gerance else "—",
                late_days=len(late),
                late_amount=late_amount,
                penalties=penalties,
                total_due=late_amount + penalties,
                oldest_unpaid=min(i["date"] for i in late),
                paid_days=len([i for i in items if i["status"] == "paid"]),
                total_days=len(items),
            )
        )
    out.sort(key=lambda r: r.total_due, reverse=True)
    return out


class PaymentInput(BaseModel):
    tontine_id: str
    due_date_ids: list[str] = Field(min_length=1)
    method: str = "wave"
    proof_image: str = Field(min_length=10)  # base64 data URL of the Wave receipt
    proof_filename: str = "preuve.jpg"


class PaymentOut(BaseModel):
    id: str
    tontine_id: str
    tontine_name: str
    gerance_id: str
    gerance_name: str
    member_id: str
    member_name: str
    amount: int
    contribution_amount: int
    penalty_amount: int
    days: list[str]
    method: str
    status: str
    proof_filename: str
    created_at: Any
    decided_at: Optional[Any] = None
    decided_by_name: Optional[str] = None


async def _payment_out(p: dict[str, Any]) -> PaymentOut:
    t = await db.tontines.find_one({"id": p["tontine_id"]}, {"_id": 0})
    g = await db.gerances.find_one({"id": p["gerance_id"]}, {"_id": 0})
    u = await db.users.find_one({"id": p["member_id"]}, {"_id": 0})
    decider = await db.users.find_one({"id": p.get("decided_by")}, {"_id": 0}) if p.get("decided_by") else None
    body = {k: v for k, v in p.items() if k not in ("proof_image", "decided_by")}
    return PaymentOut(
        **body,
        tontine_name=t["name"] if t else "—",
        gerance_name=g["name"] if g else "—",
        member_name=f"{u['first_name']} {u['last_name']}" if u else "—",
        decided_by_name=f"{decider['first_name']} {decider['last_name']}" if decider else None,
    )


@router.get("/payment-methods")
async def payment_methods():
    return {"methods": PAYMENT_METHODS, "wave_number": WAVE_NUMBER}


@router.post("/payments", response_model=PaymentOut)
async def submit_payment(payload: PaymentInput, user: dict[str, Any] = Depends(current_user)):
    method = next((m for m in PAYMENT_METHODS if m["code"] == payload.method), None)
    if not method or not method["available"]:
        raise HTTPException(status_code=400, detail="Ce moyen de paiement n'est pas encore disponible")
    tontine = await get_tontine(payload.tontine_id)
    dues = await db.contribution_due_dates.find(
        {"id": {"$in": payload.due_date_ids}, "member_id": user["id"], "tontine_id": tontine["id"]}, {"_id": 0}
    ).to_list(500)
    if len(dues) != len(payload.due_date_ids):
        raise HTTPException(status_code=422, detail="Certaines échéances sélectionnées sont invalides")
    if any(d["status"] in ("paid", "processing") for d in dues):
        raise HTTPException(status_code=409, detail="Certaines échéances sont déjà payées ou en cours de vérification")
    today = today_iso()
    # Amount is computed server-side: the member never types it.
    contribution_amount = sum(d["amount"] for d in dues)
    penalty_amount = sum(late_days(d, today) * int(tontine.get("penalty_per_day", 500)) for d in dues)
    payment = {
        "id": new_id(),
        "tontine_id": tontine["id"],
        "gerance_id": tontine["gerance_id"],
        "member_id": user["id"],
        "amount": contribution_amount + penalty_amount,
        "contribution_amount": contribution_amount,
        "penalty_amount": penalty_amount,
        "days": sorted(d["date"] for d in dues),
        "due_date_ids": payload.due_date_ids,
        "method": payload.method,
        "status": "pending",  # never auto-confirmed: a human verifies the Wave receipt
        "proof_image": payload.proof_image,
        "proof_filename": payload.proof_filename,
        "created_at": now_utc(),
        "decided_at": None,
        "decided_by": None,
    }
    await db.payments.insert_one(payment)
    await db.contribution_due_dates.update_many(
        {"id": {"$in": payload.due_date_ids}},
        {"$set": {"status": "processing", "payment_id": payment["id"], "synced_at": now_utc()}},
    )
    await notify(
        user["id"],
        "Preuve reçue",
        f"Votre paiement de {payment['amount']} FCFA est en attente de vérification.",
        tontine["gerance_id"],
        tontine["id"],
        "payment_submitted",
    )
    gerance = await db.gerances.find_one({"id": tontine["gerance_id"]}, {"_id": 0})
    if gerance:
        await notify(
            gerance["owner_id"],
            "Paiement à vérifier",
            f"{user['first_name']} {user['last_name']} a envoyé une preuve de {payment['amount']} FCFA.",
            tontine["gerance_id"],
            tontine["id"],
            "payment_submitted",
        )
    await audit(user, "payment_submitted", "payment", payment["id"], tontine["gerance_id"])
    payment.pop("_id", None)
    return await _payment_out(payment)


@router.get("/payments", response_model=list[PaymentOut])
async def list_payments(
    user: dict[str, Any] = Depends(current_user),
    gerance_id: Optional[str] = None,
    status: Optional[str] = None,
):
    query = _scope(user, gerance_id, None, None)
    if status:
        query["status"] = status
    rows = await db.payments.find(query, {"_id": 0}).sort("created_at", -1).to_list(1000)
    return [await _payment_out(p) for p in rows]


@router.get("/payments/{payment_id}/proof")
async def payment_proof(payment_id: str, user: dict[str, Any] = Depends(current_user)):
    p = await db.payments.find_one({"id": payment_id}, {"_id": 0})
    if not p:
        raise HTTPException(status_code=404, detail="Paiement introuvable")
    if user["role"] == "member" and p["member_id"] != user["id"]:
        raise HTTPException(status_code=403, detail="Preuve privée")
    if user["role"] == "manager":
        assert_gerance_access(user, p["gerance_id"])
    return {"proof_image": p["proof_image"], "proof_filename": p["proof_filename"]}


class DecidePayment(BaseModel):
    action: str  # validate | reject
    reason: Optional[str] = None


@router.post("/payments/{payment_id}/decide", response_model=PaymentOut)
async def decide_payment(payment_id: str, payload: DecidePayment, user: dict[str, Any] = Depends(require_staff)):
    ensure_permission(user, "verify_payments")
    p = await db.payments.find_one({"id": payment_id}, {"_id": 0})
    if not p:
        raise HTTPException(status_code=404, detail="Paiement introuvable")
    assert_gerance_access(user, p["gerance_id"])
    if p["status"] != "pending":
        raise HTTPException(status_code=409, detail="Ce paiement a déjà été traité")
    tontine = await get_tontine(p["tontine_id"])
    if payload.action == "validate":
        await db.payments.update_one(
            {"id": payment_id},
            {"$set": {"status": "validated", "decided_at": now_utc(), "decided_by": user["id"]}},
        )
        await db.contribution_due_dates.update_many(
            {"id": {"$in": p["due_date_ids"]}},
            {"$set": {"status": "paid", "paid_at": now_utc(), "synced_at": now_utc()}},
        )
        await notify(
            p["member_id"],
            "Paiement validé ✅",
            f"Votre paiement de {p['amount']} FCFA pour la tontine {tontine['name']} a été vérifié et validé. "
            f"Les {len(p['days'])} jours concernés sont maintenant enregistrés comme payés.",
            p["gerance_id"],
            p["tontine_id"],
            "payment_validated",
        )
    elif payload.action == "reject":
        await db.payments.update_one(
            {"id": payment_id},
            {"$set": {"status": "rejected", "decided_at": now_utc(), "decided_by": user["id"],
                      "reason": payload.reason}},
        )
        await db.contribution_due_dates.update_many(
            {"id": {"$in": p["due_date_ids"]}},
            {"$set": {"status": "pending", "payment_id": None, "synced_at": now_utc()}},
        )
        await notify(
            p["member_id"],
            "Paiement rejeté ⚠️",
            "Votre preuve de paiement n'a pas pu être validée. Veuillez vérifier votre paiement et "
            "soumettre une nouvelle preuve.",
            p["gerance_id"],
            p["tontine_id"],
            "payment_rejected",
        )
    else:
        raise HTTPException(status_code=422, detail="Action invalide")
    await audit(user, f"payment_{payload.action}", "payment", payment_id, p["gerance_id"])
    fresh = await db.payments.find_one({"id": payment_id}, {"_id": 0})
    assert fresh is not None
    return await _payment_out(fresh)


class ManualDue(BaseModel):
    due_date_id: str
    status: str  # paid | pending
    note: Optional[str] = None


@router.post("/due-dates/manual")
async def manual_due(payload: ManualDue, user: dict[str, Any] = Depends(require_staff)):
    ensure_permission(user, "record_history")
    if payload.status not in ("paid", "pending"):
        raise HTTPException(status_code=422, detail="Statut invalide")
    due = await db.contribution_due_dates.find_one({"id": payload.due_date_id}, {"_id": 0})
    if not due:
        raise HTTPException(status_code=404, detail="Échéance introuvable")
    assert_gerance_access(user, due["gerance_id"])
    label = "administrateur" if user["role"] == "admin" else "gérant"
    await db.contribution_due_dates.update_one(
        {"id": payload.due_date_id},
        {"$set": {"status": payload.status, "source": f"historique_{label}", "synced_at": now_utc(),
                  "note": payload.note}},
    )
    await audit(user, "due_date_manual", "contribution_due_date", payload.due_date_id, due["gerance_id"],
                {"status": payload.status})
    return {"ok": True, "status": payload.status, "source": f"historique_{label}"}


class PayoutInput(BaseModel):
    position_id: str


class PayoutOut(BaseModel):
    id: str
    tontine_id: str
    tontine_name: str
    gerance_id: str
    gerance_name: str
    member_id: str
    member_name: str
    position_index: int
    payout_date: str
    amount: int
    confirmed_by_name: str
    status: str
    created_at: Any


@router.post("/payouts/confirm", response_model=PayoutOut)
async def confirm_payout(payload: PayoutInput, user: dict[str, Any] = Depends(require_staff)):
    ensure_permission(user, "confirm_payouts")
    pos = await db.positions.find_one({"id": payload.position_id}, {"_id": 0})
    if not pos:
        raise HTTPException(status_code=404, detail="Position introuvable")
    assert_gerance_access(user, pos["gerance_id"])
    if not pos.get("member_id"):
        raise HTTPException(status_code=400, detail="Aucun membre attribué à cette position")
    if await db.payouts.find_one({"position_id": pos["id"]}):
        raise HTTPException(status_code=409, detail="Prise déjà confirmée pour cette position")
    tontine = await get_tontine(pos["tontine_id"])
    doc = {
        "id": new_id(),
        "position_id": pos["id"],
        "tontine_id": tontine["id"],
        "gerance_id": tontine["gerance_id"],
        "member_id": pos["member_id"],
        "position_index": pos["index"],
        "payout_date": pos["payout_date"],
        "amount": int(tontine["payout_amount"]),
        "confirmed_by": user["id"],
        "status": "received",
        "created_at": now_utc(),
    }
    await db.payouts.insert_one(doc)
    await db.positions.update_one({"id": pos["id"]}, {"$set": {"status": "received"}})
    await notify(
        pos["member_id"],
        "Prise confirmée 🎉",
        f"Votre prise de {doc['amount']} FCFA pour {tontine['name']} a été confirmée. Votre reçu est disponible.",
        tontine["gerance_id"],
        tontine["id"],
        "payout_confirmed",
    )
    await audit(user, "payout_confirmed", "payout", doc["id"], tontine["gerance_id"])
    doc.pop("_id", None)
    return await _payout_out(doc, user)


async def _payout_out(p: dict[str, Any], decider: Optional[dict[str, Any]] = None) -> PayoutOut:
    t = await db.tontines.find_one({"id": p["tontine_id"]}, {"_id": 0})
    g = await db.gerances.find_one({"id": p["gerance_id"]}, {"_id": 0})
    u = await db.users.find_one({"id": p["member_id"]}, {"_id": 0})
    c = decider or await db.users.find_one({"id": p["confirmed_by"]}, {"_id": 0})
    body = {k: v for k, v in p.items() if k not in ("position_id", "confirmed_by")}
    return PayoutOut(
        **body,
        tontine_name=t["name"] if t else "—",
        gerance_name=g["name"] if g else "—",
        member_name=f"{u['first_name']} {u['last_name']}" if u else "—",
        confirmed_by_name=f"{c['first_name']} {c['last_name']}" if c else "—",
    )


@router.get("/payouts", response_model=list[PayoutOut])
async def list_payouts(user: dict[str, Any] = Depends(current_user), gerance_id: Optional[str] = None):
    query = _scope(user, gerance_id, None, None)
    rows = await db.payouts.find(query, {"_id": 0}).sort("created_at", -1).to_list(1000)
    return [await _payout_out(p) for p in rows]
