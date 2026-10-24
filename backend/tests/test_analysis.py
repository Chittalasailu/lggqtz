from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from app import analysis

TZ = "Europe/London"


def ts(s: str) -> pd.Timestamp:
    return pd.Timestamp(s, tz="UTC")


def run(publish: str, values: dict) -> pd.DataFrame:
    return pd.DataFrame(
        {
            "publish_time": ts(publish),
            "start_time": [ts(k) for k in values],
            "generation": list(values.values()),
        }
    )


# --------------------------------------------------------------------------- interpolation
def test_to_half_hourly_interpolates_within_run_only():
    fc = pd.concat(
        [
            run("2026-01-01T09:30Z", {"2026-01-02T00:00Z": 100.0, "2026-01-02T01:00Z": 200.0}),
            run("2026-01-01T11:30Z", {"2026-01-02T01:00Z": 1000.0, "2026-01-02T02:00Z": 2000.0}),
        ]
    )
    hh = analysis.to_half_hourly(fc)
    first = hh[hh.publish_time == ts("2026-01-01T09:30Z")].set_index("start_time").generation
    assert first[ts("2026-01-02T00:30Z")] == pytest.approx(150.0)
    # No value is invented beyond a run's own horizon
    assert first.index.max() == ts("2026-01-02T01:00Z")
    assert len(hh) == 6


# --------------------------------------------------------------------------- decision time
def test_decision_cutoff_winter():
    start = pd.Series([ts("2026-01-15T00:00Z"), ts("2026-01-15T23:30Z")])
    cutoff = analysis.decision_cutoff(start, 11, TZ)
    assert list(cutoff) == [ts("2026-01-14T11:00Z")] * 2


def test_decision_cutoff_respects_bst():
    # 23:30 UTC on 14 July is 00:30 BST on 15 July -> decided 11:00 BST (10:00 UTC) on 14 July
    start = pd.Series([ts("2026-07-14T23:30Z"), ts("2026-07-14T22:30Z")])
    cutoff = analysis.decision_cutoff(start, 11, TZ)
    assert cutoff.iloc[0] == ts("2026-07-14T10:00Z")
    assert cutoff.iloc[1] == ts("2026-07-13T10:00Z")


def test_delivery_day_has_46_and_50_periods_on_clock_changes():
    spring = pd.Series(pd.date_range("2026-03-28T23:00Z", "2026-03-30T01:00Z", freq="30min"))
    autumn = pd.Series(pd.date_range("2026-10-24T22:00Z", "2026-10-26T02:00Z", freq="30min"))
    assert (analysis.delivery_dates(spring, TZ) == pd.Timestamp("2026-03-29").date()).sum() == 46
    assert (analysis.delivery_dates(autumn, TZ) == pd.Timestamp("2026-10-25").date()).sum() == 50


# --------------------------------------------------------------------------- forecast selection
def test_select_latest_forecast_never_uses_runs_published_after_cutoff():
    fc = pd.concat(
        [
            run("2026-01-14T07:30Z", {"2026-01-15T12:00Z": 1.0}),
            run("2026-01-14T09:30Z", {"2026-01-15T12:00Z": 2.0}),
            run("2026-01-14T11:30Z", {"2026-01-15T12:00Z": 3.0}),  # after the 11:00 cut-off
        ]
    )
    targets = pd.DataFrame({"start_time": [ts("2026-01-15T12:00Z")], "cutoff": [ts("2026-01-14T11:00Z")]})
    out = analysis.select_latest_forecast(targets, fc)
    assert out.forecast.iloc[0] == 2.0
    assert out.publish_time.iloc[0] == ts("2026-01-14T09:30Z")


def test_select_latest_forecast_falls_back_to_older_run_that_covers_target():
    fc = pd.concat(
        [
            run("2026-01-14T07:30Z", {"2026-01-15T12:00Z": 1.0, "2026-01-16T12:00Z": 5.0}),
            run("2026-01-14T09:30Z", {"2026-01-15T12:00Z": 2.0}),
        ]
    )
    targets = pd.DataFrame({"start_time": [ts("2026-01-16T12:00Z")], "cutoff": [ts("2026-01-14T11:00Z")]})
    out = analysis.select_latest_forecast(targets, fc)
    assert out.forecast.iloc[0] == 5.0


def test_select_latest_forecast_uses_run_published_exactly_at_cutoff():
    fc = pd.concat(
        [
            run("2026-01-14T07:30Z", {"2026-01-15T12:00Z": 1.0}),
            run("2026-01-14T09:00Z", {"2026-01-15T12:00Z": 2.0}),
        ]
    )
    targets = pd.DataFrame({"start_time": [ts("2026-01-15T12:00Z")], "cutoff": [ts("2026-01-14T09:00Z")]})
    assert analysis.select_latest_forecast(targets, fc).forecast.iloc[0] == 2.0


def test_select_latest_forecast_missing_when_nothing_published():
    fc = run("2026-01-14T12:00Z", {"2026-01-15T12:00Z": 1.0})
    targets = pd.DataFrame({"start_time": [ts("2026-01-15T12:00Z")], "cutoff": [ts("2026-01-14T11:00Z")]})
    assert analysis.select_latest_forecast(targets, fc).forecast.isna().all()


# --------------------------------------------------------------------------- metrics
def test_error_metrics_known_values():
    frame = pd.DataFrame({"error": [100.0, -100.0, 300.0, np.nan], "actual": [1000.0] * 4})
    m = analysis.error_metrics(frame)
    assert m["n"] == 3
    assert m["mae"] == pytest.approx(500 / 3)
    assert m["bias"] == pytest.approx(100.0)
    assert m["rmse"] == pytest.approx(np.sqrt((100**2 + 100**2 + 300**2) / 3))
    assert m["nmae_pct"] == pytest.approx(100 * (500 / 3) / 1000)


def test_error_metrics_empty():
    assert analysis.error_metrics(pd.DataFrame({"error": [], "actual": []})) == {"n": 0}


# --------------------------------------------------------------------------- uncertainty band
def test_band_only_uses_errors_published_before_decision():
    days = pd.date_range("2026-01-01", periods=4 * 48, freq="30min", tz="UTC")
    actuals = pd.DataFrame(
        {"start_time": days, "publish_time": days + pd.Timedelta(minutes=30), "generation": 1000.0}
    )
    frame = pd.DataFrame(
        {
            "start_time": days,
            "actual": 1000.0,
            "actual_published": days + pd.Timedelta(minutes=30),
            "delivery_date": analysis.delivery_dates(actuals.start_time, TZ),
            "cutoff": analysis.decision_cutoff(actuals.start_time, 11, TZ),
            "forecast": 1000.0,
        }
    )
    # Small errors before 3 Jan 11:00, huge errors afterwards (the "future" for 4 Jan's decision)
    frame["error"] = np.where(frame.start_time <= ts("2026-01-03T10:30Z"), 50.0, 99999.0)
    banded = analysis.add_uncertainty_band(frame, lookback_days=14, min_samples=48)
    day4 = banded[banded.delivery_date == pd.Timestamp("2026-01-04").date()]
    assert day4.err_q90.iloc[0] == pytest.approx(50.0)
    # First day has no history -> no band rather than a leaky one
    day1 = banded[banded.delivery_date == pd.Timestamp("2026-01-01").date()]
    assert day1.p10.isna().all()


# --------------------------------------------------------------------------- baseline and floor
def test_persistence_uses_last_actual_published_before_decision():
    days = pd.date_range("2026-01-14", periods=2 * 48, freq="30min", tz="UTC")
    actuals = pd.DataFrame(
        {"start_time": days, "publish_time": days + pd.Timedelta(minutes=30), "generation": np.arange(96.0)}
    )
    frame = pd.DataFrame({"start_time": days, "cutoff": analysis.decision_cutoff(actuals.start_time, 9, TZ)})
    out = analysis.add_persistence(frame, actuals)
    # Decided 14 Jan 09:00: the latest published actual is the 08:30 period (index 17)
    assert (out[out.start_time >= ts("2026-01-15T00:00Z")].persistence == 17.0).all()
    # Nothing was published before 13 Jan 09:00 -> no baseline rather than a leaky one
    assert out[out.start_time < ts("2026-01-15T00:00Z")].persistence.isna().all()


def test_daily_floor_hit_pct_counts_days_at_or_above_summed_p10():
    frame = pd.DataFrame(
        {
            "delivery_date": ["d1"] * 2 + ["d2"] * 2 + ["d3"] * 2,
            "actual": [10.0, 10.0, 1.0, 1.0, 5.0, 5.0],
            "p10": [5.0, 5.0, 5.0, 5.0, np.nan, 5.0],
        }
    )
    # d1 hit, d2 miss, d3 skipped (incomplete band)
    assert analysis.daily_floor_hit_pct(frame) == pytest.approx(50.0)


# --------------------------------------------------------------------------- horizon
def test_horizon_curve_picks_older_runs_for_longer_horizons():
    actuals = pd.DataFrame({"start_time": [ts("2026-01-15T12:00Z")], "generation": [1000.0]})
    fc = pd.concat(
        [
            run("2026-01-14T12:00Z", {"2026-01-15T12:00Z": 1400.0}),  # 24h ahead
            run("2026-01-15T10:00Z", {"2026-01-15T12:00Z": 1100.0}),  # 2h ahead
        ]
    )
    rows = {r["horizon_h"]: r for r in analysis.horizon_curve(actuals, fc, [1, 2, 24, 25])}
    assert rows[1]["mae"] == pytest.approx(100.0)
    assert rows[2]["mae"] == pytest.approx(100.0)
    assert rows[24]["mae"] == pytest.approx(400.0)
    assert rows[25]["n"] == 0
