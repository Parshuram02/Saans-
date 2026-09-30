"""Local end-to-end pipeline runner for Saans (Phase 7).

Can run in Live Mode (fetching real-time NASA FIRMS NRT fires + forecast wind)
or Replay Mode (--as-of YYYY-MM-DD, using historical fires and Open-Meteo archive wind).

Outputs web/data/latest.json.
"""

import argparse
import json
import os
import sys
from datetime import datetime, timedelta, timezone

# Add root directory to sys.path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from backend.shared.clients import fetch_fires, fetch_wind
from core.config import CITIES, FIRMS_SOURCE_NRT, FIRMS_SOURCE_SP
from core.risk import compute_risk
from core.smoke import estimate_smoke

DATA_DIR = os.path.join(os.path.dirname(__file__), "..", "data")
HISTORY_CELLS_PATH = os.path.join(DATA_DIR, "history_cells.json")
HISTORY_RAW_PATH = os.path.join(DATA_DIR, "history_raw.csv")
WEB_DATA_PATH = os.path.join(os.path.dirname(__file__), "..", "web", "data", "latest.json")


def get_firms_key() -> str | None:
    """Retrieve FIRMS_MAP_KEY if available."""
    key = os.environ.get("FIRMS_MAP_KEY")
    if key and key.strip():
        return key.strip()

    env_path = os.path.join(os.path.dirname(__file__), "..", ".env")
    if os.path.exists(env_path):
        with open(env_path, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line.startswith("FIRMS_MAP_KEY=") and not line.startswith("#"):
                    val = line.split("=", 1)[1].strip().strip('"').strip("'")
                    if val:
                        return val
    return None


def load_history_index() -> dict:
    if not os.path.exists(HISTORY_CELLS_PATH):
        raise FileNotFoundError(
            f"History index {HISTORY_CELLS_PATH} not found. Run 'make index' first."
        )
    with open(HISTORY_CELLS_PATH, "r", encoding="utf-8") as f:
        return json.load(f)


def get_replay_fires(as_of_str: str) -> list[dict]:
    """Extract fires from history_raw.csv for the 48 hours prior to as_of date."""
    target_dt = datetime.strptime(as_of_str, "%Y-%m-%d")
    d1 = (target_dt - timedelta(days=2)).strftime("%Y-%m-%d")
    d2 = (target_dt - timedelta(days=1)).strftime("%Y-%m-%d")
    target_dates = {d1, d2}

    fires = []
    if os.path.exists(HISTORY_RAW_PATH):
        import csv

        with open(HISTORY_RAW_PATH, "r", encoding="utf-8") as f:
            reader = csv.DictReader(f)
            for row in reader:
                if row.get("acq_date") in target_dates:
                    try:
                        fires.append(
                            {
                                "latitude": float(row["latitude"]),
                                "longitude": float(row["longitude"]),
                                "acq_date": row["acq_date"],
                                "acq_time": row.get("acq_time", ""),
                                "confidence": row.get("confidence", "n"),
                                "frp": float(row.get("frp", 0.0) or 0.0),
                            }
                        )
                    except (ValueError, KeyError):
                        continue

    if not fires:
        # If not present in history_raw.csv, try fetching with FIRMS API if key is available
        key = get_firms_key()
        if key:
            print(f"Fetching 2-day historical fires starting {d1} from NASA FIRMS SP API...")
            fires = fetch_fires(key, FIRMS_SOURCE_SP, days=2, start_date=d1)

    return fires


def run_pipeline(as_of: str | None = None):
    print("=" * 65)
    print("        SAANS — STUBBLE FIRE EARLY WARNING PIPELINE          ")
    print("=" * 65)

    mode = "replay" if as_of else "live"
    now_utc = datetime.now(timezone.utc)

    if mode == "replay":
        as_of_str = as_of.strip()
        print(f"Mode: REPLAY of {as_of_str}")
        fires = get_replay_fires(as_of_str)
        print(f"Loaded {len(fires)} fires for the 48 hours prior to {as_of_str}.")
    else:
        as_of_str = now_utc.strftime("%Y-%m-%d")
        print(f"Mode: LIVE as of {as_of_str}")
        key = get_firms_key()
        if not key:
            print("ERROR: FIRMS_MAP_KEY is missing. Cannot fetch live fires.")
            print("Set FIRMS_MAP_KEY in .env or run with --as-of YYYY-MM-DD for historical replay.")
            sys.exit(1)
        print("Fetching live VIIRS NRT fires (last 2 days)...")
        fires = fetch_fires(key, FIRMS_SOURCE_NRT, days=2)
        print(f"Fetched {len(fires)} active fires.")

    # 1. Fetch wind for all target cities
    print("\nFetching wind data from Open-Meteo for target monitoring cities...")
    city_winds = {}
    for city_name, coords in CITIES.items():
        if mode == "replay":
            w = fetch_wind(coords["lat"], coords["lon"], date=as_of_str)
        else:
            w = fetch_wind(coords["lat"], coords["lon"])
        city_winds[city_name] = w
        speed_now = w["speed_kmh"][0] if w["speed_kmh"] else 0.0
        dir_now = w["dir_from_deg"][0] if w["dir_from_deg"] else 0.0
        print(f"  {city_name:<12}: {speed_now:.1f} km/h from {dir_now:.0f}°")

    # 2. Compute risk scores
    print("\nComputing 0.1° grid risk scores...")
    hist_index = load_history_index()
    risk_dict = compute_risk(hist_index, fires, as_of_date=as_of_str)

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
    risk_cells.sort(key=lambda x: x["risk"], reverse=True)
    print(f"Computed risk scores for {len(risk_cells)} active grid cells.")

    # 3. Estimate smoke arrival for each city
    print("\nEstimating smoke transport and threat levels...")
    cities_smoke = []
    for city_name in CITIES:
        smoke_res = estimate_smoke(city_name, fires, city_winds[city_name])
        cities_smoke.append(smoke_res)

        # Print headline sentence
        eta_text = (
            f"estimated arrival in ~{smoke_res['eta_hours']} hours"
            if smoke_res["eta_hours"] is not None
            else "ETA not applicable"
        )
        print(
            f"  * {city_name}: smoke from {smoke_res['upwind_fire_count']} upwind fires, "
            f"{eta_text}, level {smoke_res['level']} (score: {smoke_res['score']:.1f})"
        )

    # 4. Construct output JSON
    output_payload = {
        "generated_at": now_utc.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "mode": mode,
        "as_of": as_of_str,
        "disclaimer": "Risk score is a heuristic estimate, not a forecast guarantee.",
        "risk_cells": risk_cells,
        "fires": [
            {
                "lat": f["latitude"],
                "lon": f["longitude"],
                "frp": f["frp"],
                "acq_date": f.get("acq_date", ""),
                "acq_time": f.get("acq_time", ""),
            }
            for f in fires
        ],
        "cities": cities_smoke,
    }

    os.makedirs(os.path.dirname(WEB_DATA_PATH), exist_ok=True)
    with open(WEB_DATA_PATH, "w", encoding="utf-8") as f:
        json.dump(output_payload, f, separators=(",", ":"))

    print(f"\nSuccessfully generated {WEB_DATA_PATH} ({os.path.getsize(WEB_DATA_PATH)/1024:.1f} KB)")
    print("=" * 65)


def main():
    parser = argparse.ArgumentParser(description="Run Saans Early Warning Pipeline locally.")
    parser.add_argument(
        "--as-of",
        dest="as_of",
        help="Date for historical replay (YYYY-MM-DD). If omitted, runs in live mode.",
        default=None,
    )
    parser.add_argument(
        "--out",
        dest="out",
        help="Output JSON file path (default: web/data/latest.json)",
        default=None,
    )
    args = parser.parse_args()
    if args.out:
        global WEB_DATA_PATH
        WEB_DATA_PATH = os.path.abspath(args.out)
    run_pipeline(args.as_of)


if __name__ == "__main__":
    main()
