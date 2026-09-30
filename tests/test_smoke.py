"""Unit tests for core/smoke.py."""

import pytest
from core.geo import haversine_km
from core.smoke import _weighted_median, estimate_smoke


def test_weighted_median():
    """Verify weighted median helper."""
    # (val, weight)
    pairs = [(10.0, 1.0), (20.0, 10.0), (30.0, 1.0)]
    assert _weighted_median(pairs) == 20.0

    # 50/50 split
    pairs2 = [(10.0, 5.0), (20.0, 5.0)]
    assert _weighted_median(pairs2) == 10.0


def test_smoke_upwind_sensible_eta_and_level():
    """Upwind fires produce a level above LOW and a sensible ETA (distance divided by speed)."""
    # Delhi is at (28.6139, 77.2090)
    # Fire cluster in central Punjab: (30.25, 75.85) ~Sangrur
    # Bearing from Delhi to Sangrur is ~310° (North-West)
    dist = haversine_km(28.6139, 77.2090, 30.25, 75.85)  # ~225 km

    # Wind blowing FROM 310° (North-West wind) at 15 km/h
    wind = {
        "times": ["2026-10-01T00:00"],
        "speed_kmh": [15.0] * 24,
        "dir_from_deg": [310.0] * 24,
    }

    # Heavy fires in Sangrur
    fires = [
        {"latitude": 30.24, "longitude": 75.84, "frp": 120.0},
        {"latitude": 30.25, "longitude": 75.85, "frp": 250.0},
        {"latitude": 30.26, "longitude": 75.86, "frp": 180.0},
    ]

    res = estimate_smoke("Delhi", fires, wind)

    assert res["city"] == "Delhi"
    assert res["upwind_fire_count"] == 3
    assert res["level"] in ("MODERATE", "HIGH")
    assert res["score"] > 50.0

    # Expected ETA: distance (~225 km) / speed (15 km/h) = ~15 hours
    expected_eta = round(dist / 15.0)
    assert res["eta_hours"] is not None
    assert abs(res["eta_hours"] - expected_eta) <= 2


def test_smoke_wind_reversed():
    """With the wind reversed the upwind count is 0 and the level is LOW."""
    # Delhi with East/SE wind (from 130° instead of 310°)
    wind = {
        "times": ["2026-10-01T00:00"],
        "speed_kmh": [15.0] * 24,
        "dir_from_deg": [130.0] * 24,
    }

    # Fires in Punjab (NW of Delhi)
    fires = [
        {"latitude": 30.24, "longitude": 75.84, "frp": 300.0},
    ]

    res = estimate_smoke("Delhi", fires, wind)
    assert res["upwind_fire_count"] == 0
    assert res["level"] == "LOW"
    assert res["eta_hours"] is None
    assert res["score"] == 0.0


def test_smoke_calm_wind_stagnant():
    """Calm wind (< 3 km/h) returns STAGNANT level with None ETA."""
    wind = {
        "times": ["2026-10-01T00:00"],
        "speed_kmh": [1.5, 2.0, 1.8, 2.2, 1.0, 2.0],  # avg < 3.0
        "dir_from_deg": [310.0] * 6,
    }

    fires = [
        {"latitude": 30.24, "longitude": 75.84, "frp": 200.0},
    ]

    res = estimate_smoke("Delhi", fires, wind)
    assert res["level"] == "STAGNANT"
    assert res["eta_hours"] is None
    assert "lingers" in res["note"].lower()


def test_smoke_distance_cutoff():
    """Fires beyond MAX_SMOKE_DISTANCE_KM (600 km) are ignored."""
    wind = {
        "times": ["2026-10-01T00:00"],
        "speed_kmh": [15.0] * 24,
        "dir_from_deg": [310.0] * 24,
    }

    # Very distant point > 700 km away
    fires = [
        {"latitude": 35.0, "longitude": 72.0, "frp": 500.0},
    ]

    res = estimate_smoke("Delhi", fires, wind)
    assert res["upwind_fire_count"] == 0
    assert res["level"] == "LOW"
