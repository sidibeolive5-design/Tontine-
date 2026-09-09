"""Domain helpers shared by the routers: scoping, notifications, audit, schedules."""

import uuid
from datetime import date, datetime, timedelta, timezone
from typing import Any, Optional

from fastapi import HTTPException

from lib.db import db

PENALTY_PER_DAY_DEFAULT = 500


def new_id() -> str:
    return str(uuid.uuid4())


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def parse_date(value: str) -> date:
    return datetime.strptime(value, "%Y-%m-%d").date()


async def notify(
    user_id: str,
    title: str,
    message: str,
    gerance_id: Optional[str] = None,
    tontine_id: Optional[str] = None,
    event: str = "generic",
) -> None:
    await db.notifications.insert_one(
        {
            "id": new_id(),
            "user_id": user_id,
            "gerance_id": gerance_id,
            "tontine_id": tontine_id,
            "event": event,
            "title": title,
            "message": message,
            "read": False,
            "created_at": now_utc(),
        }
    )
    await db.notification_deliveries.insert_one(
        {
            "id": new_id(),
            "user_id": user_id,
            "gerance_id": gerance_id,
            "tontine_id": tontine_id,
            "event": event,
            "channel": "in_app",
            "message": message,
            "status": "delivered",
            "error": None,
            "attempts": 1,
            "created_at": now_utc(),
        }
    )


async def audit(actor: dict[str, Any], action: str, entity: str, entity_id: str, gerance_id: Optional[str] = None,
                details: Optional[dict[str, Any]] = None) -> None:
    await db.audit_logs.insert_one(
        {
            "id": new_id(),
            "actor_id": actor["id"],
            "actor_name": f"{actor.get('first_name', '')} {actor.get('last_name', '')}".strip(),
            "actor_role": actor.get("role"),
            "action": action,
            "entity": entity,
            "entity_id": entity_id,
            "gerance_id": gerance_id,
            "details": details or {},
            "created_at": now_utc(),
        }
    )


async def get_tontine(tontine_id: str) -> dict[str, Any]:
    tontine = await db.tontines.find_one({"id": tontine_id}, {"_id": 0})
    if not tontine:
        raise HTTPException(status_code=404, detail="Tontine introuvable")
    return tontine


def assert_gerance_access(user: dict[str, Any], gerance_id: str) -> None:
    """Admin supervises everything; a manager only touches his own gérance."""
    if user["role"] == "admin":
        return
    if user.get("gerance_id") != gerance_id:
        raise HTTPException(status_code=403, detail="Cette donnée appartient à une autre gérance")


async def admin_gerance_id() -> Optional[str]:
    gerance = await db.gerances.find_one({"is_admin_gerance": True}, {"_id": 0})
    return gerance["id"] if gerance else None


def position_dates(start: date, interval_days: int, count: int) -> list[str]:
    return [(start + timedelta(days=interval_days * (i + 1))).isoformat() for i in range(count)]


async def generate_due_dates(tontine: dict[str, Any], member_id: str) -> int:
    """One row per day of the tontine for this member — the single source of truth."""
    existing = await db.contribution_due_dates.count_documents(
        {"tontine_id": tontine["id"], "member_id": member_id}
    )
    if existing:
        return 0
    start = parse_date(tontine["start_date"])
    rows = []
    for i in range(int(tontine["duration_days"])):
        rows.append(
            {
                "id": new_id(),
                "tontine_id": tontine["id"],
                "gerance_id": tontine["gerance_id"],
                "member_id": member_id,
                "date": (start + timedelta(days=i)).isoformat(),
                "deadline_time": tontine.get("deadline_time", "18:00"),
                "amount": int(tontine["daily_amount"]),
                "period": i + 1,
                "status": "pending",
                "payment_id": None,
                "source": "system",
                "created_at": now_utc(),
                "synced_at": now_utc(),
            }
        )
    if rows:
        await db.contribution_due_dates.insert_many(rows)
    return len(rows)


async def enroll_member(tontine: dict[str, Any], member_id: str) -> None:
    """Add a member to a tontine directly: membership row + schedule + contract."""
    await db.tontine_members.update_one(
        {"tontine_id": tontine["id"], "member_id": member_id},
        {
            "$set": {"status": "active", "gerance_id": tontine["gerance_id"]},
            "$setOnInsert": {"id": new_id(), "joined_at": now_utc()},
        },
        upsert=True,
    )
    await generate_due_dates(tontine, member_id)
    if not await db.contracts.find_one({"tontine_id": tontine["id"], "member_id": member_id}):
        await db.contracts.insert_one(
            {
                "id": new_id(),
                "tontine_id": tontine["id"],
                "gerance_id": tontine["gerance_id"],
                "member_id": member_id,
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


def effective_status(due: dict[str, Any], today: str) -> str:
    if due["status"] in ("paid", "processing"):
        return due["status"]
    if due["date"] < today:
        return "late"
    if due["date"] == today:
        return "due_today"
    return "pending"


def late_days(due: dict[str, Any], today: str) -> int:
    """Number of days elapsed since the deadline of this due date (0 if not late).

    A due date is only late from the DAY AFTER its own date: an échéance dated
    10 Sept is still "à payer" on the 10th and starts counting on the 11th.
    """
    if due["status"] in ("paid", "processing") or due["date"] >= today:
        return 0
    return (parse_date(today) - parse_date(due["date"])).days


def penalty_amount(due: dict[str, Any], today: str, penalty_per_day: int = PENALTY_PER_DAY_DEFAULT) -> int:
    """One flat penalty per unpaid day once its deadline has passed — it does not compound.

    Spec reference: 5 jours de retard à 3 150 FCFA => 15 750 FCFA de cotisations
    + 2 500 FCFA de pénalités (= 5 x 500), not 500 per day per missed day.
    """
    return penalty_per_day if late_days(due, today) > 0 else 0
