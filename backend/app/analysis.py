"""Pure, side-effect-free analysis functions.

Conventions
-----------
* All timestamps are tz-aware UTC; "delivery day" and "decision time" are UK local.
* error = forecast - actual  (MW). Positive error = wind came in *below* forecast, i.e. the
  buyer under-procured and must top up in intraday/balancing markets.
* A forecast is only ever selected if it was published at or before the cut-off it is used
  for, so nothing in here can leak future information into a decision.
"""

from __future__ import annotations

from typing import Dict, Iterable, List, Optional

import numpy as np
import pandas as pd

HALF_HOUR = pd.Timedelta(minutes=30)
HOURS_PER_PERIOD = 0.5  # MW over a 30-minute period -> MWh
UTC_NS = "datetime64[ns, UTC]"


# --------------------------------------------------------------------------- preparation
def to_half_hourly(forecasts: pd.DataFrame) -> pd.DataFrame:
    """Interpolate each hourly WINDFOR run onto the 30-minute settlement grid.

    Each :30 value is the midpoint of the two neighbouring hourly points of the *same* run
    (linear interpolation), so every value keeps the publish time of the run it came from.
    Gaps longer than an hour inside a run are left unfilled rather than guessed.
    """
    fc = forecasts[["publish_time", "start_time", "generation"]].sort_values(["publish_time", "start_time"])
    nxt = fc.groupby("publish_time")[["start_time", "generation"]].shift(-1)
    hourly_pair = (nxt.start_time - fc.start_time) == pd.Timedelta(hours=1)
    mids = pd.DataFrame(
        {
            "publish_time": fc.publish_time[hourly_pair],
            "start_time": fc.start_time[hourly_pair] + HALF_HOUR,
            "generation": ((fc.generation + nxt.generation) / 2)[hourly_pair],
        }
    )
    out = pd.concat([fc, mids], ignore_index=True)
    return out.sort_values(["publish_time", "start_time"]).reset_index(drop=True)


def delivery_dates(start_time: pd.Series, tz: str) -> pd.Series:
    """UK-local calendar date of each settlement period."""
    return start_time.dt.tz_convert(tz).dt.date


def decision_cutoff(start_time: pd.Series, decision_hour: int, tz: str) -> pd.Series:
    """Decision time for each target: `decision_hour`:00 local time on the day before delivery."""
    local_midnight = start_time.dt.tz_convert(tz).dt.tz_localize(None).dt.normalize()
    cutoff_local = local_midnight - pd.Timedelta(days=1) + pd.Timedelta(hours=decision_hour)
    cutoff = cutoff_local.dt.tz_localize(
        tz, ambiguous=np.zeros(len(cutoff_local), dtype=bool), nonexistent="shift_forward"
    )
    return cutoff.dt.tz_convert("UTC")


def select_latest_forecast(targets: pd.DataFrame, forecasts_hh: pd.DataFrame) -> pd.DataFrame:
    """For each row of `targets` (start_time, cutoff) attach the most recent forecast value
    for that start_time published at or before `cutoff`."""
    # merge_asof needs identical datetime resolutions on both sides
    left = targets.astype({"start_time": UTC_NS, "cutoff": UTC_NS}).sort_values("cutoff")
    right = (
        forecasts_hh[["publish_time", "start_time", "generation"]]
        .astype({"publish_time": UTC_NS, "start_time": UTC_NS})
        .rename(columns={"generation": "forecast"})
        .sort_values("publish_time")
    )
    merged = pd.merge_asof(
        left, right, left_on="cutoff", right_on="publish_time", by="start_time", direction="backward"
    )
    return merged.sort_values("start_time").reset_index(drop=True)


# --------------------------------------------------------------------------- decision frame
def build_decision_frame(
    actuals: pd.DataFrame, forecasts_hh: pd.DataFrame, decision_hour: int, tz: str
) -> pd.DataFrame:
    """One row per settlement period with the forecast a buyer would have seen at the
    day-ahead decision time, the actual outturn, and the resulting error."""
    targets = pd.DataFrame(
        {
            "start_time": actuals["start_time"],
            "actual": actuals["generation"],
            "actual_published": actuals.get("publish_time", actuals["start_time"] + HALF_HOUR),
        }
    )
    targets["delivery_date"] = delivery_dates(targets.start_time, tz)
    targets["cutoff"] = decision_cutoff(targets.start_time, decision_hour, tz)
    frame = select_latest_forecast(targets, forecasts_hh)
    frame["error"] = frame.forecast - frame.actual
    frame["lead_hours"] = (frame.start_time - frame.publish_time) / pd.Timedelta(hours=1)
    return frame


def add_uncertainty_band(frame: pd.DataFrame, lookback_days: int, min_samples: int = 96) -> pd.DataFrame:
    """Add an empirical P10-P90 band around each day's forecast.

    For delivery day D the band uses only errors that were *observable at D's decision
    time*: past periods whose actual had already been published, within `lookback_days`.
    p10/p90 are quantiles of plausible outturn (forecast minus error quantiles); p50 is the
    bias-adjusted forecast (forecast minus the recent median error).
    """
    out = frame.copy()
    for col in ("err_q10", "err_q50", "err_q90", "band_samples"):
        out[col] = np.nan
    known = frame.dropna(subset=["error"])
    for _day, idx in out.groupby("delivery_date").groups.items():
        cutoff = out.loc[idx, "cutoff"].iloc[0]
        window = known[
            (known.actual_published <= cutoff)
            & (known.start_time >= cutoff - pd.Timedelta(days=lookback_days))
        ]
        out.loc[idx, "band_samples"] = len(window)
        if len(window) < min_samples:
            continue
        q10, q50, q90 = np.quantile(window.error, [0.1, 0.5, 0.9])
        out.loc[idx, ["err_q10", "err_q50", "err_q90"]] = [q10, q50, q90]
    out["p10"] = (out.forecast - out.err_q90).clip(lower=0)
    out["p50"] = (out.forecast - out.err_q50).clip(lower=0)
    out["p90"] = (out.forecast - out.err_q10).clip(lower=0)
    out["error_adj"] = out.p50 - out.actual
    return out


def adjusted(frame: pd.DataFrame) -> pd.DataFrame:
    """View of `frame` whose `error` is that of the bias-adjusted (p50) forecast."""
    return frame[["start_time", "delivery_date", "actual"]].assign(error=frame.error_adj)


# --------------------------------------------------------------------------- metrics
def _clean(value: float) -> Optional[float]:
    if value is None or not np.isfinite(value):
        return None
    return float(value)


def error_metrics(frame: pd.DataFrame) -> Dict[str, Optional[float]]:
    """Summary statistics of `frame.error`, ignoring periods without a forecast."""
    valid = frame.dropna(subset=["error", "actual"])
    err = valid.error.to_numpy()
    if len(err) == 0:
        return {"n": 0}
    mean_actual = valid.actual.mean()
    metrics = {
        "n": int(len(err)),
        "mae": np.mean(np.abs(err)),
        "rmse": np.sqrt(np.mean(err**2)),
        "bias": np.mean(err),
        "nmae_pct": 100 * np.mean(np.abs(err)) / mean_actual if mean_actual else np.nan,
        "p10": np.quantile(err, 0.1),
        "p50": np.quantile(err, 0.5),
        "p90": np.quantile(err, 0.9),
        "max_abs": np.max(np.abs(err)),
        "mean_actual": mean_actual,
    }
    if {"p10", "p90"}.issubset(valid.columns):
        banded = valid.dropna(subset=["p10", "p90"])
        if len(banded):
            inside = (banded.actual >= banded.p10) & (banded.actual <= banded.p90)
            metrics["band_coverage_pct"] = 100 * inside.mean()
    return {k: (v if k == "n" else _clean(v)) for k, v in metrics.items()}


def daily_summary(frame: pd.DataFrame) -> List[Dict]:
    rows = []
    for day, g in frame.groupby("delivery_date", sort=True):
        m = error_metrics(g)
        valid = g.dropna(subset=["forecast", "actual"])
        mae_adj = error_metrics(adjusted(g)).get("mae") if "error_adj" in g else None
        rows.append(
            {
                "delivery_date": str(day),
                "mae": m.get("mae"),
                "mae_adj": mae_adj,
                "bias": m.get("bias"),
                "rmse": m.get("rmse"),
                "max_abs": m.get("max_abs"),
                "band_coverage_pct": m.get("band_coverage_pct"),
                "forecast_mwh": _clean(valid.forecast.sum() * HOURS_PER_PERIOD),
                "actual_mwh": _clean(valid.actual.sum() * HOURS_PER_PERIOD),
                "energy_error_mwh": _clean(valid.error.sum() * HOURS_PER_PERIOD),
            }
        )
    return rows


def by_local_hour(frame: pd.DataFrame, tz: str) -> List[Dict]:
    hours = frame.start_time.dt.tz_convert(tz).dt.hour
    rows = []
    for hour, g in frame.groupby(hours, sort=True):
        m = error_metrics(g)
        rows.append(
            {
                "hour": int(hour),
                "mae": m.get("mae"),
                "bias": m.get("bias"),
                "p10": m.get("p10"),
                "p90": m.get("p90"),
            }
        )
    return rows


def error_histogram(frame: pd.DataFrame, bin_width: float = 500.0) -> List[Dict]:
    err = frame.error.dropna().to_numpy()
    if len(err) == 0:
        return []
    lo = np.floor(err.min() / bin_width) * bin_width
    hi = np.ceil(err.max() / bin_width) * bin_width + bin_width
    counts, edges = np.histogram(err, bins=np.arange(lo, hi, bin_width))
    return [{"lo": float(edges[i]), "hi": float(edges[i + 1]), "count": int(c)} for i, c in enumerate(counts)]


def horizon_curve(actuals: pd.DataFrame, forecasts_hh: pd.DataFrame, horizons: Iterable[int]) -> List[Dict]:
    """Accuracy of the latest forecast published at least `h` hours before each target."""
    rows = []
    base = pd.DataFrame({"start_time": actuals["start_time"], "actual": actuals["generation"]})
    for h in horizons:
        targets = base.assign(cutoff=base.start_time - pd.Timedelta(hours=h))
        frame = select_latest_forecast(targets, forecasts_hh)
        frame["error"] = frame.forecast - frame.actual
        m = error_metrics(frame)
        m.update({"horizon_h": int(h), "coverage_pct": _clean(100 * frame.forecast.notna().mean())})
        rows.append(m)
    return rows
