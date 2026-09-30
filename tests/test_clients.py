"""Unit tests for backend/shared/clients.py."""

from unittest.mock import MagicMock, patch
import pytest
from backend.shared.clients import fetch_fires, fetch_wind


def test_fetch_fires_missing_key():
    """Missing or empty map_key raises ValueError."""
    with pytest.raises(ValueError, match="FIRMS_MAP_KEY is missing"):
        fetch_fires("", "VIIRS_SNPP_NRT", 1)


@patch("backend.shared.clients._http_get_with_retry")
def test_fetch_fires_csv_parsing(mock_http):
    """Test valid CSV response from FIRMS API parses correctly."""
    mock_csv = (
        "latitude,longitude,bright_ti4,scan,track,acq_date,acq_time,satellite,instrument,confidence,version,bright_ti5,frp,daynight\n"
        "30.1234,75.5678,335.2,0.4,0.4,2024-11-01,0730,N,VIIRS,n,2.0NRT,298.1,14.5,D\n"
        "31.5432,74.9876,340.5,0.4,0.4,2024-11-01,0730,N,VIIRS,h,2.0NRT,302.2,28.3,D\n"
        "29.1111,76.2222,310.0,0.4,0.4,2024-11-01,0730,N,VIIRS,l,2.0NRT,290.0,3.1,D\n"
    )
    mock_http.return_value = mock_csv

    fires = fetch_fires("mock_key", "VIIRS_SNPP_NRT", 1)
    # 'l' confidence should be dropped, leaving 2 fires
    assert len(fires) == 2
    assert fires[0]["latitude"] == 30.1234
    assert fires[0]["longitude"] == 75.5678
    assert fires[0]["acq_date"] == "2024-11-01"
    assert fires[0]["acq_time"] == "0730"
    assert fires[0]["confidence"] == "n"
    assert fires[0]["frp"] == 14.5

    assert fires[1]["confidence"] == "h"
    assert fires[1]["frp"] == 28.3


@patch("backend.shared.clients._http_get_with_retry")
def test_fetch_fires_error_response(mock_http):
    """If body is an error message without latitude header, raise exception."""
    mock_http.return_value = "Invalid MAP_KEY or account limit exceeded"
    with pytest.raises(RuntimeError, match="FIRMS API returned invalid response"):
        fetch_fires("bad_key", "VIIRS_SNPP_NRT", 1)


@patch("backend.shared.clients._http_get_with_retry")
def test_fetch_wind_forecast(mock_http):
    """Test Open-Meteo forecast JSON response parsing."""
    mock_http.return_value = """{
        "hourly": {
            "time": ["2026-10-01T00:00", "2026-10-01T01:00"],
            "wind_speed_10m": [12.5, 14.2],
            "wind_direction_10m": [290, 305]
        }
    }"""
    wind = fetch_wind(28.6139, 77.2090)
    assert len(wind["times"]) == 2
    assert wind["speed_kmh"] == [12.5, 14.2]
    assert wind["dir_from_deg"] == [290.0, 305.0]
