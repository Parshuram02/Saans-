"""Unit tests for core/risk.py."""

import pytest
from core.geo import cell_id, neighbors
from core.risk import compute_risk, get_day_of_season


def test_day_of_season_calculation():
    """Verify Oct 1 = 0 and Nov 30 = 60, with out of season clamping."""
    from datetime import date

    # Oct 1
    d0, off0 = get_day_of_season(date(2024, 10, 1))
    assert d0 == 0
    assert off0 is False

    # Nov 30
    d60, off60 = get_day_of_season(date(2024, 11, 30))
    assert d60 == 60
    assert off60 is False

    # Oct 15
    d14, off14 = get_day_of_season(date(2024, 10, 15))
    assert d14 == 14
    assert off14 is False

    # Dec 5 (off season, clamped to 60)
    d_dec, off_dec = get_day_of_season(date(2024, 12, 5))
    assert d_dec == 60
    assert off_dec is True

    # Sep 20 (off season, clamped to 0)
    d_sep, off_sep = get_day_of_season(date(2024, 9, 20))
    assert d_sep == 0
    assert off_sep is True


def test_risk_score_bounds_and_ranking():
    """A cell with many historic fires and recent neighbours scores higher than an isolated quiet cell.
    Result is bounded 0 to 100."""
    active_cid = "302_758"  # Sangrur center
    quiet_cid = "280_770"   # Far away cell

    nbr = neighbors(active_cid)[0]

    history_index = {
        "cells": {
            active_cid: {
                "lat": 30.25,
                "lon": 75.85,
                "by_day": {"30": 80, "31": 100, "32": 90},
            },
            quiet_cid: {
                "lat": 28.05,
                "lon": 77.05,
                "by_day": {"30": 1},
            },
        }
    }

    # Recent fires near active cell and its neighbor
    recent_fires = [
        {"latitude": 30.24, "longitude": 75.84, "frp": 60.0},
        {"latitude": 30.26, "longitude": 75.86, "frp": 80.0},
        # Fire in neighbor cell
        {"latitude": 30.35, "longitude": 75.85, "frp": 45.0},
    ]

    scores = compute_risk(history_index, recent_fires, as_of_date="2024-11-01")

    # Both cells should be present
    assert active_cid in scores
    assert quiet_cid in scores

    # Active cell scores significantly higher than quiet cell
    assert scores[active_cid]["risk"] > scores[quiet_cid]["risk"]
    assert scores[active_cid]["risk"] > 50.0

    # Bounds check 0..100 across all returned cells
    for cid, val in scores.items():
        assert 0.0 <= val["risk"] <= 100.0
        assert 0.0 <= val["history_norm"] <= 1.0
        assert 0.0 <= val["recent_norm"] <= 1.0


def test_empty_recent_fires_returns_history_score():
    """Empty recent fires still returns history-based scores."""
    cid1 = "302_758"
    history_index = {
        "cells": {
            cid1: {
                "lat": 30.25,
                "lon": 75.85,
                "by_day": {"30": 50},
            }
        }
    }

    # No recent fires
    scores = compute_risk(history_index, recent_fires=[], as_of_date="2024-11-01")
    assert cid1 in scores
    # With W_HISTORY=0.5 and W_RECENT=0.5, history_norm=1.0 and recent_norm=0.0 -> risk=50.0
    assert scores[cid1]["risk"] == 50.0
    assert scores[cid1]["fires_48h"] == 0
    assert scores[cid1]["recent_norm"] == 0.0
    assert scores[cid1]["history_norm"] == 1.0
