"""Aggregate historical FIRMS fire records into spatial grid cells.

Produces:
1. data/history_cells.json: Fire counts aggregated by cell_id and day_of_season across all years.
2. data/history_cells_by_year.json: Fire counts indexed by [cell_id]["by_year_day"][year][day]
   for strict leave-one-year-out backtesting.
"""

import json
import os
import sys
from datetime import datetime
import pandas as pd

# Add root directory to sys.path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from core.geo import cell_center, cell_id

DATA_DIR = os.path.join(os.path.dirname(__file__), "..", "data")
INPUT_CSV = os.path.join(DATA_DIR, "history_raw.csv")
OUT_CELLS_JSON = os.path.join(DATA_DIR, "history_cells.json")
OUT_BY_YEAR_JSON = os.path.join(DATA_DIR, "history_cells_by_year.json")


def day_of_season(date_str: str) -> int | None:
    """Calculate day of season where Oct 1 = 0 and Nov 30 = 60.

    Returns None if date is outside Oct 1 - Nov 30.
    """
    dt = datetime.strptime(date_str.strip(), "%Y-%m-%d")
    year = dt.year
    season_start = datetime(year, 10, 1)
    diff = (dt - season_start).days
    if 0 <= diff <= 60:
        return diff
    return None


def build_indices(csv_path: str = INPUT_CSV):
    if not os.path.exists(csv_path):
        raise FileNotFoundError(f"Input file {csv_path} not found. Run fetch_history.py first.")

    print(f"Loading {csv_path}...")
    df = pd.read_csv(csv_path)

    # Clean and filter
    df["latitude"] = pd.to_numeric(df["latitude"], errors="coerce")
    df["longitude"] = pd.to_numeric(df["longitude"], errors="coerce")
    df = df.dropna(subset=["latitude", "longitude", "acq_date"])

    years = sorted([int(y) for y in pd.to_datetime(df["acq_date"]).dt.year.unique()])
    print(f"Processing records across years: {years}")

    cells_all = {}
    cells_by_year = {}

    for _, row in df.iterrows():
        lat = float(row["latitude"])
        lon = float(row["longitude"])
        d_str = str(row["acq_date"]).strip()

        dos = day_of_season(d_str)
        if dos is None:
            continue

        yr = str(datetime.strptime(d_str, "%Y-%m-%d").year)
        cid = cell_id(lat, lon)
        c_lat, c_lon = cell_center(cid)

        # 1. Aggregated across all years
        if cid not in cells_all:
            cells_all[cid] = {"lat": c_lat, "lon": c_lon, "by_day": {}}
        day_key = str(dos)
        cells_all[cid]["by_day"][day_key] = cells_all[cid]["by_day"].get(day_key, 0) + 1

        # 2. Segmented by year
        if cid not in cells_by_year:
            cells_by_year[cid] = {"lat": c_lat, "lon": c_lon, "by_year_day": {}}
        if yr not in cells_by_year[cid]["by_year_day"]:
            cells_by_year[cid]["by_year_day"][yr] = {}
        cells_by_year[cid]["by_year_day"][yr][day_key] = (
            cells_by_year[cid]["by_year_day"][yr].get(day_key, 0) + 1
        )

    # Sort days
    for cid in cells_all:
        cells_all[cid]["by_day"] = dict(
            sorted(cells_all[cid]["by_day"].items(), key=lambda x: int(x[0]))
        )

    out_all_data = {"years": years, "cells": cells_all}

    out_by_year_data = {"years": years, "cells": cells_by_year}

    # Write files
    os.makedirs(DATA_DIR, exist_ok=True)
    with open(OUT_CELLS_JSON, "w", encoding="utf-8") as f:
        json.dump(out_all_data, f, separators=(",", ":"))
    print(f"Saved {OUT_CELLS_JSON} ({len(cells_all)} active cells, {os.path.getsize(OUT_CELLS_JSON)/1024:.1f} KB)")

    with open(OUT_BY_YEAR_JSON, "w", encoding="utf-8") as f:
        json.dump(out_by_year_data, f, separators=(",", ":"))
    print(f"Saved {OUT_BY_YEAR_JSON} ({os.path.getsize(OUT_BY_YEAR_JSON)/1024:.1f} KB)")

    # Print top 10 cells by total fire count
    ranking = []
    for cid, data in cells_all.items():
        total_fires = sum(data["by_day"].values())
        ranking.append((cid, data["lat"], data["lon"], total_fires))

    ranking.sort(key=lambda x: x[3], reverse=True)
    print("\n--- Top 10 High-Activity Stubble Burn Grid Cells ---")
    print(f"{'Rank':<5} {'Cell ID':<10} {'Center Lat':<12} {'Center Lon':<12} {'Total Fires':<12} {'District Context'}")
    for idx, (cid, c_lat, c_lon, count) in enumerate(ranking[:10], start=1):
        context = identify_district(c_lat, c_lon)
        print(f"{idx:<5} {cid:<10} {c_lat:<12.2f} {c_lon:<12.2f} {count:<12} {context}")


def identify_district(lat: float, lon: float) -> str:
    """Give approximate geographic district context for inspection."""
    if 30.1 <= lat <= 30.5 and 75.6 <= lon <= 76.1:
        return "Sangrur / Barnala (Central Punjab)"
    elif 30.7 <= lat <= 31.1 and 75.6 <= lon <= 76.1:
        return "Ludhiana district (Punjab)"
    elif 30.1 <= lat <= 30.6 and 76.1 <= lon <= 76.6:
        return "Patiala / Fatehgarh Sahib (Punjab)"
    elif 29.9 <= lat <= 30.4 and 74.7 <= lon <= 75.3:
        return "Bathinda / Mansa (Malwa, Punjab)"
    elif 30.9 <= lat <= 31.4 and 74.8 <= lon <= 75.4:
        return "Moga / Firozpur (Punjab)"
    elif 31.2 <= lat <= 31.7 and 74.8 <= lon <= 75.4:
        return "Tarn Taran / Amritsar (Majha, Punjab)"
    elif 29.5 <= lat <= 29.9 and 76.7 <= lon <= 77.2:
        return "Karnal / Panipat (Haryana)"
    elif 29.6 <= lat <= 30.0 and 76.2 <= lon <= 76.6:
        return "Kaithal / Jind (Haryana)"
    elif 29.8 <= lat <= 30.3 and 76.6 <= lon <= 77.0:
        return "Kurukshetra / Ambala (Haryana)"
    else:
        return "Punjab / Haryana agricultural belt"


if __name__ == "__main__":
    build_indices()
