"""Thin client for the Elexon Insights (BMRS) dataset stream endpoints."""

from __future__ import annotations

import logging
import time
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional

import pandas as pd
import requests

from .config import settings

log = logging.getLogger(__name__)

# The stream endpoints accept long windows, but chunking keeps responses small and lets a
# failed request be retried without refetching everything.
CHUNK = timedelta(days=7)


def _iso(ts: datetime) -> str:
    return ts.strftime("%Y-%m-%dT%H:%M:%SZ")


def _get(url: str, params: Dict[str, Any], retries: int = 3) -> List[Dict[str, Any]]:
    for attempt in range(1, retries + 1):
        try:
            resp = requests.get(url, params=params, timeout=60)
            resp.raise_for_status()
            return resp.json()
        except (requests.RequestException, ValueError) as exc:
            if attempt == retries:
                raise
            wait = 2**attempt
            log.warning("Elexon request failed (%s), retrying in %ss", exc, wait)
            time.sleep(wait)
    return []  # unreachable, keeps type-checkers happy


def fetch_stream(
    dataset: str,
    published_from: datetime,
    published_to: datetime,
    extra_params: Optional[Dict[str, Any]] = None,
) -> pd.DataFrame:
    """Fetch every record of `dataset` published in [published_from, published_to)."""
    url = f"{settings.elexon_base_url}/datasets/{dataset}/stream"
    rows: List[Dict[str, Any]] = []
    cursor = published_from
    while cursor < published_to:
        chunk_end = min(cursor + CHUNK, published_to)
        params = {"publishDateTimeFrom": _iso(cursor), "publishDateTimeTo": _iso(chunk_end)}
        params.update(extra_params or {})
        batch = _get(url, params)
        log.info("%s %s -> %s: %d rows", dataset, _iso(cursor), _iso(chunk_end), len(batch))
        rows.extend(batch)
        cursor = chunk_end
    return pd.DataFrame(rows)


def fetch_wind_actuals(start: datetime, end: datetime) -> pd.DataFrame:
    """Half-hourly national wind outturn (FUELHH, fuelType=WIND) with startTime in [start, end)."""
    # FUELHH is published ~30 minutes after each settlement period starts; pad the window.
    raw = fetch_stream("FUELHH", start, end + timedelta(hours=2), {"fuelType": "WIND"})
    df = pd.DataFrame(
        {
            "start_time": pd.to_datetime(raw["startTime"], utc=True),
            "publish_time": pd.to_datetime(raw["publishTime"], utc=True),
            "generation": raw["generation"].astype(float),
        }
    )
    df = df[(df.start_time >= pd.Timestamp(start)) & (df.start_time < pd.Timestamp(end))]
    # If a period was ever re-published keep the latest value.
    df = df.sort_values("publish_time").drop_duplicates("start_time", keep="last")
    return df.sort_values("start_time").reset_index(drop=True)


def fetch_wind_forecasts(published_from: datetime, published_to: datetime) -> pd.DataFrame:
    """Every WINDFOR forecast run published in the window (hourly startTime resolution)."""
    raw = fetch_stream("WINDFOR", published_from, published_to)
    df = pd.DataFrame(
        {
            "publish_time": pd.to_datetime(raw["publishTime"], utc=True),
            "start_time": pd.to_datetime(raw["startTime"], utc=True),
            "generation": raw["generation"].astype(float),
        }
    )
    df = df.drop_duplicates(["publish_time", "start_time"], keep="last")
    return df.sort_values(["publish_time", "start_time"]).reset_index(drop=True)
