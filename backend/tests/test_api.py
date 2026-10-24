from __future__ import annotations

from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_health():
    assert client.get("/api/health").json() == {"status": "ok"}


def test_meta(synthetic):
    body = client.get("/api/meta").json()
    assert body["first_delivery_date"] == "2026-01-02"
    assert body["last_delivery_date"] == "2026-02-01"
    assert body["default_decision_hour"] == 9


def test_decision_uses_forecast_published_before_gate(synthetic):
    body = client.get("/api/decision", params={"decision_date": "2026-01-14", "decision_hour": 11}).json()
    assert body["delivery_date"] == "2026-01-15"
    assert body["decision_time"] == "2026-01-14T11:00:00Z"
    assert body["forecast_run"]["publish_time"] == "2026-01-14T09:30:00Z"
    assert len(body["series"]) == 48
    assert body["summary"]["coverage_pct"] == 100.0
    # Synthetic forecasts are biased +500 MW, so the band should sit below the forecast
    point = body["series"][0]
    assert point["p10"] < point["forecast"]
    assert any(r["before_decision"] for r in body["runs"])
    assert any(not r["before_decision"] for r in body["runs"])


def test_decision_hour_changes_run(synthetic):
    body = client.get("/api/decision", params={"decision_date": "2026-01-14", "decision_hour": 8}).json()
    assert body["forecast_run"]["publish_time"] == "2026-01-14T07:30:00Z"


def test_decision_rejects_out_of_scope_date(synthetic):
    assert client.get("/api/decision", params={"decision_date": "2026-02-05"}).status_code == 422
    assert (
        client.get("/api/decision", params={"decision_date": "2026-01-10", "decision_hour": 30}).status_code
        == 422
    )


def test_accuracy(synthetic):
    body = client.get("/api/accuracy").json()
    assert len(body["daily"]) == 31
    assert body["overall"]["bias"] > 300  # synthetic +500 MW bias is detected
    assert 0 <= body["overall"]["band_coverage_pct"] <= 100
    assert len(body["by_hour"]) == 24
    assert sum(b["count"] for b in body["histogram"]) == body["overall"]["n"]
    assert body["baseline"]["n"] == body["overall"]["n"]
    assert 0 <= body["daily_floor_hit_pct"] <= 100


def test_horizon(synthetic):
    rows = client.get("/api/horizon").json()["horizons"]
    assert [r["horizon_h"] for r in rows][:3] == [0, 1, 2]
    assert rows[24]["n"] > 0
