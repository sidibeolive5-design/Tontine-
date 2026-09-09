"""tscheck: cohérence du calcul de pénalité entre toutes les vues — le même
montant apparaît côté membre (résumé + échéances) et côté gérant (arrears +
tableau de résumé), pour le même membre.
"""

import httpx
import pytest

from .conftest import api_url

MANAGER_EMAIL = "qa.penal@anv.ci"
MANAGER_PASSWORD = "Passer123"
MEMBER_EMAIL = "qa.kone@anv.ci"
MEMBER_PASSWORD = "Passer123"
KONE_MEMBER_ID = "0a98969c-6e33-4e8c-b84d-a9be0f96319a"
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


def test_penalty_amount_matches_between_manager_arrears_and_member_summary(manager_client, member_client):
    r_arrears = manager_client.get("/arrears")
    assert r_arrears.status_code == 200, f"GET /arrears -> {r_arrears.status_code} {r_arrears.text}"
    arrears_rows = [row for row in r_arrears.json() if row["member_id"] == KONE_MEMBER_ID]
    assert len(arrears_rows) == 1
    manager_penalty = arrears_rows[0]["penalties"]
    manager_late_days = arrears_rows[0]["late_days"]

    r_summary = member_client.get("/summary")
    assert r_summary.status_code == 200, f"GET /summary (member) -> {r_summary.status_code} {r_summary.text}"
    summary_rows = [row for row in r_summary.json() if row["tontine_id"] == TONTINE_ID]
    assert len(summary_rows) == 1
    member_penalty = summary_rows[0]["penalties"]

    assert manager_penalty == member_penalty == 3000, (
        f"penalty must match across manager arrears ({manager_penalty}) and member "
        f"summary ({member_penalty}); expected 3000 FCFA for both"
    )

    r_due = member_client.get("/due-dates")
    assert r_due.status_code == 200, f"GET /due-dates (member) -> {r_due.status_code} {r_due.text}"
    member_late_rows = [row for row in r_due.json() if row["display_status"] == "late"]
    member_total_penalty = sum(row["penalty"] for row in member_late_rows)
    assert member_total_penalty == manager_penalty, (
        f"sum of per-day penalties on member's due-dates ({member_total_penalty}) must equal "
        f"the manager arrears total ({manager_penalty})"
    )
    assert len(member_late_rows) == manager_late_days
