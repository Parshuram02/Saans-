"""AWS Lambda API Function Handler (Phase 9).

Behind API Gateway HTTP API (v2) with CORS enabled.
Endpoints:
  GET /health            -> {"ok": true}
  GET /risk              -> Returns all scored risk cells and Meta info
  GET /smoke?city=Delhi  -> Returns specific city smoke result (or all cities if omitted)
"""

import json
import logging
import os
import sys

# Ensure shared and core modules can be resolved in Lambda
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "../..")))

from backend.shared.store import get_all_risk_cells, get_city_smoke, get_meta

logger = logging.getLogger()
logger.setLevel(logging.INFO)

TABLE_RISK = os.environ.get("TABLE_RISK_CELLS", "")
TABLE_SMOKE = os.environ.get("TABLE_CITY_SMOKE", "")
TABLE_META = os.environ.get("TABLE_META", "")

CORS_HEADERS = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
}


def build_response(status_code: int, body_dict: dict) -> dict:
    """Helper to construct HTTP API responses with CORS."""
    return {
        "statusCode": status_code,
        "headers": CORS_HEADERS,
        "body": json.dumps(body_dict),
    }


def handler(event, context):
    http_method = event.get("requestContext", {}).get("http", {}).get("method") or event.get("httpMethod", "GET")
    raw_path = event.get("rawPath") or event.get("path", "")
    query_params = event.get("queryStringParameters") or {}

    # Strip stage prefix if present
    path = "/" + raw_path.strip("/").split("/")[-1] if raw_path else "/"
    # Handle direct matching
    if raw_path.endswith("/health"):
        path = "/health"
    elif raw_path.endswith("/risk"):
        path = "/risk"
    elif raw_path.endswith("/smoke"):
        path = "/smoke"

    logger.info("Handling request: %s %s", http_method, path)

    if http_method == "OPTIONS":
        return build_response(200, {"ok": True})

    table_risk = os.environ.get("TABLE_RISK_CELLS", "saans-risk-cells")
    table_smoke = os.environ.get("TABLE_CITY_SMOKE", "saans-city-smoke")
    table_meta = os.environ.get("TABLE_META", "saans-meta")

    # 1. GET /health
    if path == "/health":
        return build_response(200, {"ok": True, "service": "saans-api"})

    # 2. GET /risk
    elif path == "/risk":
        try:
            meta = get_meta(table_meta, key="telemetry")
            cells = get_all_risk_cells(table_risk)

            payload = {
                "generated_at": meta.get("generated_at", ""),
                "mode": meta.get("mode", "live"),
                "as_of": meta.get("as_of", ""),
                "disclaimer": meta.get(
                    "disclaimer", "Risk score is a heuristic estimate, not a forecast guarantee."
                ),
                "risk_cells": cells,
            }
            return build_response(200, payload)
        except Exception as e:
            logger.error("Error reading risk cells: %s", e, exc_info=True)
            return build_response(500, {"error": "Failed to retrieve risk data", "details": str(e)})

    # 3. GET /smoke?city=Delhi
    elif path == "/smoke":
        try:
            target_city = query_params.get("city")
            if target_city:
                result = get_city_smoke(table_smoke, city_name=target_city)
                if not result:
                    return build_response(404, {"error": f"City '{target_city}' not found."})
                return build_response(200, result)
            else:
                cities = get_city_smoke(table_smoke)
                return build_response(200, {"cities": cities})
        except Exception as e:
            logger.error("Error reading city smoke: %s", e, exc_info=True)
            return build_response(500, {"error": "Failed to retrieve smoke estimates", "details": str(e)})

    return build_response(404, {"error": f"Endpoint not found: {raw_path}"})
