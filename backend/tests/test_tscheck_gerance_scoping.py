"""tscheck: cloisonnement des gérances — un gérant ne doit jamais voir les données
d'une autre gérance, même en manipulant le paramètre `gerance_id` de la requête.

Couvre le critère : "Le gérant qa.feat@anv.ci ne voit dans ses onglets
Paiements / Cotisations / Membres que des données de la gérance « Gérance QA Feat »".
"""

import httpx
import pytest

from .conftest import api_url

MANAGER_EMAIL = "qa.feat@anv.ci"
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


def test_due_dates_scoped_to_own_gerance_even_with_override(manager_client):
    client, own_gerance_id = manager_client

    r = client.get("/due-dates")
    assert r.status_code == 200, f"GET /due-dates -> {r.status_code} {r.text}"
    rows = r.json()
    assert len(rows) > 0, "expected the seeded QA Feat 3150 dues to be present"
    assert all(row["gerance_id"] == own_gerance_id for row in rows), (
        "due-dates leaked rows outside the manager's own gerance: "
        f"{[row['gerance_id'] for row in rows if row['gerance_id'] != own_gerance_id]}"
    )

    # Attempting to override the scope with a foreign gerance_id must be ignored server-side.
    r2 = client.get("/due-dates", params={"gerance_id": FOREIGN_GERANCE_ID})
    assert r2.status_code == 200, f"GET /due-dates?gerance_id=foreign -> {r2.status_code} {r2.text}"
    rows2 = r2.json()
    assert len(rows2) == len(rows), (
        "manager was able to change scope via gerance_id query param "
        f"(got {len(rows2)} rows instead of {len(rows)})"
    )
    assert all(row["gerance_id"] == own_gerance_id for row in rows2)


def test_payments_scoped_to_own_gerance_even_with_override(manager_client):
    client, own_gerance_id = manager_client

    r = client.get("/payments")
    assert r.status_code == 200, f"GET /payments -> {r.status_code} {r.text}"
    rows = r.json()
    assert len(rows) > 0, "expected the seeded pending Wave payment to be present"
    assert all(row["gerance_id"] == own_gerance_id for row in rows), (
        "payments leaked rows outside the manager's own gerance: "
        f"{[row['gerance_id'] for row in rows if row['gerance_id'] != own_gerance_id]}"
    )

    r2 = client.get("/payments", params={"gerance_id": FOREIGN_GERANCE_ID})
    assert r2.status_code == 200, f"GET /payments?gerance_id=foreign -> {r2.status_code} {r2.text}"
    rows2 = r2.json()
    assert len(rows2) == len(rows)
    assert all(row["gerance_id"] == own_gerance_id for row in rows2)


def test_members_list_scoped_to_own_gerance_even_with_override(manager_client):
    client, own_gerance_id = manager_client

    r = client.get("/members")
    assert r.status_code == 200, f"GET /members -> {r.status_code} {r.text}"
    rows = r.json()
    assert len(rows) > 0, "expected at least the seeded QA Feat members"
    emails = {row["email"] for row in rows}
    assert "qa.payeur@anv.ci" in emails, f"expected seeded member missing from own-gerance list: {emails}"

    r2 = client.get("/members", params={"gerance_id": FOREIGN_GERANCE_ID})
    assert r2.status_code == 200, f"GET /members?gerance_id=foreign -> {r2.status_code} {r2.text}"
    rows2 = r2.json()
    assert {row["email"] for row in rows2} == emails, (
        "manager was able to change the members scope via gerance_id query param"
    )
