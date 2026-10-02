# 🎨 Saans (साँस) — Frontend Engineering Guide & Task Specification

Welcome to the **Saans (साँस)** development team! This document gives you the complete technical overview of the frontend, explains how the project runs, and details the specific tasks to implement.

---

## 📖 1. Project Background & Mechanism

**Saans** is an early warning system for post-monsoon stubble burning across Punjab and Haryana. It tracks active fires and calculates how fast smoke plumes travel into Delhi-NCR and neighboring cities.

### How Data Flows to the Frontend:
1. **NASA FIRMS Satellite Telemetry (VIIRS 375m):** Active thermal fire points with Fire Radiative Power (FRP in MW).
2. **0.1° Grid Risk Scoring (~10 km):** Blends 5-year historical climatology with 48h active fire neighborhood diffusion.
3. **Smoke Arrival ETA:** Uses Open-Meteo hourly wind vectors to find upwind fires and calculate arrival hours (ETAs) and threat levels (`LOW`, `MODERATE`, `HIGH`, `STAGNANT`).
4. **Data Delivery:** Saved as `web/data/latest.json` (or served via AWS API Gateway).

---

## 🚀 2. Quick Local Setup (Under 2 Minutes)

```bash
# 1. Clone/enter the directory
cd delhi

# 2. Activate virtual environment
# Windows:
.\venv\Scripts\activate
# Mac/Linux:
source venv/bin/activate

# 3. Generate the latest dataset for testing (historical peak burning replay)
python scripts/run_pipeline_local.py --as-of 2024-11-01

# 4. Start local web server
python -m http.server 8000 -d web

# 5. Open in browser:
# http://localhost:8000
```

---

## 📂 3. Frontend File Structure

```text
web/
├── index.html        # Main HTML layout, controls bar, header stats, evaluation table
├── style.css         # Dark-mode glassmorphic CSS, responsive grid layouts
├── app.js            # Pure Vanilla JS + Leaflet.js logic (map layers, telemetry render)
└── data/
    ├── latest.json               # Active pipeline output JSON
    └── replay_2024_11_01.json   # Historical peak burning snapshot
```

---

## 🎯 4. Your Core Tasks

Your objective is to upgrade the frontend from a static city dashboard into an **interactive spatial intelligence tool**.

---

### Task 1: "Click Anywhere on Map" Custom Location Analyzer
> **Problem:** Currently, the system only shows pre-computed analysis for 3 fixed cities (Delhi, Ludhiana, Chandigarh).
> **Goal:** Allow users/officials to click **any point on the map** (or search a town like Noida, Gurgaon, Patiala) and get an instant real-time smoke warning for their exact coordinates.

#### Implementation Steps:
1. **Map Click Event in `web/app.js`:**
   ```javascript
   map.on("click", (e) => {
     const { lat, lng } = e.latlng;
     analyzeCustomLocation(lat, lng);
   });
   ```
2. **Port Pure Upwind Math to JavaScript (`web/app.js`):**
   * Use **Haversine formula** to compute distances from the clicked point to all active fires in `currentData.fires`.
   * Compute bearing angle from clicked point to each fire:
     $$\theta = \text{atan2}(\sin(\Delta \text{lon})\cos(\text{lat}_2), \cos(\text{lat}_1)\sin(\text{lat}_2) - \sin(\text{lat}_1)\cos(\text{lat}_2)\cos(\Delta \text{lon}))$$
   * A fire is **upwind** if:
     $$|\text{bearing} - \text{wind\_from}| \le 30^\circ$$
   * Compute ETA:
     $$\text{ETA (hours)} = \frac{\text{Distance (km)}}{\text{Wind Speed (km/h)}}$$
3. **Render Custom Location Card/Popup:**
   * Drop an animated Leaflet marker at the clicked location.
   * Draw straight trajectory lines from top 5 upwind fire clusters to the custom pin.
   * Show a summary card:
     * 📍 **Coordinates / Selected Point**
     * 🔥 **Upwind Fire Count:** e.g., 28 fires
     * ⏳ **Estimated Arrival (ETA):** ~9 hours
     * ⚠️ **Threat Level:** HIGH / MODERATE / LOW

*(Reference Python implementation: [`core/geo.py`](../core/geo.py) and [`core/smoke.py`](../core/smoke.py))*

---

### Task 2: 24-Hour Wind & Plume Forecast Timeline Slider
> **Goal:** Enable users to scrub through the next 24 hours to see how wind shifts and when smoke plumes will arrive.

#### Implementation Steps:
1. **Add Timeline Controls in `web/index.html`:**
   ```html
   <div class="timeline-container">
     <button id="btn-play-timeline" class="btn-tool">▶ Play</button>
     <input type="range" id="time-slider" min="0" max="24" value="0" step="1">
     <span id="time-display">Now (+0h)</span>
   </div>
   ```
2. **Connect Slider to Hourly Wind Forecast in `web/app.js`:**
   * In `web/data/latest.json`, city wind objects contain 48 hours of forecast speeds and directions (`speed_kmh[t]`, `dir_from_deg[t]`).
   * When the slider moves to hour `t`:
     * Update the wind direction arrows.
     * Re-calculate trajectory vectors and update their positions on the map.
     * Add a simple `setInterval` loop for the "Play/Pause" animation.

---

### Task 3: Interactive Filter Controls (FRP & Risk Thresholds)
> **Goal:** Allow users to filter out low-intensity fires or low-risk cells.

#### Implementation Steps:
1. **Add Filter Sliders in Map Toolbar (`web/index.html`):**
   * **Min Fire Radiative Power (FRP):** Slider from 0 MW to 100 MW (default: 0).
   * **Min Risk Score:** Slider from 0 to 100 (default: 10).
2. **Dynamic Layer Filtering in `web/app.js`:**
   * Filter `currentData.fires` and `currentData.risk_cells` in memory and re-render layers without re-fetching data.

---

## 🧪 5. Acceptance Checklist

Before submitting your PR / code:
- [ ] Clicking any point on the map displays accurate upwind fires and ETA in a clean popup.
- [ ] Timeline slider scrubs forward 0h–24h smoothly without UI lag or memory leaks.
- [ ] Sliders filter fires and risk grid cells in real-time.
- [ ] UI is fully responsive and looks great on mobile viewports (< 768px).
- [ ] Zero build step required (Keep it pure Vanilla JS + Leaflet CSS/JS).

---
*Happy coding! Feel free to reach out with any questions.*
