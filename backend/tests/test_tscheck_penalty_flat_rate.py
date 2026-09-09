"""tscheck: les pénalités de retard sont un montant fixe de 500 FCFA par jour
impayé (jamais cumulatif) et l'échéance du jour n'est jamais pénalisée avant
le lendemain.

Couvre le critère : "CORRECTION SIGNALÉE PAR L'UTILISATEUR — les pénalités ne
commencent que le lendemain de l'échéance et ne se cumulent pas". Vérifié pour
qa.kone@anv.ci (6 jours impayés -> 3000 FCFA, jamais 500+1000+1500+...).
"""

import httpx
import pytest

from .conftest import api_url

MANAGER_EMAIL = "qa.penal@anv.ci"
MANAGER_PASSWORD = "Passer123"
KONE_MEMBER_ID = "0a98969c-6e33-4e8c-b84d-a9be0f96319a"
KONE_EMAIL = "qa.kone@anv.ci"


@pytest.fixture
def manager_client():
    with httpx.Client(base_url=api_url(), timeout=30.0) as c:
        r = c.post("/auth/login", json={"email": MANAGER_EMAIL, "password": MANAGER_PASSWORD})
        assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
        yield c


def test_due_dates_penalty_is_flat_500_never_cumulative(manager_client):
    r = manager_client.get("/due-dates")
    assert r.status_code == 200, f"GET /due-dates -> {r.status_code} {r.text}"
    rows = [row for row in r.json() if row["member_id"] == KONE_MEMBER_ID]
    assert rows, "expected qa.kone due-dates to be present"

    late_rows = [row for row in rows if row["display_status"] == "late"]
    today_rows = [row for row in rows if row["display_status"] == "due_today"]

    assert len(late_rows) == 6, f"expected exactly 6 late rows for qa.kone, got {len(late_rows)}"
    assert all(row["penalty"] == 500 for row in late_rows), (
        f"penalty must be flat 500 FCFA per late day, never cumulative: "
        f"{[(row['date'], row['penalty']) for row in late_rows]}"
    )

    assert len(today_rows) == 1, f"expected exactly 1 due_today row, got {len(today_rows)}"
    assert today_rows[0]["penalty"] == 0, (
        f"today's due date must carry 0 FCFA penalty (not penalized before the next day), "
        f"got {today_rows[0]['penalty']}"
    )


def test_arrears_total_penalty_is_500_times_late_days(manager_client):
    r = manager_client.get("/arrears")
    assert r.status_code == 200, f"GET /arrears -> {r.status_code} {r.text}"
    rows = [row for row in r.json() if row["member_id"] == KONE_MEMBER_ID]
    assert len(rows) == 1, f"expected exactly one arrears row for qa.kone, got {len(rows)}"
    row = rows[0]
    assert row["late_days"] == 6, f"expected 6 late days for qa.kone, got {row['late_days']}"
    assert row["penalties"] == 3000, (
        f"expected penalties = 6 * 500 = 3000 FCFA (flat rate), got {row['penalties']} "
        "(a cumulative/tiered bug would produce 500+1000+1500+2000+2500+3000=10500)"
    )
