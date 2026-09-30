"""AWS Lambda Ingest Function Handler (Phase 9).

Scheduled via EventBridge (e.g. rate(3 hours)) or manually triggered.
1. Downloads and caches history_cells.json from S3.
2. Ingests NASA FIRMS VIIRS active fire detections.
3. Ingests Open-Meteo 10m wind direction & speed forecasts for target cities.
4. Computes 0.1° stubble risk scores and straight-line smoke arrival ETAs.
5. Persists state to Amazon DynamoDB tables (RiskCells, CitySmoke, Meta).
"""

import json
import logging
import os
import sys
from datetime import datetime, timedelta, timezone

# Ensure shared and core modules can be resolved in Lambda
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "../..")))

try:
    import boto3
except ImportError:
    boto3 = None

from backend.shared.clients import fetch_fires, fetch_wind
from backend.shared.store import write_city_smoke, write_meta, write_risk_cells
from core.config import CITIES, FIRMS_SOURCE_NRT, FIRMS_SOURCE_SP
from core.risk import compute_risk
from core.smoke import estimate_smoke

logger = logging.getLogger()
logger.setLevel(logging.INFO)

# Global in-memory cache across Lambda invocations
_CACHED_HISTORY_INDEX = None


def get_history_index(bucket_name: str, object_key: str = "history_cells.json") -> dict:
    """Retrieve history index from S3 with warm-start memory caching."""
    global _CACHED_HISTORY_INDEX
    if _CACHED_HISTORY_INDEX is not None:
        return _CACHED_HISTORY_INDEX

    s3 = boto3.client("s3")
    logger.info("Downloading %s from S3 bucket %s...", object_key, bucket_name)
    response = s3.get_object(Bucket=bucket_name, Key=object_key)
    body = response["Body"].read().decode("utf-8")
    _CACHED_HISTORY_INDEX = json.loads(body)
    logger.info("Cached %d historical cells in memory.", len(_CACHED_HISTORY_INDEX.get("cells", {})))
    return _CACHED_HISTORY_INDEX


def handler(event, context):
    logger.info("Starting Saans IngestFunction...")

    firms_key = os.environ.get("FIRMS_MAP_KEY", "").strip()
    s3_bucket = os.environ.get("S3_BUCKET_NAME", "").strip()
    table_risk = os.environ.get("TABLE_RISK_CELLS", "").strip()
    table_smoke = os.environ.get("TABLE_CITY_SMOKE", "").strip()
    table_meta = os.environ.get("TABLE_META", "").strip()

    mode = os.environ.get("MODE", "live").lower()
    replay_date = os.environ.get("REPLAY_DATE", "2024-11-01")

    now_utc = datetime.now(timezone.utc)

    if not firms_key:
        raise ValueError("Environment variable FIRMS_MAP_KEY is missing.")

    # 1. Fetch satellite fires
    if mode == "replay":
        as_of_str = replay_date
        logger.info("Replay mode enabled for date: %s", as_of_str)
        # Fetch 2-day historical fires starting 2 days before replay date
        target_dt = datetime.strptime(as_of_str, "%Y-%m-%d")
        d_start = (target_dt - timedelta(days=2)).strftime("%Y-%m-%d")
        fires = fetch_fires(firms_key, FIRMS_SOURCE_SP, days=2, start_date=d_start)
    else:
        as_of_str = now_utc.strftime("%Y-%m-%d")
        logger.info("Live mode enabled. Fetching NRT fires for %s...", as_of_str)
        fires = fetch_fires(firms_key, FIRMS_SOURCE_NRT, days=2)

    logger.info("Fetched %d active fire detections.", len(fires))

    # 2. Fetch wind forecasts for target cities
    city_winds = {}
    for city_name, coords in CITIES.items():
        if mode == "replay":
            w = fetch_wind(coords["lat"], coords["lon"], date=as_of_str)
        else:
            w = fetch_wind(coords["lat"], coords["lon"])
        city_winds[city_name] = w

    # 3. Load historical climatology index from S3
    history_index = get_history_index(s3_bucket)

    # 4. Compute risk scores
    risk_dict = compute_risk(history_index, fires, as_of_date=as_of_str)
    risk_cells = [
        {
            "cell_id": cid,
            "lat": data["lat"],
            "lon": data["lon"],
            "risk": data["risk"],
            "fires_48h": data["fires_48h"],
            "history_norm": data["history_norm"],
            "recent_norm": data["recent_norm"],
        }
        for cid, data in risk_dict.items()
    ]
    logger.info("Computed risk for %d active cells.", len(risk_cells))

    # 5. Estimate smoke arrival for each city
    cities_smoke = []
    for city_name in CITIES:
        res = estimate_smoke(city_name, fires, city_winds[city_name])
        cities_smoke.append(res)
        logger.info("City %s: Level %s, ETA %s hrs", city_name, res["level"], res["eta_hours"])

    # 6. Persist to DynamoDB
    if table_risk:
        write_risk_cells(table_risk, risk_cells)
    if table_smoke:
        write_city_smoke(table_smoke, cities_smoke)
    if table_meta:
        meta_payload = {
            "generated_at": now_utc.strftime("%Y-%m-%dT%H:%M:%SZ"),
            "mode": mode,
            "as_of": as_of_str,
            "fires_count": len(fires),
            "cells_count": len(risk_cells),
            "disclaimer": "Risk score is a heuristic estimate, not a forecast guarantee.",
        }
        write_meta(table_meta, "telemetry", meta_payload)

    return {
        "statusCode": 200,
        "body": json.dumps(
            {
                "status": "ok",
                "mode": mode,
                "as_of": as_of_str,
                "fires_ingested": len(fires),
                "cells_scored": len(risk_cells),
                "cities_updated": len(cities_smoke),
            }
        ),
    }
