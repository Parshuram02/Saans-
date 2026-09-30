# Saans — Project Status & How to Run

## Project Status: Complete (All 10 Phases)

| Phase | Description | Status |
|-------|-------------|--------|
| 0 | Scaffolding, Makefile, .gitignore, README | DONE |
| 1 | Core geo logic (haversine, bearing, cell grid) | DONE |
| 2 | NASA FIRMS + Open-Meteo clients (stdlib urllib) | DONE |
| 3 | Historical download script + cell index builder | DONE |
| 4 | Stubble burn risk scoring algorithm | DONE |
| 5 | Leave-one-year-out back-test + comparison chart | DONE |
| 6 | Smoke arrival ETA + threat level estimation | DONE |
| 7 | Local end-to-end pipeline (live + replay modes) | DONE |
| 8 | Leaflet web dashboard (dark mode, city cards, map) | DONE |
| 9 | AWS SAM template + Lambda handlers + DynamoDB store | DONE |

**Test Suite: 22/22 passing**

---

## How to Run Locally

### Step 1 — One-time setup
```powershell
cd C:\Users\prash\Desktop\Projects\delhi
python -m pip install --user -r requirements.txt
```

### Step 2 — Run the unit test suite
```powershell
python -m pytest tests/ -v
```
Expected: **22 passed**

### Step 3 — Run the LIVE pipeline (real NASA satellite data today)
Your FIRMS MAP_KEY is already saved in `.env`
```powershell
python scripts/run_pipeline_local.py
# Writes: web/data/latest.json
```

### Step 4 — Run HISTORICAL REPLAY (peak burning Nov 1, 2024)
```powershell
python scripts/run_pipeline_local.py --as-of 2024-11-01
# Writes: web/data/latest.json  (with high-fire demo data)
```

### Step 5 — Launch the web dashboard
```powershell
python -m http.server 8000 --directory web
```
Then open **http://localhost:8000** in your browser.

> The header has two mode buttons:
> - **Live Telemetry** — loads today's real satellite data
> - **Peak Replay (2024-11-01)** — loads the dramatic peak burning day demo

---

## Optional Steps

### Download real historical data (replaces sample data, ~10 min)
```powershell
python scripts/fetch_history.py          # Downloads 5 years of Oct-Nov FIRMS data
python scripts/build_history_index.py    # Builds history_cells.json index
```

### Re-run the back-test
```powershell
python scripts/backtest.py
# Outputs: data/backtest.json + data/backtest.png
```

---

## AWS Deployment (requires AWS CLI + SAM CLI installed)

```powershell
# Step 1: Build and deploy
cd backend
sam build
sam deploy --guided
# When prompted, enter your FIRMS_MAP_KEY

# Step 2: Upload climatology index to S3
aws s3 cp ../data/history_cells.json s3://BUCKET_NAME/history_cells.json

# Step 3: Trigger first ingest
aws lambda invoke --function-name saans-ingest-prod response.json

# Step 4: Point web UI at your API
# Edit web/app.js line 5:
# const API_BASE = "https://abc123.execute-api.ap-south-1.amazonaws.com";
```

---

## Project Layout

```
delhi/
|- core/                     Pure Python logic (no AWS, no network calls)
|   |- config.py             Constants (BBOX, CITIES, thresholds)
|   |- geo.py                Haversine, bearing, upwind check, cell grid
|   |- risk.py               Stubble burn risk scoring algorithm
|   |- smoke.py              Smoke arrival ETA and hazard level
|
|- backend/
|   |- shared/
|   |   |- clients.py        NASA FIRMS + Open-Meteo (urllib stdlib only)
|   |   |- store.py          DynamoDB read/write helpers
|   |- ingest/handler.py     Lambda: scheduled satellite ingestion
|   |- api/handler.py        Lambda: GET /health /risk /smoke
|   |- template.yaml         AWS SAM infrastructure (S3, DynamoDB, HttpApi)
|
|- scripts/
|   |- fetch_history.py      Multi-year FIRMS downloader (resume-safe)
|   |- build_history_index.py Aggregate fires into cell index JSON
|   |- seed_history_sample.py Offline synthetic fire data generator
|   |- backtest.py           Leave-one-year-out evaluation + chart
|   |- run_pipeline_local.py Local end-to-end runner (live + replay)
|
|- tests/                    22 unit tests (pytest)
|
|- web/
|   |- index.html            Dashboard HTML
|   |- style.css             Dark-mode design system (glassmorphism)
|   |- app.js                Leaflet map, city cards, trajectory vectors
|   |- data/
|       |- latest.json             Live pipeline output
|       |- replay_2024_11_01.json  Peak season demo data
|       |- backtest.png            Evaluation comparison chart
|
|- data/
|   |- history_raw.csv       Raw fire detection records
|   |- history_cells.json    Cell index (upload to S3 for AWS)
|   |- backtest.json         Back-test metrics
|
|- .env                      Your secrets (GITIGNORED)
|- .env.example              Template
|- requirements.txt          Offline + test dependencies
|- Makefile                  Unix make targets
|- make.bat                  Windows equivalent
```
