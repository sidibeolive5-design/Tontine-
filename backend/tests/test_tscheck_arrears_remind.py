"""tscheck: relance d'un membre en retard — POST /api/arrears/remind crée une
notification "Relance de votre gérance" contenant le message saisi ET le
récapitulatif en FCFA (jours impayés + total dû), lisible côté membre.
"""

import httpx
import pytest

from .conftest import api_url

MANAGER_EMAIL = "qa.penal@anv.ci"
MANAGER_PASSWORD = "Passer123"
MEMBER_EMAIL = "qa.awa@anv.ci"
MEMBER_PASSWORD = "Passer123"
AWA_MEMBER_ID = "d6b28219-188a-49ca-a569-836a0da1deac"
TONTINE_ID = "e19cbe9c-5ffe-4211-bf42-f259794b4d0c"


@pytest.fixture
def manager_client():
    with httpx.Client(base_url=api_url(), timeout=30.0) as c:
        r = c.post("/auth/login", json={"email": MANAGER_EMAIL, "password": MANAGER_PASSWORD})
        assert r.status_code == 200, f"manager login failed: {r.status_code} {r.text}"
        yield c


@pytest.fixture
def member_client():
    with httpx.Client(base_url=api_url(), timeout=30.0) as c:
        r = c.post("/auth/login", json={"email": MEMBER_EMAIL, "password": MEMBER_PASSWORD})
        assert r.status_code == 200, f"member login failed: {r.status_code} {r.text}"
        yield c


def test_remind_creates_member_notification_with_message_and_fcfa_recap(manager_client, member_client):
    marker = "tscheck-remind-api-marker-please-pay-soon"
    r = manager_client.post(
        "/arrears/remind",
        json={"member_id": AWA_MEMBER_ID, "tontine_id": TONTINE_ID, "message": marker},
    )
    assert r.status_code == 200, f"POST /arrears/remind -> {r.status_code} {r.text}"

    r_notif = member_client.get("/notifications")
    assert r_notif.status_code == 200, f"GET /notifications (member) -> {r_notif.status_code} {r_notif.text}"
    notifs = r_notif.json()
    matching = [n for n in notifs if marker in (n.get("body") or n.get("message") or "")]
    assert matching, (
        f"expected a notification containing the reminder marker for awa; "
        f"got bodies: {[n.get('body') or n.get('message') for n in notifs][:5]}"
    )
    notif = matching[0]
    haystack = (notif.get("title") or "") + " " + (notif.get("body") or notif.get("message") or "")
    assert "elance" in haystack.lower() and "rance" in haystack.lower(), (
        f"notification should reference 'Relance de votre gérance', got: {haystack}"
    )
    assert "FCFA" in haystack, f"notification must include the FCFA recap, got: {haystack}"
