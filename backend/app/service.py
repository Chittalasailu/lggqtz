"""Application service layer: combines data access + analysis and caches results.

The data set is small (one month), so everything is computed in memory and memoised per
decision hour. The first request for an hour takes ~1s; subsequent requests are instant.
"""

from __future__ import annotations

from datetime import date, timedelta
from functools import lru_cache
from typing import Dict, List, Optional

import pandas as pd

from . import analysis
from .config import settings
from .repository import load_raw

TZ = settings.market_tz


def _iso(ts: Optional[pd.Timestamp]) -> Optional[str]:
    if ts is None or pd.isna(ts):
        return None
    return ts.strftime("%Y-%m-%dT%H:%M:%SZ")


def _num(value) -> Optional[float]:
    return None if value is None or pd.isna(value) else round(float(value), 1)


def delivery_range() -> tuple[date, date]:
    return (
        settings.first_decision_date + timedelta(days=1),
        settings.last_decision_date + timedelta(days=1),
    )


@lru_cache(maxsize=1)
def forecasts_hh() -> pd.DataFrame:
    _, forecasts = load_raw()
    return analysis.to_half_hourly(forecasts)


@lru_cache(maxsize=24)
def decision_frame(decision_hour: int) -> pd.DataFrame:
    """Full frame (including warm-up days) with uncertainty bands."""
    actuals, _ = load_raw()
    frame = analysis.build_decision_frame(actuals, forecasts_hh(), decision_hour, TZ)
    frame = analysis.add_uncertainty_band(frame, settings.band_lookback_days)
    return analysis.add_persistence(frame, actuals)


def month_frame(decision_hour: int) -> pd.DataFrame:
    """Only the delivery days that belong to January-2026 decisions."""
    first, last = delivery_range()
    frame = decision_frame(decision_hour)
    return frame[(frame.delivery_date >= first) & (frame.delivery_date <= last)]


# --------------------------------------------------------------------------- endpoints
def meta() -> Dict:
    actuals, forecasts = load_raw()
    first, last = delivery_range()
    return {
        "first_decision_date": str(settings.first_decision_date),
        "last_decision_date": str(settings.last_decision_date),
        "first_delivery_date": str(first),
        "last_delivery_date": str(last),
        "default_decision_hour": settings.default_decision_hour,
        "timezone": TZ,
        "band_lookback_days": settings.band_lookback_days,
        "data_source": settings.data_source,
        "actual_records": int(len(actuals)),
        "forecast_runs": int(forecasts.publish_time.nunique()),
        "latest_forecast_publish_time": _iso(forecasts.publish_time.max()),
    }


def decision_view(decision_date: date, decision_hour: int) -> Dict:
    delivery = decision_date + timedelta(days=1)
    frame = decision_frame(decision_hour)
    day = frame[frame.delivery_date == delivery].sort_values("start_time")
    if day.empty:
        raise LookupError(f"No data for delivery day {delivery}")

    cutoff = day.cutoff.iloc[0]
    publish_times = day.publish_time.dropna()
    run_time = publish_times.max() if len(publish_times) else None
    valid = day.dropna(subset=["forecast"])
    hours = analysis.HOURS_PER_PERIOD

    summary = {
        "forecast_mwh": _num(valid.forecast.sum() * hours),
        "p10_mwh": _num(valid.p10.sum() * hours) if valid.p10.notna().all() else None,
        "p50_mwh": _num(valid.p50.sum() * hours) if valid.p50.notna().all() else None,
        "p90_mwh": _num(valid.p90.sum() * hours) if valid.p90.notna().all() else None,
        "peak_mw": _num(valid.forecast.max()),
        "min_mw": _num(valid.forecast.min()),
        "mean_mw": _num(valid.forecast.mean()),
        "actual_mwh": _num(day.actual.sum() * hours),
        "energy_error_mwh": _num(valid.error.sum() * hours),
        "mae": _num(valid.error.abs().mean()),
        "mae_adj": _num(valid.error_adj.abs().mean()),
        "coverage_pct": _num(100 * day.forecast.notna().mean()),
    }

    series = [
        {
            "time": _iso(r.start_time),
            "actual": _num(r.actual),
            "forecast": _num(r.forecast),
            "p10": _num(r.p10),
            "p50": _num(r.p50),
            "p90": _num(r.p90),
        }
        for r in day.itertuples()
    ]

    return {
        "decision_date": str(decision_date),
        "delivery_date": str(delivery),
        "decision_hour": decision_hour,
        "decision_time": _iso(cutoff),
        "forecast_run": {
            "publish_time": _iso(run_time),
            "age_hours_at_decision": _num((cutoff - run_time) / pd.Timedelta(hours=1))
            if run_time is not None
            else None,
            "lead_hours_min": _num(valid.lead_hours.min()),
            "lead_hours_max": _num(valid.lead_hours.max()),
        },
        "band": {
            "lookback_days": settings.band_lookback_days,
            "samples": int(day.band_samples.iloc[0]),
            "err_q10": _num(day.err_q10.iloc[0]),
            "err_q50": _num(day.err_q50.iloc[0]),
            "err_q90": _num(day.err_q90.iloc[0]),
        },
        "summary": summary,
        "series": series,
        "runs": _runs_for_day(day, cutoff),
    }


def _runs_for_day(day: pd.DataFrame, cutoff: pd.Timestamp) -> List[Dict]:
    """Every forecast run covering the delivery day, published up to delivery start.
    Shows how the forecast evolved before and after the decision."""
    fc = forecasts_hh()
    start, end = day.start_time.min(), day.start_time.max()
    window = fc[
        (fc.start_time >= start)
        & (fc.start_time <= end)
        & (fc.publish_time >= cutoff - pd.Timedelta(hours=36))
        & (fc.publish_time <= start)
    ]
    runs = []
    for publish_time, g in window.groupby("publish_time", sort=True):
        runs.append(
            {
                "publish_time": _iso(publish_time),
                "before_decision": bool(publish_time <= cutoff),
                "points": [{"time": _iso(t), "value": _num(v)} for t, v in zip(g.start_time, g.generation)],
            }
        )
    return runs


def accuracy_view(decision_hour: int) -> Dict:
    frame = month_frame(decision_hour)
    first, last = delivery_range()
    return {
        "decision_hour": decision_hour,
        "first_delivery_date": str(first),
        "last_delivery_date": str(last),
        "overall": _round(analysis.error_metrics(frame)),
        "adjusted": _round(analysis.error_metrics(analysis.adjusted(frame))),
        "baseline": _round(analysis.error_metrics(analysis.baseline(frame))),
        "daily_floor_hit_pct": _num(analysis.daily_floor_hit_pct(frame)),
        "lead_hours": {"min": _num(frame.lead_hours.min()), "max": _num(frame.lead_hours.max())},
        "daily": [_round(r) for r in analysis.daily_summary(frame)],
        "by_hour": [_round(r) for r in analysis.by_local_hour(frame, TZ)],
        "histogram": analysis.error_histogram(frame),
    }


@lru_cache(maxsize=1)
def horizon_view() -> Dict:
    actuals, _ = load_raw()
    first, last = delivery_range()
    dates = analysis.delivery_dates(actuals.start_time, TZ)
    month = actuals[(dates >= first) & (dates <= last)]
    rows = analysis.horizon_curve(month, forecasts_hh(), range(0, settings.max_horizon_hours + 1))
    return {"horizons": [_round(r) for r in rows]}


def _round(row: Dict) -> Dict:
    return {k: (_num(v) if isinstance(v, float) else v) for k, v in row.items()}
