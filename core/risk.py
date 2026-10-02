"""Risk scoring algorithm for stubble burning (Phase 4).

Pure function with zero network or external dependencies.
"""

from datetime import date, datetime
from typing import Any

from core.config import W_HISTORY, W_RECENT
from core.geo import cell_center, cell_id, is_in_punjab_haryana, neighbors


def parse_date(d: str | date | datetime) -> date:
    """Normalize input date representation to a datetime.date object."""
    if isinstance(d, datetime):
        return d.date()
    if isinstance(d, date):
        return d
    return datetime.strptime(d.strip(), "%Y-%m-%d").date()


def get_day_of_season(d: date) -> tuple[int, bool]:
    """Calculate day of season where Oct 1 = 0, Nov 30 = 60.

    Returns:
        (clamped_day, off_season_flag)
    """
    season_start = date(d.year, 10, 1)
    diff = (d - season_start).days
    if 0 <= diff <= 60:
        return diff, False
    # Off-season: clamp for lookup
    clamped = max(0, min(60, diff))
    return clamped, True


def compute_risk(
    history_index: dict[str, Any],
    recent_fires: list[dict[str, Any]],
    as_of_date: str | date | datetime,
    w_history: float = W_HISTORY,
    w_recent: float = W_RECENT,
) -> dict[str, dict[str, Any]]:
    """Compute stubble burning risk score per 0.1° grid cell.

    Args:
        history_index: Dict containing 'cells' mapping cell_id -> {'lat', 'lon', 'by_day': {day_str: count}}
        recent_fires: List of fires in the last 48 hours [{'latitude': float, 'longitude': float, 'frp': float}, ...]
        as_of_date: Evaluation date (string 'YYYY-MM-DD', date, or datetime)
        w_history: Weight for historical climatology component (default 0.5)
        w_recent: Weight for recent neighborhood fire component (default 0.5)

    Returns:
        dict[cell_id, {
            "lat": float,
            "lon": float,
            "risk": float,          # 0..100
            "fires_48h": int,
            "history_norm": float,   # 0..1
            "recent_norm": float,    # 0..1
        }]
        Only cells with risk > 0 are returned.
    """
    eval_date = parse_date(as_of_date)
    dos, off_season = get_day_of_season(eval_date)

    cells_hist = history_index.get("cells", history_index)

    # 1. Compute historical component for each cell within +/- 7 days of day_of_season
    hist_raw: dict[str, float] = {}
    day_window = set(range(max(0, dos - 7), min(60, dos + 7) + 1))

    for cid, cell_data in cells_hist.items():
        by_day = cell_data.get("by_day", {})
        count_in_window = sum(
            float(cnt) for day_str, cnt in by_day.items() if int(day_str) in day_window
        )
        if count_in_window > 0:
            hist_raw[cid] = count_in_window

    max_hist = max(hist_raw.values()) if hist_raw else 0.0

    history_norm: dict[str, float] = {}
    if max_hist > 0:
        for cid, val in hist_raw.items():
            history_norm[cid] = val / max_hist

    # 2. Aggregate recent fires (last 48 hours)
    cell_recent_count: dict[str, int] = {}
    cell_recent_weighted: dict[str, float] = {}

    for f in recent_fires:
        lat = float(f["latitude"])
        lon = float(f["longitude"])
        frp = float(f.get("frp", 0.0) or 0.0)

        cid = cell_id(lat, lon)
        cell_recent_count[cid] = cell_recent_count.get(cid, 0) + 1

        # Weight: 1 + frp/50 capped at 3
        fire_weight = min(3.0, 1.0 + (frp / 50.0))
        cell_recent_weighted[cid] = cell_recent_weighted.get(cid, 0.0) + fire_weight

    # 3. Neighborhood recent score (cell + 8 surrounding neighbors)
    # Consider all cells that have history or recent activity
    candidate_cids = set(history_norm.keys()) | set(cell_recent_weighted.keys())
    for cid in list(cell_recent_weighted.keys()):
        candidate_cids.update(neighbors(cid))

    recent_neighborhood: dict[str, float] = {}
    for cid in candidate_cids:
        nbr_sum = cell_recent_weighted.get(cid, 0.0)
        for nbr_id in neighbors(cid):
            nbr_sum += cell_recent_weighted.get(nbr_id, 0.0)
        if nbr_sum > 0:
            recent_neighborhood[cid] = nbr_sum

    max_recent = max(recent_neighborhood.values()) if recent_neighborhood else 0.0

    recent_norm: dict[str, float] = {}
    if max_recent > 0:
        for cid, val in recent_neighborhood.items():
            recent_norm[cid] = val / max_recent

    # 4. Combine into final risk score: 100 * (w_hist * hist_norm + w_rec * rec_norm)
    all_active_cells = set(history_norm.keys()) | set(recent_norm.keys())
    result: dict[str, dict[str, Any]] = {}

    for cid in all_active_cells:
        h_norm = history_norm.get(cid, 0.0)
        r_norm = recent_norm.get(cid, 0.0)

        risk_val = 100.0 * (w_history * h_norm + w_recent * r_norm)
        risk_rounded = round(risk_val, 1)

        if risk_rounded > 0:
            c_lat, c_lon = cell_center(cid)
            if not is_in_punjab_haryana(c_lat, c_lon):
                continue

            result[cid] = {
                "lat": c_lat,
                "lon": c_lon,
                "risk": risk_rounded,
                "fires_48h": cell_recent_count.get(cid, 0),
                "history_norm": round(h_norm, 4),
                "recent_norm": round(r_norm, 4),
            }

    return result
