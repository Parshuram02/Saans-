"""Acceptance script for Phase 2: Test FIRMS and Open-Meteo clients."""

import os
import sys

# Add project root to sys.path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from backend.shared.clients import fetch_fires, fetch_wind
from core.config import CITIES, FIRMS_SOURCE_NRT


def main():
    print("Testing Open-Meteo Wind Client (Delhi)...")
    delhi = CITIES["Delhi"]
    try:
        wind = fetch_wind(delhi["lat"], delhi["lon"])
        if wind["times"] and wind["speed_kmh"] and wind["dir_from_deg"]:
            t0 = wind["times"][0]
            s0 = wind["speed_kmh"][0]
            d0 = wind["dir_from_deg"][0]
            print(f"  [SUCCESS] Open-Meteo: {len(wind['times'])} hours forecast fetched.")
            print(f"  Current wind at Delhi ({t0} UTC): {s0:.1f} km/h from {d0:.0f}°")
        else:
            print("  [ERROR] Open-Meteo returned empty hourly data.")
            sys.exit(1)
    except Exception as e:
        print(f"  [ERROR] Failed to fetch wind from Open-Meteo: {e}")
        sys.exit(1)

    print("\nTesting NASA FIRMS Active Fires Client...")
    # Check env var or .env file
    map_key = os.environ.get("FIRMS_MAP_KEY")
    if not map_key and os.path.exists(".env"):
        with open(".env", "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line.startswith("FIRMS_MAP_KEY=") and not line.startswith("#"):
                    map_key = line.split("=", 1)[1].strip().strip('"').strip("'")
                    break

    if not map_key:
        print("  [STOP] FIRMS_MAP_KEY is missing!")
        print("  Please provide your free NASA FIRMS MAP_KEY in .env or via environment variable.")
        print("  Get a free key in 30 seconds at: https://firms.modaps.eosdis.nasa.gov/api/map_key/")
        sys.exit(2)

    try:
        fires = fetch_fires(map_key, FIRMS_SOURCE_NRT, days=2)
        print(f"  [SUCCESS] NASA FIRMS returned {len(fires)} fires in Punjab/Haryana for the last 2 days.")
        if fires:
            sample = fires[0]
            print(f"  Sample fire: Lat {sample['latitude']}, Lon {sample['longitude']}, FRP {sample['frp']}, Conf {sample['confidence']}")
    except Exception as e:
        print(f"  [ERROR] Failed to fetch FIRMS fires: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()
