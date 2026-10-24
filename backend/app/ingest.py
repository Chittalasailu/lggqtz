"""Refresh the committed data snapshot from Elexon.

Usage (from backend/):  python -m app.ingest
"""

from __future__ import annotations

import logging

from .config import settings
from .repository import fetch_live, save_snapshot


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    actuals, forecasts = fetch_live()
    save_snapshot(actuals, forecasts, settings.data_dir)
    logging.info(
        "Saved %d actuals and %d forecast rows (%d runs) to %s",
        len(actuals),
        len(forecasts),
        forecasts.publish_time.nunique(),
        settings.data_dir,
    )


if __name__ == "__main__":
    main()
