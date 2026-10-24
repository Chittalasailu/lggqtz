"""Central configuration. Values can be overridden with environment variables."""

from __future__ import annotations

import os
from dataclasses import dataclass
from datetime import date, datetime, timezone
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent.parent


@dataclass(frozen=True)
class Settings:
    # Elexon Insights API (public, no key required)
    elexon_base_url: str = os.getenv("ELEXON_BASE_URL", "https://data.elexon.co.uk/bmrs/api/v1")

    # Market timezone. The GB day-ahead auction and delivery days are in UK local time.
    market_tz: str = "Europe/London"

    # Scope: purchase decisions made in January 2026 -> delivery days 2 Jan .. 1 Feb 2026.
    first_decision_date: date = date(2026, 1, 1)
    last_decision_date: date = date(2026, 1, 31)

    # Default decision time (UK local hour on D-1). The GB day-ahead auctions close at 09:20 (EPEX) and
    # 09:50 (Nord Pool) UK time. WINDFOR runs are published at hh:30 and FUELHH every half-hour, so a 09:00
    # cut-off sees exactly the data a buyer has at either gate closure (the 09:30 run is too late).
    default_decision_hour: int = 9

    # Rolling window of *already-known* errors used to build the uncertainty band.
    band_lookback_days: int = 14

    # Raw-data window. Includes a warm-up period before January so that the uncertainty band
    # for the first decisions can be built only from errors observable at decision time.
    actuals_from: datetime = datetime(2025, 12, 17, tzinfo=timezone.utc)
    actuals_to: datetime = datetime(2026, 2, 2, tzinfo=timezone.utc)
    forecasts_published_from: datetime = datetime(2025, 12, 14, tzinfo=timezone.utc)
    forecasts_published_to: datetime = datetime(2026, 2, 2, tzinfo=timezone.utc)

    # Horizon analysis: lead times (hours) evaluated on the accuracy page.
    max_horizon_hours: int = 48

    # "snapshot" = read the committed CSVs (fast, deterministic); "live" = fetch from Elexon.
    data_source: str = os.getenv("DATA_SOURCE", "snapshot")
    data_dir: Path = Path(os.getenv("DATA_DIR", str(BACKEND_DIR / "data")))

    # Optional: directory with the built React app, served by FastAPI in single-container mode.
    static_dir: Path = Path(os.getenv("STATIC_DIR", str(BACKEND_DIR / "static")))


settings = Settings()
