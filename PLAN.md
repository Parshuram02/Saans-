# SAANS — Module 1: Stubble Fire Early Warning (Build Plan)

Goal:
Build a system that (a) ingests NASA FIRMS satellite fire detections for Punjab and Haryana, (b) computes a stubble-burn risk score per 0.1° grid cell, (c) uses wind forecasts to estimate when smoke from upwind fires will reach a target city (Delhi, Ludhiana, Chandigarh), and (d) shows it all on a web map backed by a small AWS serverless API. The headline output is a sentence like: "Delhi: smoke from 34 upwind fires, estimated arrival in 14 hours, level HIGH."

This is a risk and estimate tool, not a precise predictor. The UI and README must say so honestly.

## Non-goals (do NOT build)
- No WhatsApp/Telegram/SMS messaging (Module 2).
- No exposure/dose dashboard (Module 3).
- No user accounts or authentication.
- No machine-learning training. The risk score is a transparent formula.
- No paid services. Everything must fit in the AWS Free Tier.

## Constraints and eligibility
- AWS deployment with AWS SAM: Lambda, API Gateway (HTTP API), DynamoDB, EventBridge, S3. Host frontend on Amplify Hosting or S3 + CloudFront.
- Python 3.12 for backend. Frontend: plain HTML + JavaScript + Leaflet (no build step).
- Do not use pandas inside Lambda (package size). Use standard library (csv, json, math, datetime). Pandas allowed only in offline scripts under scripts/.
- All core logic must be pure functions in core/ with no AWS or network calls, unit-testable locally and in Lambda.
- Secrets from environment variables / SAM parameter (NoEcho). Never commit keys. Provide .env.example.

## Fixed configuration (core/config.py)
- BBOX: west 73.8, south 27.6, east 77.6, north 32.6 (Punjab + Haryana)
- CELL_DEG: 0.1 (~10 km grid)
- CITIES: Delhi (28.6139, 77.2090), Ludhiana (30.9010, 75.8573), Chandigarh (30.7333, 76.7794)
- FIRMS_SOURCE_NRT: "VIIRS_SNPP_NRT"
- FIRMS_SOURCE_SP: "VIIRS_SNPP_SP"
- KEEP_CONFIDENCE: {"n", "h"}
- UPWIND_TOLERANCE_DEG: 30
- MAX_SMOKE_DISTANCE_KM: 600
- MIN_WIND_KMH: 3
- Weights: W_HISTORY = 0.5, W_RECENT = 0.5
- Smoke thresholds: LOW < 50, MODERATE 50..200, HIGH > 200

## Phases
- Phase 0: Scaffolding, requirements, Makefile, .gitignore, README skeleton
- Phase 1: Core geo logic (pure functions + tests)
- Phase 2: Data clients (FIRMS + Open-Meteo stdlib urllib)
- Phase 3: History download and index
- Phase 4: Risk score (core/risk.py)
- Phase 5: Back-test (precision@50, recall@50, chart)
- Phase 6: Smoke arrival estimate (core/smoke.py)
- Phase 7: Local end-to-end pipeline (web/data/latest.json)
- Phase 8: Frontend (Leaflet + rich aesthetic UI)
- Phase 9: AWS SAM deployment
- Phase 10: Polish and documentation
