"""tscheck: cloisonnement des gérances pour la nouvelle gérance "Gérance QA
Penal" — le gérant qa.penal@anv.ci ne voit dans Retards / Cotisations /
Prises que les données de sa propre gérance, même en manipulant le paramètre
`gerance_id`.
"""

import httpx
import pytest

from .conftest import api_url

MANAGER_EMAIL = "qa.penal@anv.ci"
MANAGER_PASSWORD = "Passer123"
FOREIGN_GERANCE_ID = "tscheck-foreign-gerance-does-not-exist"


@pytest.fixture
def manager_client():
    with httpx.Client(base_url=api_url(), timeout=30.0) as c:
        r = c.post("/auth/login", json={"email": MANAGER_EMAIL, "password": MANAGER_PASSWORD})
        assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
        me = r.json()
        assert me.get("gerance_id"), "manager fixture account has no gerance_id"
        yield c, me["gerance_id"]


def test_arrears_scoped_to_own_gerance_even_with_override(manager_client):
    client, own_gerance_id = manager_client

    r = client.get("/arrears")
    assert r.status_code == 200, f"GET /arrears -> {r.status_code} {r.text}"
    rows = r.json()
    assert len(rows) > 0, "expected the seeded QA Penal arrears rows"
    assert all(row["gerance_id"] == own_gerance_id for row in rows), (
        "arrears leaked rows outside the manager's own gerance: "
        f"{[row['gerance_id'] for row in rows if row['gerance_id'] != own_gerance_id]}"
    )

    r2 = client.get("/arrears", params={"gerance_id": FOREIGN_GERANCE_ID})
    assert r2.status_code == 200, f"GET /arrears?gerance_id=foreign -> {r2.status_code} {r2.text}"
    rows2 = r2.json()
    assert len(rows2) == len(rows), (
        "manager was able to change arrears scope via gerance_id query param "
        f"(got {len(rows2)} rows instead of {len(rows)})"
    )


def test_payouts_scoped_to_own_gerance_even_with_override(manager_client):
    client, own_gerance_id = manager_client

    r = client.get("/payouts")
    assert r.status_code == 200, f"GET /payouts -> {r.status_code} {r.text}"
    rows = r.json()
    assert len(rows) > 0, "expected the seeded QA Penal historical payouts"
    assert all(row["gerance_id"] == own_gerance_id for row in rows), (
        "payouts leaked rows outside the manager's own gerance: "
        f"{[row['gerance_id'] for row in rows if row['gerance_id'] != own_gerance_id]}"
    )

    r2 = client.get("/payouts", params={"gerance_id": FOREIGN_GERANCE_ID})
    assert r2.status_code == 200, f"GET /payouts?gerance_id=foreign -> {r2.status_code} {r2.text}"
    rows2 = r2.json()
    assert len(rows2) == len(rows)


def test_due_dates_scoped_to_own_gerance_even_with_override(manager_client):
    client, own_gerance_id = manager_client

    r = client.get("/due-dates")
    assert r.status_code == 200, f"GET /due-dates -> {r.status_code} {r.text}"
    rows = r.json()
    assert len(rows) > 0, "expected the seeded QA Penal due-dates"
    assert all(row["gerance_id"] == own_gerance_id for row in rows)

    r2 = client.get("/due-dates", params={"gerance_id": FOREIGN_GERANCE_ID})
    assert r2.status_code == 200, f"GET /due-dates?gerance_id=foreign -> {r2.status_code} {r2.text}"
    assert len(r2.json()) == len(rows)
