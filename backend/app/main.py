"""FastAPI entrypoint. Serves the JSON API under /api and, if present, the built React app."""

from __future__ import annotations

import logging
import threading
from contextlib import asynccontextmanager
from datetime import date

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from . import service
from .config import settings

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
log = logging.getLogger(__name__)


def _warm_caches() -> None:
    try:
        service.decision_frame(settings.default_decision_hour)
        service.horizon_view()
        log.info("Analysis caches warmed")
    except Exception:  # never block start-up; the request path will surface real errors
        log.exception("Cache warm-up failed")


@asynccontextmanager
async def lifespan(_: FastAPI):
    threading.Thread(target=_warm_caches, daemon=True).start()
    yield


app = FastAPI(
    title="WindSight API",
    description="Day-ahead GB wind forecast monitoring (Elexon FUELHH & WINDFOR).",
    version="1.0.0",
    lifespan=lifespan,
)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["GET"], allow_headers=["*"])

DecisionHour = Query(
    settings.default_decision_hour,
    ge=0,
    le=23,
    description="UK local hour on D-1 when the purchase decision is made",
)


@app.get("/api/health")
def health() -> dict:
    return {"status": "ok"}


@app.get("/api/meta")
def meta() -> dict:
    return service.meta()


@app.get("/api/decision")
def decision(
    decision_date: date = Query(..., description="Day the purchase decision is made (delivery = next day)"),
    decision_hour: int = DecisionHour,
) -> dict:
    if not settings.first_decision_date <= decision_date <= settings.last_decision_date:
        raise HTTPException(
            422,
            f"decision_date must be between {settings.first_decision_date} and {settings.last_decision_date}",
        )
    try:
        return service.decision_view(decision_date, decision_hour)
    except LookupError as exc:
        raise HTTPException(404, str(exc)) from exc


@app.get("/api/accuracy")
def accuracy(decision_hour: int = DecisionHour) -> dict:
    return service.accuracy_view(decision_hour)


@app.get("/api/horizon")
def horizon() -> dict:
    return service.horizon_view()


# ---------------------------------------------------------------- single-container mode
if settings.static_dir.is_dir():
    app.mount("/assets", StaticFiles(directory=settings.static_dir / "assets"), name="assets")

    @app.get("/{path:path}", include_in_schema=False)
    def spa(path: str) -> FileResponse:
        root = settings.static_dir.resolve()
        candidate = (root / path).resolve()
        if path and candidate.is_file() and root in candidate.parents:
            return FileResponse(candidate)
        return FileResponse(settings.static_dir / "index.html")
