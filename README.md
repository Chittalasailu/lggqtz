# WindSight: GB day-ahead wind forecast monitor

WindSight is a web app for a UK utility's day-ahead power purchasing team. It answers two questions for every
purchase decision made in **January 2026**:

1. **What did the latest national wind forecast say at the moment I had to buy?**
2. **How accurate was that forecast, in numbers, so I can buy with the error in mind?**

**Live demo: https://wind-forecast-monitor-six.vercel.app**

It uses only two public Elexon BMRS datasets: **FUELHH** (actual wind generation, `fuelType = WIND`) and **WINDFOR**
(national wind generation forecasts).

| | |
|---|---|
| Frontend | React 18 + TypeScript + Vite + Recharts |
| Backend | Python 3.12 · FastAPI · pandas |
| Packaging | One Docker image (frontend built into the API container) · docker compose |
| Deploy | Vercel (static site + Python function) **or** Heroku (container via `heroku.yml`) |
| Quality | pytest (23 tests, incl. a regression test on the real data) · Vitest · ruff · TypeScript strict · GitHub Actions CI |

---

## Key findings from the pilot (January 2026, 09:00 decision time)

The default decision time is **09:00 UK on the day before delivery**, just before the GB day-ahead auctions close
(09:20 EPEX, 09:50 Nord Pool). WINDFOR runs are published at hh:30, so a buyer at either gate closure has exactly the
forecast available at 09:00 (the 07:30 run). Any other hour can be picked in the app.

| Metric | Published forecast | Bias-adjusted forecast | Naive baseline |
|---|---|---|---|
| Mean absolute error | **2.02 GW** (17.9% of mean wind output) | **1.56 GW** (−23%) | 4.11 GW |
| Bias (forecast − actual) | **+1.74 GW** | +0.73 GW | 0.00 GW |
| RMSE | 2.50 GW | 2.01 GW | 5.34 GW |
| P10–P90 band hit rate (half-hours) | **81.0%** (target 80%) | | |

* **The forecast is worth using.** Its typical error is about half (−51%) that of a naive guess that wind stays at
  the last level known at decision time (the "naive baseline", built from FUELHH only).
* It ran **consistently above** metered wind output (FUELHH): the gap is still about 1.5 GW at zero lead time, so it
  is systematic. Part of it is likely curtailment and differences in what the two datasets cover, so it is a gap to
  metered output rather than pure weather-forecast error (see the caveat below).
* Either way the gap is persistent, so a simple daily correction (subtract the median error of the previous 14 days,
  using only errors **already known at decision time**) cuts the typical error by about 23%.
* The empirical P10–P90 band is **well calibrated**: actual wind fell inside it 81.0% of half-hours, against a
  target of 80%. The daily "firm wind floor" (the half-hourly P10s added up) held on 87% of delivery days (27 of 31).
* Accuracy gets steadily worse with lead time: MAE is about 1.67 GW at 0 h, 1.93 GW at 24 h and 2.31 GW at 48 h. A
  09:00 decision covers lead times of 16.5–40 h.

---

## Features

**Day-ahead decision tab**
* Pick any decision day (1–31 Jan) and any decision time (default **09:00 UK**, just before GB day-ahead gate
  closure).
* Shows the **latest forecast run published at or before the decision time**, when it was published and how far
  ahead it looks.
* KPIs for the delivery day: published forecast energy, **bias-adjusted P50**, **firm wind floor** (summed
  half-hourly P10s), forecast range, and the hindsight actual.
* Chart: published forecast, bias-adjusted line, P10–P90 band, actual outturn (can be turned off), and optionally
  every other forecast run (earlier runs solid, runs published after the decision dashed). Includes a data table.

**Forecast accuracy tab**
* MAE, RMSE, bias, nMAE, bias-adjusted MAE, naive-baseline MAE, band hit rate, firm-wind-floor hit rate, P10/P90
  error, worst miss.
* Daily energy error (GWh), coloured by direction (short or long on wind).
* **Accuracy vs. lead time** (0–48 h), with the day-ahead window highlighted.
* Error distribution histogram and error by hour of day.
* Daily scorecard table.

**Method & data tab**: plain-English definitions and assumptions.

---

## Method and assumptions

| Topic | Decision |
|---|---|
| Decisions in scope | Made on **1–31 Jan 2026**, so delivery days are **2 Jan – 1 Feb 2026** |
| Decision time | UK local hour on D-1, default 09:00 (just before GB day-ahead gate closure at 09:20 EPEX / 09:50 Nord Pool); can be changed |
| Delivery day | UK local calendar day (DST-aware, handled with `zoneinfo`/pandas tz) |
| Forecast selection | For each half-hour, the latest WINDFOR value with `publishTime ≤ decision time`. Implemented with `pandas.merge_asof(direction="backward", by="start_time")`. **No look-ahead is possible by construction**, and tests check this |
| Resolution | WINDFOR is hourly and FUELHH half-hourly. Each :30 value is the midpoint of the two hourly points **of the same run**. Gaps over 1 h are not filled. Scoring only the on-the-hour points gives the same MAE and bias, so the interpolation does not move the results |
| Error sign | `error = forecast − actual`. Positive means the buyer is short on wind |
| Uncertainty band | For delivery day D: the 10/50/90th percentiles of errors from the previous 14 days **whose actuals were published before D's decision time**. P10 = forecast − q90, P50 = forecast − q50, P90 = forecast − q10 |
| Firm wind floor | Sum of the half-hourly P10s for the day. Quantiles do not add up, so this is a cautious floor, not a daily P10; the accuracy tab reports how often it held |
| Naive baseline | The last FUELHH actual published at decision time, held flat for the whole delivery day. Shows what the forecast adds over no forecast |
| Warm-up | Data from mid-December 2025 is loaded so the first January decisions also have a band, built only from information available at that time. The data is used for band history only and is not scored |
| Lead-time analysis | For N = 0…48 h: the latest forecast published at least N h before each target half-hour |

**Caveat.** Some of the systematic gap is probably caused by curtailment and by differences in what FUELHH (metered
output) and WINDFOR cover, not only by weather-forecast error. The pilot sticks to the two datasets in the brief. A
production version should look into this with the data provider.

---

## Architecture

```
               ┌──────────────────────── Docker image / Vercel ────────────────────────┐
 Browser ───►  │  React SPA (Vite build)  ──/api/*──►  FastAPI  (app/main.py)            │
               │   DecisionView                          │                               │
               │   AccuracyView                          ▼                               │
               │   MethodView                     service.py  (orchestration + caches)   │
               │                                          │                               │
               │                         ┌────────────────┴───────────┐                   │
               │                         ▼                            ▼                   │
               │                  analysis.py                 repository.py               │
               │          (pure functions, no I/O)    snapshot CSV  │  live Elexon API     │
               │                                                    ▼                     │
               │                                             elexon.py (chunked, retry)   │
               └─────────────────────────────────────────────────────────────────────────┘
```

* **`elexon.py`**: thin HTTP client for the `/datasets/{FUELHH|WINDFOR}/stream` endpoints. Requests are chunked by
  week and retried with backoff.
* **`repository.py`**: loads data from the **committed snapshot** (`backend/data/*.csv`, the default: fast and
  reproducible, with no runtime dependency on Elexon) or live (`DATA_SOURCE=live`). Refresh the snapshot with
  `python -m app.ingest`.
* **`analysis.py`**: all the domain logic as **pure, unit-tested functions** (interpolation, decision cut-off,
  as-of forecast selection, band, metrics, lead-time curve).
* **`service.py`**: builds API responses and memoises results per decision hour (`lru_cache`). Caches are warmed
  in a background thread at start-up. After warm-up, responses take about 20–300 ms.
* **`main.py`**: FastAPI routes plus input validation. In single-container mode it also serves the built React app
  (with a path-traversal guard).
* **Frontend**: typed API client (`api.ts`), a small `useApi` hook (abort on change, keeps the last data while
  reloading), formatting helpers that always show **UK local time**, and one component per tab. Chart colours come
  from a colour-blind-validated categorical palette with separate light and dark theme values.

### API

| Endpoint | Description |
|---|---|
| `GET /api/health` | Liveness |
| `GET /api/meta` | Scope, defaults, data-set stats |
| `GET /api/decision?decision_date=2026-01-15&decision_hour=11` | Forecast at decision time, band, KPIs, half-hourly series, forecast runs |
| `GET /api/accuracy?decision_hour=11` | Overall and bias-adjusted metrics, daily, by hour, histogram |
| `GET /api/horizon` | Accuracy vs. lead time 0–48 h |

Interactive docs: `http://localhost:8000/docs` locally, or https://wind-forecast-monitor-six.vercel.app/docs.

---

## Running it

### Docker (recommended)

```bash
docker compose up --build
```

Then open http://localhost:8000.

### Local development

```bash
# backend (http://localhost:8000)
cd backend
python -m venv .venv
source .venv/bin/activate       # Windows: .venv\Scripts\activate
pip install -r requirements-dev.txt
uvicorn app.main:app --reload

# frontend (http://localhost:5173, proxies /api to :8000)
cd frontend
npm install
npm run dev
```

### Tests and checks

```bash
cd backend  && pytest -q && ruff check . && ruff format --check .
cd frontend && npm run typecheck && npm test && npm run build
```

### Refresh the data snapshot

```bash
cd backend && python -m app.ingest
```

---

## Deployment

**Vercel** (free tier): `vercel.json` builds the React app as static files and deploys `api/index.py` as a Python
serverless function wrapping the same FastAPI app, with the data snapshot bundled in.

```bash
npm i -g vercel
vercel          # first run links the project
vercel --prod
```

**Heroku** (container stack): `heroku.yml` builds the root `Dockerfile`, and `$PORT` is honoured.

```bash
heroku create <app-name>
heroku stack:set container -a <app-name>
git push heroku main
```

Live demo: **https://wind-forecast-monitor-six.vercel.app**

---

## Project structure

```
backend/
  app/            config, elexon client, repository, analysis, service, FastAPI app, ingest CLI
  data/           committed January 2026 snapshot (FUELHH wind + WINDFOR)
  tests/          unit tests (analysis), API tests on synthetic data, regression test on the snapshot
frontend/
  src/            App, components/ (DecisionView, AccuracyView, MethodView, ui), api.ts, format.ts
api/index.py      Vercel function entrypoint
Dockerfile        multi-stage build: frontend + API in one image
docker-compose.yml, heroku.yml, vercel.json, .github/workflows/ci.yml
```

## Development practices

* **No-look-ahead guarantee** is enforced in code (`merge_asof` backward on publish time, band and baseline built
  only from already-published actuals) and covered by dedicated tests.
* A regression test runs the analysis on the committed snapshot and pins the figures quoted in this README.
* Pure domain logic is kept apart from I/O and HTTP, so it is easy to test and review.
* Typed end to end: Pydantic/FastAPI query validation on the backend, strict TypeScript on the frontend.
* Reproducible: pinned dependencies, committed data snapshot, one Docker image.
* CI runs lint, format check, backend and frontend tests, a production build, and a Docker build plus smoke test on
  every push.
* Accessibility: every chart has a legend and a data table, colours were checked for colour-blind safety, and the
  app works in light/dark mode and at mobile widths.

## Limitations and next steps

* National wind only; other renewables, demand and price data are out of scope for this pilot.
* The band is unconditional (one per day). Conditioning on forecast level, lead time or weather regime would make
  it sharper.
* Look into the systematic bias against FUELHH (curtailment, metering coverage) with the data provider.
* Schedule automatic daily ingestion and add alerts when the forecast changes a lot between runs.

## Use of AI tools

AI-assisted development tools were used while building this project, for example for code suggestions and drafting
documentation. All design decisions, analysis and results were reviewed and checked by the author.
