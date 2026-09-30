"""Download historical FIRMS fire detections for Punjab + Haryana (2021-2025).

Covers Oct 1 to Nov 30 using VIIRS_SNPP_SP in 10-day windows.
Resume-safe: stores chunk files in data/chunks/ and aggregates into data/history_raw.csv.
"""

import csv
import glob
import os
import sys
import time
from datetime import datetime, timedelta

# Add root directory to sys.path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from backend.shared.clients import fetch_fires
from core.config import BBOX, FIRMS_SOURCE_SP

YEARS = [2021, 2022, 2023, 2024, 2025]
DATA_DIR = os.path.join(os.path.dirname(__file__), "..", "data")
CHUNKS_DIR = os.path.join(DATA_DIR, "chunks")
OUT_CSV = os.path.join(DATA_DIR, "history_raw.csv")


def get_firms_key() -> str:
    """Retrieve FIRMS MAP_KEY from environment or .env file."""
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

    raise ValueError(
        "FIRMS_MAP_KEY not found! Please set it in .env or via environment variable.\n"
        "Get a free key instantly from: https://firms.modaps.eosdis.nasa.gov/api/map_key/"
    )


def generate_windows(year: int) -> list[tuple[str, int]]:
    """Generate (start_date_str, day_count) windows for Oct 1 - Nov 30."""
    start = datetime(year, 10, 1)
    end = datetime(year, 11, 30)
    windows = []

    curr = start
    while curr <= end:
        days_remaining = (end - curr).days + 1
        window_days = min(10, days_remaining)
        windows.append((curr.strftime("%Y-%m-%d"), window_days))
        curr += timedelta(days=window_days)

    return windows


def download_all_history():
    """Download historical FIRMS data chunks with resumes and rate-limit backoff."""
    os.makedirs(CHUNKS_DIR, exist_ok=True)
    map_key = get_firms_key()

    print(f"Starting FIRMS historical download for years {YEARS} (Oct 1 - Nov 30)...")
    total_chunks = 0
    downloaded_chunks = 0

    for year in YEARS:
        windows = generate_windows(year)
        total_chunks += len(windows)
        for start_date, days in windows:
            chunk_file = os.path.join(CHUNKS_DIR, f"chunk_{year}_{start_date}_{days}.csv")
            if os.path.exists(chunk_file) and os.path.getsize(chunk_file) > 0:
                # Already downloaded
                continue

            print(f"Fetching {year} {start_date} ({days} days)...", end="", flush=True)
            max_retries = 3
            backoff = 5.0
            fires = None

            for attempt in range(max_retries):
                try:
                    fires = fetch_fires(
                        map_key=map_key,
                        source=FIRMS_SOURCE_SP,
                        days=days,
                        start_date=start_date,
                        bbox=BBOX,
                    )
                    break
                except Exception as e:
                    err_msg = str(e)
                    print(f"\n  Warning: attempt {attempt + 1} failed: {err_msg}")
                    if "limit" in err_msg.lower() or "429" in err_msg:
                        print(f"  Rate-limited by FIRMS. Backing off for {backoff:.1f}s...")
                        time.sleep(backoff)
                        backoff *= 2.0
                    else:
                        time.sleep(2.0)

            if fires is None:
                raise RuntimeError(
                    f"Failed to fetch chunk for {start_date} ({days} days) after {max_retries} attempts."
                )

            # Write chunk CSV
            with open(chunk_file, "w", newline="", encoding="utf-8") as f:
                writer = csv.DictWriter(
                    f,
                    fieldnames=["latitude", "longitude", "acq_date", "frp", "confidence"],
                )
                writer.writeheader()
                for fire in fires:
                    writer.writerow(
                        {
                            "latitude": fire["latitude"],
                            "longitude": fire["longitude"],
                            "acq_date": fire["acq_date"],
                            "frp": fire["frp"],
                            "confidence": fire["confidence"],
                        }
                    )

            print(f" {len(fires)} fires saved.")
            downloaded_chunks += 1
            # Respect rate limits
            time.sleep(1.0)

    print(f"\nDownloaded {downloaded_chunks} new chunks. Combining into {OUT_CSV}...")
    combine_chunks()


def combine_chunks():
    """Combine all chunk files into data/history_raw.csv."""
    chunk_files = sorted(glob.glob(os.path.join(CHUNKS_DIR, "chunk_*.csv")))
    if not chunk_files:
        print("No chunk files found to combine.")
        return

    all_rows = []
    seen = set()

    for cf in chunk_files:
        with open(cf, "r", encoding="utf-8") as f:
            reader = csv.DictReader(f)
            for row in reader:
                # Deduplicate by (lat, lon, acq_date, frp)
                key = (row["latitude"], row["longitude"], row["acq_date"], row["frp"])
                if key not in seen:
                    seen.add(key)
                    all_rows.append(row)

    # Sort chronologically
    all_rows.sort(key=lambda r: (r["acq_date"], float(r.get("latitude", 0))))

    with open(OUT_CSV, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(
            f, fieldnames=["latitude", "longitude", "acq_date", "frp", "confidence"]
        )
        writer.writeheader()
        writer.writerows(all_rows)

    print(f"Successfully created {OUT_CSV} with {len(all_rows):,} total fire records.")


if __name__ == "__main__":
    download_all_history()
