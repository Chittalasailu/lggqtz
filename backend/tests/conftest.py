from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from app import service
from app.config import settings


def _ts(s: str) -> pd.Timestamp:
    return pd.Timestamp(s, tz="UTC")


def synthetic_data(seed: int = 0):
    """Synthetic actuals + forecast runs shaped like the real Elexon data."""
    rng = np.random.default_rng(seed)
    periods = pd.date_range(settings.actuals_from, settings.actuals_to, freq="30min", inclusive="left")
    hours = (periods - periods[0]) / pd.Timedelta(hours=1)
    truth = 12000 + 6000 * np.sin(hours / 30.0)
    actuals = pd.DataFrame(
        {"start_time": periods, "publish_time": periods + pd.Timedelta(minutes=30), "generation": truth}
    )

    runs = []
    publish_days = pd.date_range(
        settings.forecasts_published_from, settings.forecasts_published_to, freq="D", inclusive="left"
    )
    for day in publish_days:
        for hh in (2, 4, 7, 9, 11, 15, 18, 22):
            publish = day + pd.Timedelta(hours=hh, minutes=30)
            starts = pd.date_range(day - pd.Timedelta(hours=3), periods=73, freq="h")
            h = (starts - starts[0]) / pd.Timedelta(hours=1)
            base = 12000 + 6000 * np.sin(((starts - periods[0]) / pd.Timedelta(hours=1)) / 30.0)
            runs.append(
                pd.DataFrame(
                    {
                        "publish_time": publish,
                        "start_time": starts,
                        "generation": base + 500 + rng.normal(0, 300, len(h)),
                    }
                )
            )
    forecasts = pd.concat(runs, ignore_index=True)
    return actuals, forecasts


@pytest.fixture()
def synthetic(monkeypatch):
    data = synthetic_data()
    monkeypatch.setattr(service, "load_raw", lambda: data)
    for fn in (service.forecasts_hh, service.decision_frame, service.horizon_view):
        fn.cache_clear()
    yield data
    for fn in (service.forecasts_hh, service.decision_frame, service.horizon_view):
        fn.cache_clear()
