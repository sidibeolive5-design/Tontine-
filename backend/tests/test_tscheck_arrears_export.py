"""tscheck: export Excel du tableau des retards — GET /api/arrears/export
retourne un vrai fichier .xlsx nommé retards-<date>.xlsx dont le nombre de
lignes correspond au nombre de membres en retard.
"""

import base64

import httpx
import pytest

from .conftest import api_url

MANAGER_EMAIL = "qa.penal@anv.ci"
MANAGER_PASSWORD = "Passer123"


@pytest.fixture
def manager_client():
    with httpx.Client(base_url=api_url(), timeout=30.0) as c:
        r = c.post("/auth/login", json={"email": MANAGER_EMAIL, "password": MANAGER_PASSWORD})
        assert r.status_code == 200, f"manager login failed: {r.status_code} {r.text}"
        yield c


def test_export_returns_real_xlsx_with_matching_row_count(manager_client):
    r_arrears = manager_client.get("/arrears")
    assert r_arrears.status_code == 200
    expected_rows = len(r_arrears.json())
    assert expected_rows > 0, "expected at least the seeded QA Penal arrears rows"

    r = manager_client.get("/arrears/export")
    assert r.status_code == 200, f"GET /arrears/export -> {r.status_code} {r.text}"
    body = r.json()

    assert body["filename"].startswith("retards-") and body["filename"].endswith(".xlsx"), (
        f"unexpected filename: {body['filename']}"
    )
    assert body["rows"] == expected_rows, (
        f"export row count ({body['rows']}) must match /arrears row count ({expected_rows})"
    )

    raw = base64.b64decode(body["content_base64"])
    assert len(raw) > 100, "decoded xlsx content looks empty/too small"
    # .xlsx files are zip archives: magic number PK\x03\x04
    assert raw[:2] == b"PK", "content is not a valid zip/xlsx payload"
