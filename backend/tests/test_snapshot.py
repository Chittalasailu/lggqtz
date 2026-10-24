"""Regression test on the committed January 2026 snapshot: pins the figures quoted in the README."""

from __future__ import annotations

import pytest

from app import service
from app.config import settings

CACHES = (service.forecasts_hh, service.decision_frame, service.horizon_view)


@pytest.fixture()
def snapshot():
    for fn in CACHES:
        fn.cache_clear()
    yield
    for fn in CACHES:
        fn.cache_clear()


def test_readme_headline_numbers(snapshot):
    acc = service.accuracy_view(settings.default_decision_hour)
    assert acc["overall"]["n"] == 31 * 48
    assert acc["overall"]["mae"] == pytest.approx(2023, abs=1)
    assert acc["overall"]["bias"] == pytest.approx(1744, abs=1)
    assert acc["overall"]["rmse"] == pytest.approx(2498, abs=1)
    assert acc["overall"]["band_coverage_pct"] == pytest.approx(81.0, abs=0.1)
    assert acc["adjusted"]["mae"] == pytest.approx(1557, abs=1)
    assert acc["baseline"]["mae"] == pytest.approx(4113, abs=1)
    assert acc["daily_floor_hit_pct"] == pytest.approx(87.1, abs=0.1)
    assert acc["lead_hours"] == {"min": 16.5, "max": 40.0}


def test_every_delivery_day_uses_one_run_published_before_the_decision(snapshot):
    frame = service.month_frame(settings.default_decision_hour)
    assert frame.forecast.notna().all()
    assert (frame.publish_time <= frame.cutoff).all()
    assert (frame.groupby("delivery_date").publish_time.nunique() == 1).all()
