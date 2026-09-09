"""tscheck: enregistrement d'une prise déjà versée avant l'arrivée sur la
plateforme — POST /api/payouts/historical enregistre la prise (source
historique), notifie le membre, et refuse un second enregistrement sur la
même position (409).

Isolation: crée sa propre tontine à 1 position pour ne jamais toucher les
positions déjà servies de "QA Penal 3150".
"""

import time

import httpx
import pytest

from .conftest import api_url

MANAGER_EMAIL = "qa.penal@anv.ci"
MANAGER_PASSWORD = "Passer123"
MEMBER_PASSWORD = "Passer123"


@pytest.fixture
def manager_client():
    with httpx.Client(base_url=api_url(), timeout=30.0) as c:
        r = c.post("/auth/login", json={"email": MANAGER_EMAIL, "password": MANAGER_PASSWORD})
        assert r.status_code == 200, f"manager login failed: {r.status_code} {r.text}"
        yield c


def test_historical_payout_recorded_notifies_member_and_rejects_duplicate(manager_client):
    suffix = str(int(time.time() * 1000))
    tontine_name = f"tscheck-histpos-api-{suffix}"
    member_email = f"tscheck-histpos-api-{suffix}@anv.ci"

    r_t = manager_client.post(
        "/tontines",
        json={
            "name": tontine_name,
            "member_count": 1,
            "daily_amount": 1000,
            "payout_amount": 30000,
            "interval_days": 30,
            "beneficiary_count": 1,
            "duration_days": 30,
            "start_date": "2026-09-01",
        },
    )
    assert r_t.status_code == 200, f"POST /tontines -> {r_t.status_code} {r_t.text}"
    tontine_id = r_t.json()["id"]

    r_m = manager_client.post(
        "/members/create",
        json={
            "first_name": "Tscheck",
            "last_name": "HistposApi",
            "email": member_email,
            "password": MEMBER_PASSWORD,
            "tontine_id": tontine_id,
        },
    )
    assert r_m.status_code == 200, f"POST /members/create -> {r_m.status_code} {r_m.text}"

    r_pos = manager_client.get(f"/tontines/{tontine_id}/positions")
    assert r_pos.status_code == 200, f"GET positions -> {r_pos.status_code} {r_pos.text}"
    positions = r_pos.json()
    assert len(positions) == 1, f"expected exactly 1 position for this isolated tontine, got {len(positions)}"
    position_id = positions[0]["id"]

    r_members = manager_client.get("/members")
    member_row = next(m for m in r_members.json() if m["email"] == member_email)
    member_id = member_row["id"]

    r_assign = manager_client.patch(f"/positions/{position_id}/assign", json={"member_id": member_id})
    assert r_assign.status_code == 200, f"PATCH assign -> {r_assign.status_code} {r_assign.text}"

    r_hist = manager_client.post(
        "/payouts/historical",
        json={"position_id": position_id, "payout_date": "2026-08-15", "amount": 27500, "note": "tscheck fixture"},
    )
    assert r_hist.status_code == 200, f"POST /payouts/historical -> {r_hist.status_code} {r_hist.text}"
    payout = r_hist.json()
    assert payout["status"] == "received"
    assert "historique" in (payout.get("source") or "").lower()

    # member gets a notification about the historical payout
    with httpx.Client(base_url=api_url(), timeout=30.0) as member_client:
        r_login = member_client.post("/auth/login", json={"email": member_email, "password": MEMBER_PASSWORD})
        assert r_login.status_code == 200, f"member login failed: {r_login.status_code} {r_login.text}"
        r_notif = member_client.get("/notifications")
        assert r_notif.status_code == 200
        bodies = [(n.get("title") or "") + " " + (n.get("body") or n.get("message") or "") for n in r_notif.json()]
        assert any("historique" in b.lower() for b in bodies), (
            f"expected a 'Prise historique enregistrée' notification, got: {bodies}"
        )

    # a second recording on the same position must be refused
    r_hist2 = manager_client.post(
        "/payouts/historical",
        json={"position_id": position_id, "payout_date": "2026-08-16", "amount": 27500},
    )
    assert r_hist2.status_code == 409, (
        f"expected 409 on duplicate historical payout for an already-served position, "
        f"got {r_hist2.status_code} {r_hist2.text}"
    )
