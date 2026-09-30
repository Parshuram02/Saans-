"""Data clients for NASA FIRMS and Open-Meteo APIs.

Uses strictly Python standard library (urllib, csv, json, io, time) so it can run
inside AWS Lambda with zero external dependencies.
"""

import csv
import io
import json
import logging
import time
import urllib.error
import urllib.request
from datetime import datetime, timedelta

try:
    from core.config import BBOX, KEEP_CONFIDENCE
except ImportError:
    from config import BBOX, KEEP_CONFIDENCE

logger = logging.getLogger(__name__)


def _http_get_with_retry(url: str, timeout: float = 30.0, max_retries: int = 2) -> str:
    """Perform HTTP GET request with retries and timeout using stdlib urllib."""
    headers = {
        "User-Agent": "Saans-Early-Warning/1.0",
        "Accept": "*/*",
    }
    req = urllib.request.Request(url, headers=headers)
    last_err = None

    for attempt in range(max_retries + 1):
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                charset = resp.headers.get_content_charset() or "utf-8"
                return resp.read().decode(charset, errors="replace")
        except urllib.error.HTTPError as e:
            last_err = e
            # Read error response body if available for clearer diagnostic
            body = ""
            try:
                body = e.read().decode("utf-8", errors="replace")
            except Exception:
                pass
            logger.warning(
                "HTTP %s on %s (attempt %d/%d): %s",
                e.code,
                url,
                attempt + 1,
                max_retries + 1,
                body,
            )
            # 4xx errors usually shouldn't retry unless 429
            if 400 <= e.code < 500 and e.code != 429:
                raise RuntimeError(f"HTTP {e.code} client error from {url}: {body}") from e
        except (urllib.error.URLError, TimeoutError, OSError) as e:
            last_err = e
            logger.warning(
                "Network error on %s (attempt %d/%d): %s",
                url,
                attempt + 1,
                max_retries + 1,
                e,
            )

        if attempt < max_retries:
            time.sleep(1.0 * (attempt + 1))

    raise RuntimeError(f"HTTP GET failed after {max_retries + 1} attempts for {url}: {last_err}")


def fetch_fires(
    map_key: str,
    source: str,
    days: int,
    start_date: str | None = None,
    bbox: dict | None = None,
) -> list[dict]:
    """Fetch active fire detections from NASA FIRMS Area API.

    API format:
    https://firms.modaps.eosdis.nasa.gov/api/area/csv/{MAP_KEY}/{SOURCE}/{west},{south},{east},{north}/{DAY_RANGE}[/{YYYY-MM-DD}]

    Args:
        map_key: NASA FIRMS Map Key
        source: Satellite source (e.g. VIIRS_SNPP_NRT or VIIRS_SNPP_SP)
        days: Day range (1 to 10)
        start_date: Optional start date string 'YYYY-MM-DD'
        bbox: Optional dict with keys 'west', 'south', 'east', 'north'

    Returns:
        List of fire dicts: [{'latitude': float, 'longitude': float, 'acq_date': str,
                              'acq_time': str, 'confidence': str, 'frp': float}, ...]
    """
    if not map_key or not map_key.strip():
        raise ValueError(
            "FIRMS_MAP_KEY is missing or empty. Please set FIRMS_MAP_KEY environment variable. "
            "Get a free key from https://firms.modaps.eosdis.nasa.gov/api/map_key/"
        )

    b = bbox or BBOX
    bbox_str = f"{b['west']},{b['south']},{b['east']},{b['north']}"
    url = f"https://firms.modaps.eosdis.nasa.gov/api/area/csv/{map_key.strip()}/{source}/{bbox_str}/{days}"
    if start_date:
        url += f"/{start_date.strip()}"

    raw_csv = _http_get_with_retry(url, timeout=30.0, max_retries=2)

    # Validate CSV response
    f = io.StringIO(raw_csv.strip())
    reader = csv.DictReader(f)

    if not reader.fieldnames or "latitude" not in [col.strip().lower() for col in reader.fieldnames]:
        # Response is an error message rather than valid CSV
        raise RuntimeError(
            f"FIRMS API returned invalid response (expected CSV with 'latitude'): {raw_csv[:400]}"
        )

    # Standardize column names (strip whitespace and lowercase)
    field_map = {col: col.strip().lower() for col in reader.fieldnames}

    fires = []
    for row in reader:
        std_row = {field_map[k]: (v.strip() if v else "") for k, v in row.items()}
        conf = std_row.get("confidence", "").lower()
        if conf and conf not in KEEP_CONFIDENCE:
            continue

        try:
            lat = float(std_row["latitude"])
            lon = float(std_row["longitude"])
            frp_raw = std_row.get("frp", "0")
            frp = float(frp_raw) if frp_raw else 0.0
            acq_date = std_row.get("acq_date", "")
            acq_time = std_row.get("acq_time", "")
            fires.append(
                {
                    "latitude": lat,
                    "longitude": lon,
                    "acq_date": acq_date,
                    "acq_time": acq_time,
                    "confidence": conf,
                    "frp": frp,
                }
            )
        except (ValueError, KeyError) as e:
            logger.debug("Skipping invalid FIRMS row: %s (error: %s)", row, e)
            continue

    return fires


def fetch_wind(lat: float, lon: float, date: str | None = None) -> dict:
    """Fetch hourly wind speed and direction from Open-Meteo.

    If date is None, queries the live forecast API (2-day forecast).
    If date is given ('YYYY-MM-DD'), queries the Open-Meteo historical archive API.

    Returns:
        dict: {"times": [...], "speed_kmh": [...], "dir_from_deg": [...]}
    """
    if date:
        # Parse date and fetch 2 days around that date
        dt = datetime.strptime(date.strip(), "%Y-%m-%d")
        dt_end = dt + timedelta(days=1)
        start_str = dt.strftime("%Y-%m-%d")
        end_str = dt_end.strftime("%Y-%m-%d")
        url = (
            f"https://archive-api.open-meteo.com/v1/archive?"
            f"latitude={lat}&longitude={lon}&start_date={start_str}&end_date={end_str}&"
            f"hourly=wind_speed_10m,wind_direction_10m&wind_speed_unit=kmh&timezone=UTC"
        )
    else:
        url = (
            f"https://api.open-meteo.com/v1/forecast?"
            f"latitude={lat}&longitude={lon}&hourly=wind_speed_10m,wind_direction_10m&"
            f"wind_speed_unit=kmh&forecast_days=2&timezone=UTC"
        )

    raw_json = _http_get_with_retry(url, timeout=30.0, max_retries=2)
    data = json.loads(raw_json)

    hourly = data.get("hourly", {})
    times = hourly.get("time", [])
    speeds = hourly.get("wind_speed_10m", [])
    directions = hourly.get("wind_direction_10m", [])

    return {
        "times": times,
        "speed_kmh": [float(s) if s is not None else 0.0 for s in speeds],
        "dir_from_deg": [float(d) if d is not None else 0.0 for d in directions],
    }
