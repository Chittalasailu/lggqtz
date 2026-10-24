"""Loads raw actuals and forecasts, either from the committed snapshot or live from Elexon."""

from __future__ import annotations

import logging
from functools import lru_cache
from pathlib import Path
from typing import Tuple

import pandas as pd

from . import elexon
from .config import settings

log = logging.getLogger(__name__)

ACTUALS_FILE = "fuelhh_wind.csv"
FORECASTS_FILE = "windfor.csv"


def _read_csv(path: Path, time_cols: Tuple[str, ...]) -> pd.DataFrame:
    df = pd.read_csv(path)
    for col in time_cols:
        df[col] = pd.to_datetime(df[col], utc=True)
    return df


def fetch_live() -> Tuple[pd.DataFrame, pd.DataFrame]:
    actuals = elexon.fetch_wind_actuals(settings.actuals_from, settings.actuals_to)
    forecasts = elexon.fetch_wind_forecasts(
        settings.forecasts_published_from, settings.forecasts_published_to
    )
    return actuals, forecasts


def save_snapshot(actuals: pd.DataFrame, forecasts: pd.DataFrame, data_dir: Path) -> None:
    data_dir.mkdir(parents=True, exist_ok=True)
    actuals.to_csv(data_dir / ACTUALS_FILE, index=False, date_format="%Y-%m-%dT%H:%M:%SZ")
    forecasts.to_csv(data_dir / FORECASTS_FILE, index=False, date_format="%Y-%m-%dT%H:%M:%SZ")


def load_snapshot(data_dir: Path) -> Tuple[pd.DataFrame, pd.DataFrame]:
    actuals = _read_csv(data_dir / ACTUALS_FILE, ("start_time", "publish_time"))
    forecasts = _read_csv(data_dir / FORECASTS_FILE, ("publish_time", "start_time"))
    return actuals, forecasts


@lru_cache(maxsize=1)
def load_raw() -> Tuple[pd.DataFrame, pd.DataFrame]:
    """Return (actuals, forecasts). Cached for the lifetime of the process."""
    if settings.data_source == "live":
        log.info("Fetching data live from Elexon")
        return fetch_live()
    log.info("Loading snapshot from %s", settings.data_dir)
    return load_snapshot(settings.data_dir)
