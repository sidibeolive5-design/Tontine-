"""Shared Mongo handle — import `client`/`db` from here (server.py, routers, seed.py)."""

import logging
import os
from pathlib import Path

from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient
from pymongo import ASCENDING, DESCENDING, IndexModel

load_dotenv(Path(__file__).parent.parent / ".env")

mongo_url = os.environ["MONGO_URL"]
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ["DB_NAME"]]

logger = logging.getLogger(__name__)

# One entry per collection: every field a route filters, sorts, or dedupes on. Applied by ensure_indexes() at startup.
INDEXES: dict[str, list[IndexModel]] = {
    "status_checks": [IndexModel([("timestamp", DESCENDING)], name="timestamp_desc")],
    "users": [
        IndexModel([("id", ASCENDING)], name="id", unique=True),
        IndexModel([("email", ASCENDING)], name="email", unique=True),
        IndexModel([("role", ASCENDING)], name="role"),
    ],
    "gerances": [IndexModel([("id", ASCENDING)], name="id", unique=True)],
    "manager_requests": [
        IndexModel([("id", ASCENDING)], name="id", unique=True),
        IndexModel([("email", ASCENDING), ("status", ASCENDING)], name="email_status"),
        IndexModel([("created_at", DESCENDING)], name="created_desc"),
    ],
    "tontines": [
        IndexModel([("id", ASCENDING)], name="id", unique=True),
        IndexModel([("gerance_id", ASCENDING), ("status", ASCENDING)], name="gerance_status"),
    ],
    "positions": [
        IndexModel([("id", ASCENDING)], name="id", unique=True),
        IndexModel([("tontine_id", ASCENDING), ("index", ASCENDING)], name="tontine_index"),
    ],
    "membership_requests": [
        IndexModel([("id", ASCENDING)], name="id", unique=True),
        IndexModel([("gerance_id", ASCENDING), ("created_at", DESCENDING)], name="gerance_created"),
        IndexModel([("member_id", ASCENDING), ("tontine_id", ASCENDING)], name="member_tontine"),
    ],
    "tontine_members": [
        IndexModel([("tontine_id", ASCENDING), ("member_id", ASCENDING)], name="tontine_member", unique=True),
        IndexModel([("gerance_id", ASCENDING)], name="gerance"),
    ],
    "contracts": [IndexModel([("tontine_id", ASCENDING), ("member_id", ASCENDING)], name="tontine_member")],
    "contribution_due_dates": [
        IndexModel([("id", ASCENDING)], name="id", unique=True),
        IndexModel([("member_id", ASCENDING), ("tontine_id", ASCENDING), ("date", ASCENDING)], name="member_day"),
        IndexModel([("gerance_id", ASCENDING), ("status", ASCENDING)], name="gerance_status"),
    ],
    "payments": [
        IndexModel([("id", ASCENDING)], name="id", unique=True),
        IndexModel([("gerance_id", ASCENDING), ("created_at", DESCENDING)], name="gerance_created"),
        IndexModel([("member_id", ASCENDING), ("created_at", DESCENDING)], name="member_created"),
    ],
    "payouts": [IndexModel([("position_id", ASCENDING)], name="position", unique=True)],
    "notifications": [IndexModel([("user_id", ASCENDING), ("created_at", DESCENDING)], name="user_created")],
    "audit_logs": [IndexModel([("created_at", DESCENDING)], name="created_desc")],
    "invitations": [
        IndexModel([("token", ASCENDING)], name="token", unique=True),
        IndexModel([("gerance_id", ASCENDING), ("created_at", DESCENDING)], name="gerance_created"),
    ],
}


async def ensure_indexes() -> None:
    for collection, models in INDEXES.items():
        for model in models:  # one at a time so a bad spec skips only itself
            try:
                await db[collection].create_indexes([model])
            except Exception as exc:  # never block boot on an index; the log line names what to fix
                logger.error("ensure_indexes(%s.%s): %s", collection, model.document["name"], exc)
