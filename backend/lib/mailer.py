"""Email channel (Resend). Silent, traceable no-op when the API key is not configured.

Every attempt is written to `notification_deliveries` with `channel = "email"`, so the
platform never pretends a message was sent.
"""

import asyncio
import logging
import os
from typing import Any, Optional

from lib.db import db

logger = logging.getLogger(__name__)

# Events that also deserve an email; everything else stays in-app only.
EMAIL_EVENTS = {
    "payment_validated",
    "payment_rejected",
    "payment_recorded_by_staff",
    "payout_confirmed",
    "payout_historical",
    "manual_reminder",
    "morning_reminder",
    "evening_reminder",
    "weekly_report",
    "membership_decided",
    "manager_created",
}


def email_configured() -> bool:
    return bool(os.environ.get("RESEND_API_KEY"))


def sender() -> str:
    return os.environ.get("SENDER_EMAIL", "onboarding@resend.dev")


def _html(platform_name: str, title: str, message: str) -> str:
    body = message.replace("\n", "<br/>")
    return (
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" '
        'style="background:#faf5f7;padding:24px 0;font-family:Helvetica,Arial,sans-serif">'
        '<tr><td align="center"><table role="presentation" width="560" cellpadding="0" cellspacing="0" '
        'style="background:#ffffff;border:1px solid #e7dee3;border-radius:14px;overflow:hidden">'
        f'<tr><td style="background:#b4315c;color:#ffffff;padding:16px 22px;font-size:15px;'
        f'font-weight:bold;letter-spacing:.5px">{platform_name.upper()}</td></tr>'
        f'<tr><td style="padding:22px"><p style="margin:0 0 10px;font-size:17px;color:#1f1a1d">'
        f'<strong>{title}</strong></p>'
        f'<p style="margin:0;font-size:14px;line-height:21px;color:#3d353a">{body}</p></td></tr>'
        f'<tr><td style="padding:14px 22px;background:#faf5f7;font-size:11px;color:#6b6169">'
        f'Message automatique de {platform_name}. Retrouvez le détail dans votre espace.'
        "</td></tr></table></td></tr></table>"
    )


async def _platform_name() -> str:
    doc = await db.platform_settings.find_one({"id": "platform"}, {"_id": 0}) or {}
    return doc.get("name") or "AIDONS-NOUS VIVANTS"


async def send_email(
    to: str,
    title: str,
    message: str,
    *,
    user_id: Optional[str] = None,
    gerance_id: Optional[str] = None,
    tontine_id: Optional[str] = None,
    event: str = "generic",
    dedupe_key: Optional[str] = None,
) -> dict[str, Any]:
    """Send one transactional email and record the delivery. Never raises."""
    from lib.core import new_id, now_utc

    record: dict[str, Any] = {
        "id": new_id(),
        "user_id": user_id,
        "gerance_id": gerance_id,
        "tontine_id": tontine_id,
        "event": event,
        "channel": "email",
        "message": f"{title} — {message}",
        "recipient": to,
        "status": "skipped",
        "error": None,
        "attempts": 0,
        "dedupe_key": dedupe_key,
        "created_at": now_utc(),
    }
    if not to:
        record["error"] = "Aucune adresse email"
    elif not email_configured():
        record["error"] = "RESEND_API_KEY non configurée"
    else:
        if dedupe_key and await db.notification_deliveries.find_one(
            {"dedupe_key": dedupe_key, "channel": "email", "status": "sent"}
        ):
            record["error"] = "Déjà envoyé"
            await db.notification_deliveries.insert_one(dict(record))
            return {"sent": False, "reason": "duplicate"}
        import resend

        resend.api_key = os.environ["RESEND_API_KEY"]
        name = await _platform_name()
        params = {
            "from": sender(),
            "to": [to],
            "subject": f"{name} — {title}",
            "html": _html(name, title, message),
        }
        record["attempts"] = 1
        try:
            # The Resend SDK is synchronous: keep the event loop free.
            sent = await asyncio.to_thread(resend.Emails.send, params)
            record["status"] = "sent"
            record["provider_id"] = (sent or {}).get("id")
        except Exception as exc:  # a failed email must never break the request
            record["status"] = "failed"
            record["error"] = str(exc)[:400]
            logger.warning("Envoi email échoué (%s): %s", to, exc)
    await db.notification_deliveries.insert_one(dict(record))
    return {"sent": record["status"] == "sent", "reason": record["error"]}
