# Saans (साँस) — Stubble Fire Early Warning System

> **Environmental Hacks Hackathon — Track: Air (Module 1)**  
> *Early warning risk scoring and smoke arrival estimation for Delhi-NCR and Indo-Gangetic Plains.*

---

## Problem

Every post-monsoon autumn (October–November), harvesting of paddy crops across Punjab and Haryana leaves farmers with narrow 10–14 day windows to prepare fields for wheat sowing. Over 20 million tons of paddy residue (paddy straw) are burnt in open fields.

North-westerly winds consistently transport smoke plumes straight into the bowl-like geography of Delhi-NCR, creating severe air quality emergencies (AQI 450–999+). Traditional air quality forecasts either alert citizens after particulate matter has already settled or rely on complex numerical chemistry models that are slow and opaque.

Citizens and administrative bodies need transparent, near-real-time visibility:
1. Where are fires concentrating right now?
2. Which cells have the highest immediate burn risk based on seasonal patterns and recent ignition clusters?
3. In how many hours will smoke from upwind fires hit target cities (Delhi, Ludhiana, Chandigarh)?

---

## What It Does

Saans Module 1 ingests satellite detections, evaluates geospatial stubble-burn risk, calculates straight-line meteorological smoke arrival times, and presents the intelligence via a responsive web interface:

- **Satellite Ingestion:** Near-real-time thermal detections from NASA FIRMS VIIRS (375m resolution).
- **Grid Risk Scoring (0.1° ~10 km):** A transparent heuristic score combining historical hotspot climatology (±7 day window) and recent 48-hour fire intensity with spatial neighborhood diffusion.
- **Upwind Smoke Transport Model:** City-specific smoke plume estimation evaluating wind vectors, identifying upwind fire clusters, computing FRP-weighted arrival hours (ETA), and assigning threat levels (**LOW**, **MODERATE**, **HIGH**, or **STAGNANT**).
- **Headline Output:** Clear, actionable summary sentences such as:
  > *"Delhi: smoke from 34 upwind fires, estimated arrival in 14 hours, level HIGH."*
- **Interactive Map:** Web map visualizing grid risk cells, thermal fire points, wind direction indicators, and upwind trajectory links.

---

## Honest Limitations

Saans is a risk scoring and estimation tool, not an absolute atmospheric transport forecast. The UI and calculations adhere to the following honest constraints:

1. **Satellite Pass Gaps:** NASA FIRMS VIIRS (SNPP / NOAA) passes over northwestern India a few times per day (primarily ~13:30 and ~01:30 local time). Cloud cover or fires ignited between satellite overpasses may experience delayed detection.
2. **Heuristic Risk Model:** Risk is calculated using a transparent formula combining historical frequency and 48-hour cluster intensity; it is not a deep learning prediction and does not incorporate crop economic variables.
3. **First-Order Smoke Transport:** Arrival times use surface wind velocity (10m) at the city and straight-line trajectory approximations. Real-world smoke dispersal is subject to planetary boundary layer (PBL) height variations, atmospheric inversions, and multi-altitude wind shear.
4. **Uncalibrated Thresholds:** Smoke threat levels (Low, Moderate, High) and distance decay factors are heuristic and tunable.
5. **Replay Mode for Demonstration:** Stubble burning peaks between October 20 and November 20. Outside this window, the system provides a Historical Replay Mode (e.g., peak burning on November 1, 2024) to accurately demonstrate system behavior under emergency conditions.

---

## Architecture

```
                       +----------------------------------+
                       |    NASA FIRMS API (VIIRS NRT)    |
                       +-----------------+----------------+
                                         |
                                         v
+------------------------+     +-------------------+     +-----------------------+
| Open-Meteo Wind API    |---->| Ingest Lambda     |<----| S3: Historical Index  |
| (10m wind direction    |     | (EventBridge 3hr) |     | (history_cells.json)  |
|  & speed forecast)     |     +---------+---------+     +-----------------------+
+------------------------+               |
                                         v
                               +-------------------+
                               | Amazon DynamoDB   |
                               | - RiskCells       |
                               | - CitySmoke       |
                               | - Meta            |
                               +---------+---------+
                                         |
                                         v
+------------------------+     +-------------------+     +-----------------------+
| Leaflet Web UI         |<----+ API Gateway v2    |<----+ API Lambda            |
| (Amplify / S3 / Local) |     | (HTTP API)        |     | GET /risk, /smoke     |
+------------------------+     +-------------------+     +-----------------------+
```

- **Backend:** Pure Python 3.12, zero heavy dependencies in Lambda (uses Python stdlib `urllib`, `json`, `math`, `csv`).
- **Storage:** Amazon DynamoDB (on-demand capacity).
- **Automation:** Amazon EventBridge schedule triggers automated ingestion every 3 hours.
- **Frontend:** Pure HTML5, Modern CSS, Vanilla JavaScript, and Leaflet.js with zero build tooling required.

---

## Run Locally

### 1. Prerequisites
- Python 3.12+
- NASA FIRMS Map Key ([Get a free key here](https://firms.modaps.eosdis.nasa.gov/api/map_key/))

### 2. Setup
```bash
# Clone and enter workspace
git clone <repo-url> saans
cd saans

# Install offline & test dependencies
pip install -r requirements.txt

# Configure environment
cp .env.example .env
# Edit .env and enter your FIRMS_MAP_KEY
```

### 3. Run Tests
```bash
make test
# or
pytest tests/ -v
```

### 4. Run Local Pipeline
```bash
# Live mode (fetches real-time data)
make local

# Historical replay mode (peak burning day)
python scripts/run_pipeline_local.py --as-of 2024-11-01
```

### 5. View Web UI
```bash
make serve
# Open http://localhost:8000 in your browser
```

---

## Deploy to AWS

Deploying using the AWS Serverless Application Model (SAM):

```bash
cd backend
sam build
sam deploy --guided
```

Provide the parameter `FirmsMapKey` when prompted. After deployment, upload `data/history_cells.json` to the S3 bucket created by the stack, trigger the ingest Lambda once, and update `API_BASE` in `web/app.js` with your API Gateway endpoint.
