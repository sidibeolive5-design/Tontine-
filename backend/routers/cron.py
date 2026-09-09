"""Scheduled work: the daily contribution reminder before the deadline."""

import os
import secrets
from typing import Any

from fastapi import APIRouter, BackgroundTasks, Header, HTTPException, Request

from lib.core import effective_status, late_days, new_id, notify, now_utc
from lib.dates import today_iso
from lib.db import db

router = APIRouter()


def _authorise(authorization: str | None) -> None:
    expected = os.environ.get("WEBHOOK_CRON_SECRET", "")
    if not expected or not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Non autorisé")
    if not secrets.compare_digest(authorization.removeprefix("Bearer ").strip(), expected):
        raise HTTPException(status_code=401, detail="Non autorisé")


async def _send_daily_reminders(run_id: str) -> None:
    """One notification per member per day: today's due amount + any arrears."""
    today = today_iso()
    dues = await db.contribution_due_dates.find(
        {"date": {"$lte": today}, "status": {"$in": ["pending"]}}, {"_id": 0}
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
        # Anti-duplication: one reminder per member, per tontine, per day.
        marker = f"reminder:{member_id}:{tontine_id}:{today}"
        existing = await db.notification_deliveries.find_one({"dedupe_key": marker})
        if existing:
            continue
        penalty_per_day = int(tontine.get("penalty_per_day", 500))
        due_today = [r for r in rows if r["date"] == today]
        late = [r for r in rows if effective_status(r, today) == "late"]
        penalties = sum(late_days(r, today) * penalty_per_day for r in late)
        parts = []
        if due_today:
            amount = sum(r["amount"] for r in due_today)
            parts.append(f"{amount} FCFA à régler avant {tontine.get('deadline_time', '18:00')}")
        if late:
            total_late = sum(r["amount"] for r in late)
            parts.append(f"{len(late)} jour(s) en retard ({total_late} FCFA + {penalties} FCFA de pénalités)")
        if not parts:
            continue
        await notify(
            member_id,
            "Rappel de cotisation",
            f"{tontine['name']} : " + " · ".join(parts) + ".",
            tontine["gerance_id"],
            tontine_id,
            "daily_reminder",
        )
        await db.notification_deliveries.update_one(
            {"dedupe_key": marker},
            {
                "$set": {
                    "id": new_id(),
                    "dedupe_key": marker,
                    "user_id": member_id,
                    "gerance_id": tontine["gerance_id"],
                    "tontine_id": tontine_id,
                    "event": "daily_reminder",
                    "channel": "in_app",
                    "message": " · ".join(parts),
                    "status": "delivered",
                    "error": None,
                    "attempts": 1,
                    "run_id": run_id,
                    "created_at": now_utc(),
                }
            },
            upsert=True,
        )


@router.post("/cron/daily-reminders")
async def daily_reminders(
    request: Request,
    background: BackgroundTasks,
    authorization: str | None = Header(default=None),
):
    # Cron endpoints must ack 2xx immediately; enqueue/background the actual work.
    _authorise(authorization)
    try:
        envelope = await request.json()
    except Exception:
        envelope = {}
    if not isinstance(envelope, dict):
        raise HTTPException(status_code=400, detail="Enveloppe invalide")
    run_id = request.headers.get("X-Webhook-Id") or envelope.get("run_id") or new_id()
    if await db.cron_runs.find_one({"run_id": run_id}):
        return {"accepted": True, "duplicate": True, "run_id": run_id}
    await db.cron_runs.insert_one(
        {"id": new_id(), "run_id": run_id, "job": "daily-reminders", "created_at": now_utc()}
    )
    background.add_task(_send_daily_reminders, run_id)
    return {"accepted": True, "run_id": run_id}
