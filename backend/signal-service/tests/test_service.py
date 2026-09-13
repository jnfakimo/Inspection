import sqlite3
from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from service import Settings, create_app


@pytest.fixture
def setup(tmp_path):
    settings = Settings.model_validate({
        "database": str(tmp_path / "signals.db"), "reader_token": "r" * 40,
        "devices": [
            {"id": "demo-1", "market": "1", "token": "a" * 40,
             "metric": "temperature", "unit": "C", "alarm_above": 8},
            {"id": "demo-2", "market": "2", "token": "b" * 40,
             "metric": "temperature", "unit": "C", "alarm_above": 8},
        ],
    })
    with TestClient(create_app(settings)) as client:
        yield client, settings


def headers(token):
    return {"Authorization": "Bearer " + token * 40}


def signal(value=4.0, age=0):
    return {"event_id": str(uuid4()), "value": value,
            "occurred_at": (datetime.now(UTC) - timedelta(seconds=age)).isoformat()}


def test_authentication_and_scopes(setup):
    client, _ = setup
    assert client.post("/v1/signals", json=signal()).status_code == 401
    assert client.get("/v1/signals/latest?market=1").status_code == 401
    assert client.get("/metrics", headers=headers("a")).status_code == 401
    assert client.post("/v1/signals", json=signal(), headers=headers("r")).status_code == 401
    assert client.post("/v1/signals", json=signal(), headers=headers("a")).status_code == 200
    rows = client.get("/v1/signals/latest?market=2", headers=headers("r")).json()["items"]
    assert rows[0]["freshness"] == "missing"
    forged = signal() | {"market": "2"}
    assert client.post("/v1/signals", json=forged, headers=headers("a")).status_code == 422


def test_idempotency_conflict_and_audit(setup):
    client, settings = setup
    data = signal()
    first = client.post("/v1/signals", json=data, headers=headers("a")).json()
    duplicate = client.post("/v1/signals", json=data, headers=headers("a")).json()
    assert duplicate["status"] == "duplicate"
    assert first["received_at"] == duplicate["received_at"]
    assert client.post("/v1/signals", json=data | {"value": 99.0},
                       headers=headers("a")).status_code == 409
    with sqlite3.connect(settings.database) as db:
        assert db.execute("SELECT count(*) FROM signals").fetchone()[0] == 1
        assert db.execute("SELECT count(*) FROM audit").fetchone()[0] == 3
        assert "a" * 40 not in str(db.execute("SELECT * FROM audit").fetchall())


def test_alarm_recovery_old_data_and_persistence(setup):
    client, settings = setup
    client.post("/v1/signals", json=signal(11.0), headers=headers("a"))
    assert client.get("/v1/signals/latest?market=1", headers=headers("r")).json()[
        "items"][0]["display_status"] == "異常"
    client.post("/v1/signals", json=signal(4.0), headers=headers("a"))
    client.post("/v1/signals", json=signal(99.0, 500), headers=headers("a"))
    with TestClient(create_app(settings)) as restarted:
        rows = restarted.get("/v1/signals/latest?market=1", headers=headers("r")).json()
        assert rows["items"][0]["display_status"] == "正常"
        assert len(restarted.get("/v1/signals/history?market=1",
                                 headers=headers("r")).json()["items"]) == 3


def test_staleness(setup):
    client, _ = setup
    client.post("/v1/signals", json=signal(4.0, 600), headers=headers("b"))
    row = client.get("/v1/signals/latest?market=2", headers=headers("r")).json()["items"][0]
    assert row["display_status"] == "資料逾時"


@pytest.mark.parametrize("change", [
    {"value": "hello"}, {"value": True}, {"occurred_at": "2026-09-13T12:00:00"},
    {"event_id": "invalid"}, {"occurred_at": "2099-01-01T00:00:00Z"},
])
def test_invalid_data(setup, change):
    client, _ = setup
    assert client.post("/v1/signals", json=signal() | change,
                       headers=headers("a")).status_code == 422


def test_metrics_are_available(setup):
    client, _ = setup
    client.get("/healthz")
    assert "signal_requests_total" in client.get("/metrics", headers=headers("r")).text
