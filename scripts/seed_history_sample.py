"""Seed sample historical FIRMS data for offline development, CI, and testing.

Generates realistic fire detections across Punjab and Haryana agricultural clusters
(Sangrur, Ludhiana, Patiala, Bathinda, Karnal, Kaithal, etc.) spanning 2021-2025
(Oct 1 to Nov 30), conforming strictly to real NASA VIIRS columns.

This allows immediate local pipeline, backtest, and UI verification before
running the full multi-year NASA API download (or when running offline).
"""

import csv
import math
import os
import random
from datetime import datetime, timedelta

DATA_DIR = os.path.join(os.path.dirname(__file__), "..", "data")
OUT_CSV = os.path.join(DATA_DIR, "history_raw.csv")

# Known burning district centroid clusters with activity weights
DISTRICT_HOTSPOTS = [
    # (name, lat, lon, radius_deg, weight)
    ("Sangrur", 30.24, 75.84, 0.25, 30),
    ("Barnala", 30.38, 75.55, 0.20, 20),
    ("Ludhiana", 30.90, 75.85, 0.30, 22),
    ("Patiala", 30.34, 76.38, 0.25, 20),
    ("Bathinda", 30.21, 74.95, 0.30, 18),
    ("Moga", 30.82, 75.17, 0.25, 16),
    ("Firozpur", 30.92, 74.61, 0.25, 14),
    ("Tarn Taran", 31.45, 74.93, 0.25, 15),
    ("Karnal", 29.68, 76.99, 0.25, 12),
    ("Kaithal", 29.80, 76.40, 0.25, 15),
    ("Kurukshetra", 29.97, 76.88, 0.20, 10),
    ("Fatehabad", 29.51, 75.45, 0.25, 10),
    ("Jind", 29.32, 76.32, 0.20, 8),
]


def generate_sample_history(total_fires: int = 12000, seed: int = 42):
    random.seed(seed)
    os.makedirs(DATA_DIR, exist_ok=True)

    years = [2021, 2022, 2023, 2024, 2025]
    fires = []

    hotspot_weights = [h[4] for h in DISTRICT_HOTSPOTS]
    total_w = sum(hotspot_weights)
    hotspot_probs = [w / total_w for w in hotspot_weights]

    for yr in years:
        # Each year has 61 days: Oct 1 (day 0) to Nov 30 (day 60)
        # Season curve: gaussian peak around Day 32 (Nov 2) with sigma ~8 days
        fires_in_year = total_fires // len(years)

        for _ in range(fires_in_year):
            # Select day according to seasonal peak
            while True:
                day_offset = int(random.gauss(33, 9))
                if 0 <= day_offset <= 60:
                    break

            date = datetime(yr, 10, 1) + timedelta(days=day_offset)
            date_str = date.strftime("%Y-%m-%d")

            # Pick a district hotspot
            h = random.choices(DISTRICT_HOTSPOTS, weights=hotspot_probs, k=1)[0]
            name, h_lat, h_lon, radius, _ = h

            # Jitter within cluster radius
            angle = random.uniform(0, 2 * math.pi)
            dist = random.uniform(0, radius)
            lat = round(h_lat + dist * math.cos(angle), 4)
            lon = round(h_lon + dist * math.sin(angle), 4)

            # Realistic FRP (Fire Radiative Power): log-normal distribution, median ~18 MW
            frp = round(min(500.0, max(2.5, random.lognormvariate(2.8, 0.6))), 1)

            # Confidence: 80% nominal ('n'), 20% high ('h')
            conf = "h" if random.random() < 0.25 else "n"

            # VIIRS overpass times typically 07:30 UTC (daytime) or 19:30 UTC (night)
            acq_time = "0745" if random.random() < 0.85 else "1930"

            fires.append(
                {
                    "latitude": lat,
                    "longitude": lon,
                    "acq_date": date_str,
                    "acq_time": acq_time,
                    "confidence": conf,
                    "frp": frp,
                }
            )

    # Sort chronologically
    fires.sort(key=lambda x: (x["acq_date"], x["acq_time"]))

    with open(OUT_CSV, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(
            f, fieldnames=["latitude", "longitude", "acq_date", "frp", "confidence"]
        )
        writer.writeheader()
        for f_rec in fires:
            writer.writerow(
                {
                    "latitude": f_rec["latitude"],
                    "longitude": f_rec["longitude"],
                    "acq_date": f_rec["acq_date"],
                    "frp": f_rec["frp"],
                    "confidence": f_rec["confidence"],
                }
            )

    print(f"Generated {len(fires):,} sample historical records in {OUT_CSV}")


if __name__ == "__main__":
    generate_sample_history()
