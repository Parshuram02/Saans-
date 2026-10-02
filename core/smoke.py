"""Smoke arrival estimation and hazard leveling for target cities (Phase 6).

Pure function with zero network or external dependencies.
"""

from typing import Any, Callable
from core.config import (
    CITIES,
    MAX_SMOKE_DISTANCE_KM,
    MIN_WIND_KMH,
    SMOKE_THRESHOLDS,
    UPWIND_TOLERANCE_DEG,
)
from core.geo import cell_center, cell_id, haversine_km, is_upwind


def _weighted_median(values_and_weights: list[tuple[float, float]]) -> float:
    """Compute weighted median of (value, weight) pairs."""
    if not values_and_weights:
        return 0.0

    # Sort strictly by value
    sorted_pairs = sorted(values_and_weights, key=lambda x: x[0])
    total_weight = sum(w for _, w in sorted_pairs)

    if total_weight <= 0:
        # Fall back to unweighted median
        mid = len(sorted_pairs) // 2
        return sorted_pairs[mid][0]

    half_weight = total_weight / 2.0
    cum_weight = 0.0

    for val, weight in sorted_pairs:
        cum_weight += weight
        if cum_weight >= half_weight:
            return val

    return sorted_pairs[-1][0]


def estimate_smoke(
    city: str | dict[str, Any],
    fires: list[dict[str, Any]],
    wind_city: dict[str, list[Any]],
    wind_source_fn: Callable[[float, float], dict] | None = None,
    now_hour_index: int = 0,
) -> dict[str, Any]:
    """Estimate incoming smoke arrival time (ETA) and threat level for a target city.

    Args:
        city: City name string (key in CITIES) or dict with 'lat', 'lon', and optional 'name'
        fires: List of recent fire dicts [{'latitude': float, 'longitude': float, 'frp': float}, ...]
        wind_city: Dict from Open-Meteo with 'times', 'speed_kmh', 'dir_from_deg'
        wind_source_fn: Optional callable for future multi-point atmospheric wind models
        now_hour_index: Starting hour index in the wind forecast arrays (default 0)

    Returns:
        dict: {
            "city": str,
            "level": "LOW" | "MODERATE" | "HIGH" | "STAGNANT",
            "eta_hours": int | None,
            "upwind_fire_count": int,
            "score": float,
            "wind": {"from_deg": float, "speed_kmh": float},
            "top_sources": list[dict],
            "note": str
        }
    """
    # 0. Resolve city coordinates
    if isinstance(city, str):
        city_name = city
        if city_name not in CITIES:
            raise KeyError(f"City '{city_name}' not found in configured CITIES.")
        city_coords = CITIES[city_name]
    else:
        city_name = city.get("name", "Target City")
        city_coords = city

    city_lat = float(city_coords["lat"])
    city_lon = float(city_coords["lon"])

    # 1. Parse wind at city
    speeds = wind_city.get("speed_kmh", [])
    directions = wind_city.get("dir_from_deg", [])

    idx = max(0, min(now_hour_index, len(speeds) - 1)) if speeds else 0
    wind_speed_now = float(speeds[idx]) if idx < len(speeds) else 0.0
    wind_from_now = float(directions[idx]) if idx < len(directions) else 0.0

    # 2. Check for stagnant wind (average speed over next 6 hours < MIN_WIND_KMH)
    speeds_6h = speeds[idx : idx + 6]
    avg_speed_6h = (sum(speeds_6h) / len(speeds_6h)) if speeds_6h else wind_speed_now

    if avg_speed_6h < MIN_WIND_KMH:
        return {
            "city": city_name,
            "level": "STAGNANT",
            "eta_hours": None,
            "upwind_fire_count": 0,
            "score": 0.0,
            "wind": {
                "from_deg": round(wind_from_now, 1),
                "speed_kmh": round(wind_speed_now, 1),
            },
            "top_sources": [],
            "note": (
                f"Average wind speed ({avg_speed_6h:.1f} km/h) over the next 6 hours is below {MIN_WIND_KMH:.0f} km/h. "
                "Smoke lingers and accumulates locally rather than traveling in a directional plume."
            ),
        }

    # 3. Aggregate fires into clusters by 0.1° grid cell
    clusters_by_cell: dict[str, dict[str, Any]] = {}
    for f in fires:
        f_lat = float(f["latitude"])
        f_lon = float(f["longitude"])
        f_frp = float(f.get("frp", 0.0) or 0.0)

        cid = cell_id(f_lat, f_lon)
        if cid not in clusters_by_cell:
            c_lat, c_lon = cell_center(cid)
            dist_km = haversine_km(city_lat, city_lon, c_lat, c_lon)
            clusters_by_cell[cid] = {
                "cid": cid,
                "lat": c_lat,
                "lon": c_lon,
                "fires": 0,
                "frp": 0.0,
                "distance_km": dist_km,
            }

        clusters_by_cell[cid]["fires"] += 1
        clusters_by_cell[cid]["frp"] += f_frp

    # Filter out clusters farther than MAX_SMOKE_DISTANCE_KM
    nearby_clusters = [
        c for c in clusters_by_cell.values() if c["distance_km"] <= MAX_SMOKE_DISTANCE_KM
    ]

    # 4. Filter for upwind clusters
    upwind_clusters = []
    for c in nearby_clusters:
        if is_upwind(
            city_lat=city_lat,
            city_lon=city_lon,
            fire_lat=c["lat"],
            fire_lon=c["lon"],
            wind_from_deg=wind_from_now,
            tol=UPWIND_TOLERANCE_DEG,
        ):
            upwind_clusters.append(c)

    # 5. Wind speed for ETA transport (mean of next 12 hours, at least MIN_WIND_KMH)
    speeds_12h = speeds[idx : idx + 12]
    avg_speed_12h = (sum(speeds_12h) / len(speeds_12h)) if speeds_12h else avg_speed_6h
    transport_speed = max(MIN_WIND_KMH, avg_speed_12h)

    # 6. Incoming smoke score and cluster ETAs
    smoke_score = 0.0
    eta_pairs: list[tuple[float, float]] = []

    for c in upwind_clusters:
        dist = c["distance_km"]
        frp = c["frp"]
        # Score contribution: frp / (1 + distance_km / 100)
        smoke_score += frp / (1.0 + (dist / 100.0))

        cluster_eta = dist / transport_speed
        # Weight cluster ETA by its total FRP (or fire count if FRP is 0)
        weight = max(1.0, frp)
        eta_pairs.append((cluster_eta, weight))

    # FRP-weighted median ETA
    if eta_pairs:
        raw_median_eta = _weighted_median(eta_pairs)
        rounded_eta = round(raw_median_eta)
        # Cap at 48 hours; return None beyond that
        eta_hours = int(rounded_eta) if rounded_eta <= 48 else None
    else:
        eta_hours = None

    # 7. Threat Level classification
    if smoke_score < SMOKE_THRESHOLDS["LOW"]:
        level = "LOW"
    elif smoke_score <= SMOKE_THRESHOLDS["MODERATE"]:
        level = "MODERATE"
    else:
        level = "HIGH"

    # 8. Sort top sources by FRP contribution
    upwind_clusters.sort(key=lambda c: c["frp"], reverse=True)
    top_sources = [
        {
            "lat": c["lat"],
            "lon": c["lon"],
            "fires": c["fires"],
            "frp": round(c["frp"], 1),
            "distance_km": round(c["distance_km"], 1),
        }
        for c in upwind_clusters[:5]
    ]

    total_upwind_fires = sum(c["fires"] for c in upwind_clusters)

    speeds_hourly = [round(s, 1) for s in speeds] if speeds else [round(wind_speed_now, 1)]
    dirs_hourly = [round(d, 1) for d in directions] if directions else [round(wind_from_now, 1)]

    return {
        "city": city_name,
        "lat": city_lat,
        "lon": city_lon,
        "level": level,
        "eta_hours": eta_hours,
        "upwind_fire_count": total_upwind_fires,
        "score": round(smoke_score, 1),
        "wind": {
            "from_deg": round(wind_from_now, 1),
            "speed_kmh": round(wind_speed_now, 1),
            "speed_kmh_hourly": speeds_hourly,
            "dir_from_deg_hourly": dirs_hourly,
        },
        "top_sources": top_sources,
        "note": "Straight-line, first-order estimate using surface wind at the city.",
    }

