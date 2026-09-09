from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from lib.auth import current_user
from lib.db import db

router = APIRouter()


class NotificationOut(BaseModel):
    id: str
    user_id: str
    gerance_id: Optional[str] = None
    tontine_id: Optional[str] = None
    event: str
    title: str
    message: str
    read: bool
    created_at: Any


@router.get("/notifications", response_model=list[NotificationOut])
async def list_notifications(user: dict[str, Any] = Depends(current_user)):
    rows = await db.notifications.find({"user_id": user["id"]}, {"_id": 0}).sort("created_at", -1).to_list(300)
    return [NotificationOut(**r) for r in rows]


@router.post("/notifications/{notification_id}/read")
async def mark_read(notification_id: str, user: dict[str, Any] = Depends(current_user)):
    res = await db.notifications.update_one(
        {"id": notification_id, "user_id": user["id"]}, {"$set": {"read": True}}
    )
    if not res.matched_count:
        raise HTTPException(status_code=404, detail="Notification introuvable")
    return {"ok": True}


@router.post("/notifications/read-all")
async def mark_all_read(user: dict[str, Any] = Depends(current_user)):
    await db.notifications.update_many({"user_id": user["id"]}, {"$set": {"read": True}})
    return {"ok": True}


@router.get("/deliveries")
async def deliveries(user: dict[str, Any] = Depends(current_user)):
    if user["role"] == "admin":
        query: dict[str, Any] = {}
    elif user["role"] == "manager":
        query = {"gerance_id": user.get("gerance_id")}
    else:
        query = {"user_id": user["id"]}
    return await db.notification_deliveries.find(query, {"_id": 0}).sort("created_at", -1).to_list(200)
