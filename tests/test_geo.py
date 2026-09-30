"""Unit tests for core/geo.py."""

import pytest
from core.config import CITIES, UPWIND_TOLERANCE_DEG
from core.geo import (
    haversine_km,
    bearing_deg,
    angle_diff_deg,
    is_upwind,
    cell_id,
    cell_center,
    neighbors,
)


def test_haversine_delhi_to_ludhiana():
    """Haversine Delhi to Ludhiana is about 280 km (accept 270 to 300)."""
    delhi = CITIES["Delhi"]
    ludhiana = CITIES["Ludhiana"]
    dist = haversine_km(delhi["lat"], delhi["lon"], ludhiana["lat"], ludhiana["lon"])
    assert 270.0 <= dist <= 300.0, f"Expected 270-300 km, got {dist:.2f} km"


def test_angle_diff():
    """Check compass angle difference logic across 0/360 boundary."""
    assert angle_diff_deg(350, 10) == 20.0
    assert angle_diff_deg(10, 350) == 20.0
    assert angle_diff_deg(0, 180) == 180.0
    assert angle_diff_deg(270, 90) == 180.0
    assert angle_diff_deg(45, 45) == 0.0
    assert angle_diff_deg(360, 0) == 0.0


def test_bearing_cardinal():
    """Check cardinal bearings."""
    # North
    b_north = bearing_deg(28.0, 77.0, 29.0, 77.0)
    assert abs(b_north - 0.0) < 0.1 or abs(b_north - 360.0) < 0.1

    # East
    b_east = bearing_deg(28.0, 77.0, 28.0, 78.0)
    assert abs(b_east - 90.0) < 1.0

    # South
    b_south = bearing_deg(28.0, 77.0, 27.0, 77.0)
    assert abs(b_south - 180.0) < 0.1

    # West
    b_west = bearing_deg(28.0, 77.0, 28.0, 76.0)
    assert abs(b_west - 270.0) < 1.0


def test_is_upwind_rule():
    """A fire due west of a city with a west wind (270) is upwind; with an east wind (90) it is not."""
    city_lat, city_lon = 28.6139, 77.2090
    # Fire due west (same latitude, longitude further west)
    fire_lat, fire_lon = 28.6139, 75.5000

    # With west wind (from 270 deg) -> Upwind is True
    assert is_upwind(city_lat, city_lon, fire_lat, fire_lon, wind_from_deg=270.0) is True

    # With east wind (from 90 deg) -> Upwind is False
    assert is_upwind(city_lat, city_lon, fire_lat, fire_lon, wind_from_deg=90.0) is False

    # Fire due north with NW wind (from 315) vs tolerance
    fire_north_lat, fire_north_lon = 30.0, 77.2090
    # bearing city to fire is 0. wind_from_deg is 315 -> diff is 45 > 30 tol
    assert is_upwind(city_lat, city_lon, fire_north_lat, fire_north_lon, wind_from_deg=315.0, tol=30) is False
    # with tol=50, 45 <= 50 -> True
    assert is_upwind(city_lat, city_lon, fire_north_lat, fire_north_lon, wind_from_deg=315.0, tol=50) is True


def test_cell_round_trip():
    """cell_id and cell_center round-trip (centre falls inside the same cell)."""
    test_coords = [
        (28.6139, 77.2090),
        (30.9010, 75.8573),
        (30.7333, 76.7794),
        (31.25, 74.85),
        (27.60, 73.80),
    ]

    for lat, lon in test_coords:
        cid = cell_id(lat, lon)
        c_lat, c_lon = cell_center(cid)
        cid_after = cell_id(c_lat, c_lon)
        assert cid == cid_after, f"Round trip failed for {lat}, {lon} -> {cid} vs {cid_after}"


def test_neighbors():
    """Neighbors returns 8 unique surrounding cells not including the cell itself."""
    cid = cell_id(30.0, 75.0)
    nbrs = neighbors(cid)
    assert len(nbrs) == 8
    assert len(set(nbrs)) == 8
    assert cid not in nbrs
