"""Configuration and constants for Saans stubble fire early warning system."""

# Punjab + Haryana bounding box
BBOX = {
    "west": 73.8,
    "south": 27.6,
    "east": 77.6,
    "north": 32.6,
}

# Grid cell resolution (~10 km grid)
CELL_DEG = 0.1

# Target monitoring cities
CITIES = {
    "Delhi": {"lat": 28.6139, "lon": 77.2090},
    "Ludhiana": {"lat": 30.9010, "lon": 75.8573},
    "Chandigarh": {"lat": 30.7333, "lon": 76.7794},
}

# NASA FIRMS satellite sources
FIRMS_SOURCE_NRT = "VIIRS_SNPP_NRT"     # Near Real-Time live fires
FIRMS_SOURCE_SP = "VIIRS_SNPP_SP"       # Standard Processing (historical)

# Filter low confidence detections; keep nominal ("n") and high ("h")
KEEP_CONFIDENCE = {"n", "h"}

# Smoke transport modeling parameters
UPWIND_TOLERANCE_DEG = 30
MAX_SMOKE_DISTANCE_KM = 600             # Ignore fires beyond 600 km from city
MIN_WIND_KMH = 3.0                      # Below 3 km/h, smoke is stagnant (no ETA)

# Heuristic risk scoring weights (tunable)
W_HISTORY = 0.5
W_RECENT = 0.5

# Heuristic smoke score thresholds (tunable, uncalibrated)
SMOKE_THRESHOLDS = {
    "LOW": 50.0,
    "MODERATE": 200.0,
}
