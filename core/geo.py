"""Geospatial helper functions for Saans.

All functions are pure with zero network or external dependencies.
"""

import math
from core.config import CELL_DEG, UPWIND_TOLERANCE_DEG

EARTH_RADIUS_KM = 6371.0


def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Compute great-circle distance between two points in kilometers."""
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)

    a = (
        math.sin(dphi / 2.0) ** 2
        + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2.0) ** 2
    )
    # Numerical stability clamp
    a = min(1.0, max(0.0, a))
    c = 2.0 * math.atan2(math.sqrt(a), math.sqrt(1.0 - a))
    return EARTH_RADIUS_KM * c


def bearing_deg(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Compute the initial bearing from point 1 to point 2 in degrees (0..360)."""
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    dlambda = math.radians(lon2 - lon1)

    y = math.sin(dlambda) * math.cos(phi2)
    x = math.cos(phi1) * math.sin(phi2) - math.sin(phi1) * math.cos(phi2) * math.cos(dlambda)
    bearing_rad = math.atan2(y, x)
    return (math.degrees(bearing_rad) + 360.0) % 360.0


def angle_diff_deg(a: float, b: float) -> float:
    """Compute the smallest absolute angular difference between two compass bearings in degrees (0..180)."""
    diff = abs(a - b) % 360.0
    if diff > 180.0:
        diff = 360.0 - diff
    return diff


def is_upwind(
    city_lat: float,
    city_lon: float,
    fire_lat: float,
    fire_lon: float,
    wind_from_deg: float,
    tol: float = UPWIND_TOLERANCE_DEG,
) -> bool:
    """Check if a fire is upwind of a city given the direction wind blows FROM.

    Open-Meteo wind_direction_10m is the direction the wind blows FROM (e.g. 270 =
    west wind, blowing toward the east). A fire is upwind of the city if the bearing
    from the city to the fire is within `tol` degrees of `wind_from_deg`.
    """
    bearing_to_fire = bearing_deg(city_lat, city_lon, fire_lat, fire_lon)
    return angle_diff_deg(bearing_to_fire, wind_from_deg) <= tol


def cell_id(lat: float, lon: float, cell_deg: float = CELL_DEG) -> str:
    """Return canonical cell ID string for a given lat/lon coordinate.

    Uses epsilon rounding to prevent floating-point floor artifacts (e.g., 30.65 / 0.1).
    """
    i = math.floor(round(lat / cell_deg, 9))
    j = math.floor(round(lon / cell_deg, 9))
    return f"{i}_{j}"


def cell_center(cid: str, cell_deg: float = CELL_DEG) -> tuple[float, float]:
    """Return the center (lat, lon) coordinates of a cell ID."""
    parts = cid.split("_")
    i = int(parts[0])
    j = int(parts[1])
    lat = round((i + 0.5) * cell_deg, 6)
    lon = round((j + 0.5) * cell_deg, 6)
    return lat, lon


def neighbors(cid: str) -> list[str]:
    """Return list of cell IDs for the 8 surrounding grid cells."""
    parts = cid.split("_")
    i = int(parts[0])
    j = int(parts[1])
    res = []
    for di in (-1, 0, 1):
        for dj in (-1, 0, 1):
            if di == 0 and dj == 0:
                continue
            res.append(f"{i + di}_{j + dj}")
    return res
