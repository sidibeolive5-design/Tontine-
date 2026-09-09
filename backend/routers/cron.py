"""Scheduled work: the morning contribution reminder and the evening deadline reminder."""

import os
import secrets
from typing import Any, Literal

from fastapi import APIRouter, BackgroundTasks, Header, HTTPException, Request

from lib.core import effective_status, late_days, new_id, notify, now_utc
from lib.dates import today_iso
from lib.db import db

router = APIRouter()

Slot = Literal["morning", "evening"]


def _authorise(authorization: str | None) -> None:
    expected = os.environ.get("WEBHOOK_CRON_SECRET", "")
    if not expected or not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Non autorisé")
    if not secrets.compare_digest(authorization.removeprefix("Bearer ").strip(), expected):
        raise HTTPException(status_code=401, detail="Non autorisé")


async def _send_reminders(run_id: str, slot: Slot) -> None:
    """morning: today's amount + arrears. evening: only members whose day is still unpaid."""
    today = today_iso()
    dues = await db.contribution_due_dates.find(
        {"date": {"$lte": today}, "status": "pending"},
        {"_id": 0, "member_id": 1, "tontine_id": 1, "date": 1, "amount": 1, "status": 1},
    ).to_list(50000)
    if not dues:
        return
    grouped: dict[tuple[str, str], list[dict[str, Any]]] = {}
    for d in dues:
        grouped.setdefault((d["member_id"], d["tontine_id"]), []).append(d)

    for (member_id, tontine_id), rows in grouped.items():
        tontine = await db.tontines.find_one({"id": tontine_id}, {"_id": 0})
        if not tontine or tontine["status"] not in ("open", "running"):
            continue
        deadline = tontine.get("deadline_time", "18:00")
        penalty_per_day = int(tontine.get("penalty_per_day", 500))
        due_today = [r for r in rows if r["date"] == today]
        late = [r for r in rows if effective_status(r, today) == "late"]
        penalties = sum(late_days(r, today) * penalty_per_day for r in late)

        if slot == "evening":
            # Evening pass is only about today's unpaid day, before the deadline bites.
            if not due_today:
                continue
            title = "Dernier rappel avant l'heure limite"
            amount = sum(r["amount"] for r in due_today)
            message = (
                f"{tontine['name']} : il vous reste {amount} FCFA à régler avant {deadline} aujourd'hui. "
                f"Passé cette heure, une pénalité de {penalty_per_day} FCFA par jour de retard s'applique."
            )
        else:
            parts = []
            if due_today:
                parts.append(f"{sum(r['amount'] for r in due_today)} FCFA à régler avant {deadline}")
            if late:
                parts.append(
                    f"{len(late)} jour(s) en retard ({sum(r['amount'] for r in late)} FCFA "
                    f"+ {penalties} FCFA de pénalités)"
                )
            if not parts:
                continue
            title = "Rappel de cotisation"
            message = f"{tontine['name']} : " + " · ".join(parts) + "."

        # Anti-duplication: one reminder per member, per tontine, per slot, per day.
        marker = f"reminder:{slot}:{member_id}:{tontine_id}:{today}"
        if await db.notification_deliveries.find_one({"dedupe_key": marker}):
            continue
        await notify(member_id, title, message, tontine["gerance_id"], tontine_id, f"{slot}_reminder")
        await db.notification_deliveries.update_one(
            {"dedupe_key": marker},
            {
                "$set": {
                    "id": new_id(),
                    "dedupe_key": marker,
                    "user_id": member_id,
                    "gerance_id": tontine["gerance_id"],
                    "tontine_id": tontine_id,
                    "event": f"{slot}_reminder",
                    "channel": "in_app",
                    "message": message,
                    "status": "delivered",
                    "error": None,
                    "attempts": 1,
                    "run_id": run_id,
                    "created_at": now_utc(),
                }
            },
            upsert=True,
        )


async def _accept(request: Request, background: BackgroundTasks, authorization: str | None, slot: Slot) -> dict[str, Any]:
    # Cron endpoints must ack 2xx immediately; enqueue/background the actual work.
    _authorise(authorization)
    try:
        envelope = await request.json()
    except Exception:
        envelope = {}
    if not isinstance(envelope, dict):
        raise HTTPException(status_code=400, detail="Enveloppe invalide")
    run_id = request.headers.get("X-Webhook-Id") or envelope.get("run_id") or new_id()
    if await db.cron_runs.find_one({"run_id": run_id, "job": slot}):
        return {"accepted": True, "duplicate": True, "run_id": run_id}
    await db.cron_runs.insert_one(
        {"id": new_id(), "run_id": run_id, "job": slot, "created_at": now_utc()}
    )
    background.add_task(_send_reminders, run_id, slot)
    return {"accepted": True, "run_id": run_id, "slot": slot}


@router.post("/cron/daily-reminders")
async def daily_reminders(
    request: Request,
    background: BackgroundTasks,
    authorization: str | None = Header(default=None),
):
    return await _accept(request, background, authorization, "morning")


@router.post("/cron/evening-reminders")
async def evening_reminders(
    request: Request,
    background: BackgroundTasks,
    authorization: str | None = Header(default=None),
):
    return await _accept(request, background, authorization, "evening")
