"""DynamoDB storage helpers for Saans AWS serverless backend.

Handles Decimal conversions (DynamoDB rejects Python floats) and batch operations.
"""

from decimal import Decimal
from typing import Any

try:
    import boto3
except ImportError:
    boto3 = None


def float_to_decimal(obj: Any) -> Any:
    """Recursively convert float to Decimal for DynamoDB storage."""
    if isinstance(obj, float):
        return Decimal(str(round(obj, 6)))
    if isinstance(obj, dict):
        return {k: float_to_decimal(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [float_to_decimal(v) for v in obj]
    return obj


def decimal_to_float(obj: Any) -> Any:
    """Recursively convert Decimal back to float for API responses."""
    if isinstance(obj, Decimal):
        # Convert whole numbers to int, others to float
        return int(obj) if obj % 1 == 0 else float(obj)
    if isinstance(obj, dict):
        return {k: decimal_to_float(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [decimal_to_float(v) for v in obj]
    return obj


def get_dynamo_resource():
    """Get boto3 DynamoDB resource."""
    return boto3.resource("dynamodb")


def write_risk_cells(table_name: str, risk_cells: list[dict], dynamodb=None):
    """Batch write risk cells to DynamoDB."""
    db = dynamodb or get_dynamo_resource()
    table = db.Table(table_name)

    with table.batch_writer() as batch:
        for cell in risk_cells:
            item = {
                "cell_id": str(cell["cell_id"]),
                "lat": cell["lat"],
                "lon": cell["lon"],
                "risk": cell["risk"],
                "fires_48h": int(cell.get("fires_48h", 0)),
                "history_norm": cell.get("history_norm", 0.0),
                "recent_norm": cell.get("recent_norm", 0.0),
            }
            batch.put_item(Item=float_to_decimal(item))


def get_all_risk_cells(table_name: str, dynamodb=None) -> list[dict]:
    """Scan all risk cells from DynamoDB."""
    db = dynamodb or get_dynamo_resource()
    table = db.Table(table_name)

    response = table.scan()
    items = response.get("Items", [])

    while "LastEvaluatedKey" in response:
        response = table.scan(ExclusiveStartKey=response["LastEvaluatedKey"])
        items.extend(response.get("Items", []))

    cells = [decimal_to_float(item) for item in items]
    cells.sort(key=lambda x: x.get("risk", 0.0), reverse=True)
    return cells


def write_city_smoke(table_name: str, cities_smoke: list[dict], dynamodb=None):
    """Write smoke analysis results for each city."""
    db = dynamodb or get_dynamo_resource()
    table = db.Table(table_name)

    with table.batch_writer() as batch:
        for c in cities_smoke:
            batch.put_item(Item=float_to_decimal(c))


def get_city_smoke(table_name: str, city_name: str | None = None, dynamodb=None) -> list[dict] | dict | None:
    """Retrieve city smoke data. Returns single dict if city_name given, else all cities list."""
    db = dynamodb or get_dynamo_resource()
    table = db.Table(table_name)

    if city_name:
        resp = table.get_item(Key={"city": city_name})
        item = resp.get("Item")
        return decimal_to_float(item) if item else None

    resp = table.scan()
    items = resp.get("Items", [])
    return [decimal_to_float(item) for item in items]


def write_meta(table_name: str, key: str, meta_dict: dict, dynamodb=None):
    """Write metadata (e.g. generated_at, mode, as_of)."""
    db = dynamodb or get_dynamo_resource()
    table = db.Table(table_name)

    item = {"key": key, **meta_dict}
    table.put_item(Item=float_to_decimal(item))


def get_meta(table_name: str, key: str = "telemetry", dynamodb=None) -> dict:
    """Retrieve metadata item."""
    db = dynamodb or get_dynamo_resource()
    table = db.Table(table_name)

    resp = table.get_item(Key={"key": key})
    item = resp.get("Item", {})
    return decimal_to_float(item)
