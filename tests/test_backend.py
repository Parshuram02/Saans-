"""Unit tests for backend Lambda handlers and DynamoDB store logic."""

import json
from decimal import Decimal
from unittest.mock import MagicMock, patch
import pytest

from backend.api.handler import handler as api_handler
from backend.shared.store import decimal_to_float, float_to_decimal


def test_float_to_decimal_and_back():
    """Verify float <-> Decimal serialization avoids precision loss and supports nested dicts/lists."""
    data = {
        "float_val": 30.123456,
        "int_val": 10,
        "nested": {"list": [1.5, 2.5, 3.0]},
    }
    dynamo_data = float_to_decimal(data)
    assert isinstance(dynamo_data["float_val"], Decimal)
    assert isinstance(dynamo_data["nested"]["list"][0], Decimal)

    recovered = decimal_to_float(dynamo_data)
    assert recovered["float_val"] == 30.123456
    assert recovered["nested"]["list"] == [1.5, 2.5, 3]


def test_api_handler_health():
    """GET /health returns 200 and ok=true with CORS headers."""
    event = {
        "rawPath": "/health",
        "requestContext": {"http": {"method": "GET"}},
    }
    resp = api_handler(event, None)
    assert resp["statusCode"] == 200
    assert resp["headers"]["Access-Control-Allow-Origin"] == "*"
    body = json.loads(resp["body"])
    assert body["ok"] is True


@patch("backend.api.handler.get_meta")
@patch("backend.api.handler.get_all_risk_cells")
def test_api_handler_risk(mock_get_cells, mock_get_meta):
    """GET /risk returns metadata and risk cells list."""
    mock_get_meta.return_value = {
        "generated_at": "2026-10-01T00:00:00Z",
        "mode": "live",
        "as_of": "2026-10-01",
    }
    mock_get_cells.return_value = [
        {"cell_id": "302_758", "lat": 30.25, "lon": 75.85, "risk": 85.0, "fires_48h": 4}
    ]

    event = {
        "rawPath": "/risk",
        "requestContext": {"http": {"method": "GET"}},
    }
    resp = api_handler(event, None)
    assert resp["statusCode"] == 200
    body = json.loads(resp["body"])
    assert body["mode"] == "live"
    assert len(body["risk_cells"]) == 1
    assert body["risk_cells"][0]["cell_id"] == "302_758"


@patch("backend.api.handler.get_city_smoke")
def test_api_handler_smoke_city(mock_get_smoke):
    """GET /smoke?city=Delhi returns specific city record."""
    mock_get_smoke.return_value = {
        "city": "Delhi",
        "level": "HIGH",
        "eta_hours": 14,
        "upwind_fire_count": 34,
        "score": 312.4,
    }

    event = {
        "rawPath": "/smoke",
        "queryStringParameters": {"city": "Delhi"},
        "requestContext": {"http": {"method": "GET"}},
    }
    resp = api_handler(event, None)
    assert resp["statusCode"] == 200
    body = json.loads(resp["body"])
    assert body["city"] == "Delhi"
    assert body["level"] == "HIGH"
    assert body["eta_hours"] == 14
