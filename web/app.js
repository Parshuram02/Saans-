/**
 * Saans (साँस) — Frontend Application Logic
 * Pure Vanilla JavaScript + Leaflet.js
 */

// Global configuration: API_BASE can be overridden by deployment or left blank for local JSON fallback
const API_BASE = window.API_BASE || "";

// Punjab + Haryana focus coordinates
const DEFAULT_MAP_CENTER = [30.15, 76.0];
const DEFAULT_MAP_ZOOM = 7;
const CELL_DEG = 0.1;

// Leaflet layers and map state
let map = null;
let riskCellsLayer = null;
let firesLayer = null;
let citiesLayer = null;
let trajectoriesLayer = null;

// Custom Location State
let customLocationMarker = null;
let customTrajectoriesLayer = null;
let customLocationData = null; // { lat, lng }

// FRP and Risk Threshold Filters State
let minFrpFilter = 0;
let minRiskFilter = 0;

let currentData = null;
let activeCityName = "Delhi (Central)";
let currentGraphMetric = "score";

// Initialize on DOM ready
document.addEventListener("DOMContentLoaded", () => {
  initMap();
  setupEventListeners();
  loadData();

  window.addEventListener("resize", () => {
    if (map) map.invalidateSize();
  });
});

// Leaflet basemap collections
let baseLayers = {};
let currentBaseLayer = null;

/**
 * Initialize Leaflet map with Google Maps & High-Res Satellite tiles
 */
function initMap() {
  map = L.map("map", {
    center: DEFAULT_MAP_CENTER,
    zoom: DEFAULT_MAP_ZOOM,
    zoomControl: true,
  });

  // 1. Google Satellite Hybrid (Satellite Imagery + City/Road Labels)
  const googleHybrid = L.tileLayer(
    "https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}",
    {
      attribution: '&copy; <a href="https://maps.google.com" target="_blank">Google Maps</a> Satellite',
      maxZoom: 20,
    }
  );

  // 2. Google Maps Standard Roadmap
  const googleRoadmap = L.tileLayer(
    "https://mt1.google.com/vt/lyrs=m&x={x}&y={y}&z={z}",
    {
      attribution: '&copy; <a href="https://maps.google.com" target="_blank">Google Maps</a>',
      maxZoom: 20,
    }
  );

  // 3. Sleek Dark Canvas Mode (Esri Dark - Zero Watermarks)
  const darkCanvasBase = L.tileLayer(
    "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}",
    {
      attribution: "Tiles &copy; Esri &mdash; Esri, DeLorme, NAVTEQ",
      maxZoom: 16,
    }
  );
  const darkCanvasLabels = L.tileLayer(
    "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}",
    {
      attribution: "",
      maxZoom: 16,
    }
  );
  const darkCanvasGroup = L.layerGroup([darkCanvasBase, darkCanvasLabels]);

  // 4. Esri High-Resolution Satellite
  const esriSatellite = L.tileLayer(
    "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    {
      attribution: "Tiles &copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS",
      maxZoom: 19,
    }
  );

  // 5. Google Terrain
  const googleTerrain = L.tileLayer(
    "https://mt1.google.com/vt/lyrs=p&x={x}&y={y}&z={z}",
    {
      attribution: '&copy; <a href="https://maps.google.com" target="_blank">Google Maps</a> Terrain',
      maxZoom: 20,
    }
  );

  baseLayers = {
    google_hybrid: googleHybrid,
    google_roadmap: googleRoadmap,
    dark_canvas: darkCanvasGroup,
    esri_satellite: esriSatellite,
    google_terrain: googleTerrain,
  };

  // Set default basemap layer to Google Hybrid
  currentBaseLayer = baseLayers.google_hybrid;
  currentBaseLayer.addTo(map);

  // Initialize Layer Groups
  riskCellsLayer = L.layerGroup().addTo(map);
  firesLayer = L.layerGroup().addTo(map);
  trajectoriesLayer = L.layerGroup().addTo(map);
  citiesLayer = L.layerGroup().addTo(map);
  customTrajectoriesLayer = L.layerGroup().addTo(map);

  // Task 1: "Click Anywhere on Map" Custom Location Analyzer Handler
  map.on("click", (e) => {
    const { lat, lng } = e.latlng;
    analyzeCustomLocation(lat, lng);
  });
}

/**
 * Setup UI control listeners
 */
function setupEventListeners() {
  document.getElementById("btn-reset-map").addEventListener("click", () => {
    map.flyTo(DEFAULT_MAP_CENTER, DEFAULT_MAP_ZOOM);
  });

  // Basemap Selector Switcher
  const basemapSelect = document.getElementById("select-basemap");
  if (basemapSelect) {
    basemapSelect.addEventListener("change", (e) => {
      const selectedKey = e.target.value;
      if (baseLayers[selectedKey]) {
        if (currentBaseLayer) {
          map.removeLayer(currentBaseLayer);
        }
        currentBaseLayer = baseLayers[selectedKey];
        currentBaseLayer.addTo(map);
      }
    });
  }

  // Task 1: Custom Town Preset Selector Switcher
  const customTownSelect = document.getElementById("select-custom-town");
  if (customTownSelect) {
    customTownSelect.addEventListener("change", (e) => {
      const val = e.target.value;
      if (val && val.includes(",")) {
        const parts = val.split(",");
        const lat = parseFloat(parts[0]);
        const lng = parseFloat(parts[1]);
        const selectedOption = e.target.options[e.target.selectedIndex];
        const townName = selectedOption ? selectedOption.text.split(" (")[0] : null;

        analyzeCustomLocation(lat, lng, townName);

        if (map) {
          map.flyTo([lat, lng], 9, { duration: 1.0 });
        }
      }
    });
  }

  // Min FRP and Min Risk Filter Sliders
  const filterFrp = document.getElementById("filter-min-frp");
  const filterRisk = document.getElementById("filter-min-risk");

  if (filterFrp) {
    filterFrp.addEventListener("input", () => {
      applyFilters();
    });
  }

  if (filterRisk) {
    filterRisk.addEventListener("input", () => {
      applyFilters();
    });
  }

  // Clear Custom Location Pin Button
  const btnClearCustom = document.getElementById("btn-clear-custom");
  if (btnClearCustom) {
    btnClearCustom.addEventListener("click", () => {
      clearCustomLocation();
    });
  }

  document.getElementById("toggle-risk-cells").addEventListener("change", (e) => {
    if (e.target.checked) {
      map.addLayer(riskCellsLayer);
    } else {
      map.removeLayer(riskCellsLayer);
    }
  });

  document.getElementById("toggle-fires").addEventListener("change", (e) => {
    if (e.target.checked) {
      map.addLayer(firesLayer);
    } else {
      map.removeLayer(firesLayer);
    }
  });

  document.getElementById("toggle-trajectories").addEventListener("change", (e) => {
    if (e.target.checked) {
      map.addLayer(trajectoriesLayer);
    } else {
      map.removeLayer(trajectoriesLayer);
    }
  });

  // Mode Switcher Buttons
  const btnLive = document.getElementById("btn-mode-live");
  const btnReplay = document.getElementById("btn-mode-replay");

  if (btnLive && btnReplay) {
    btnLive.addEventListener("click", () => {
      btnLive.classList.add("active");
      btnReplay.classList.remove("active");
      loadData("data/latest.json");
    });

    btnReplay.addEventListener("click", () => {
      btnReplay.classList.add("active");
      btnLive.classList.remove("active");
      loadData("data/replay_2024_11_01.json");
    });
  }

  // Telemetry Graph Metric Pill Switchers
  const pillScore = document.getElementById("pill-metric-score");
  const pillFires = document.getElementById("pill-metric-fires");
  const pillWind = document.getElementById("pill-metric-wind");

  if (pillScore && pillFires && pillWind) {
    pillScore.addEventListener("click", () => {
      currentGraphMetric = "score";
      pillScore.classList.add("active");
      pillFires.classList.remove("active");
      pillWind.classList.remove("active");
      renderTelemetryGraph();
    });

    pillFires.addEventListener("click", () => {
      currentGraphMetric = "fires";
      pillFires.classList.add("active");
      pillScore.classList.remove("active");
      pillWind.classList.remove("active");
      renderTelemetryGraph();
    });

    pillWind.addEventListener("click", () => {
      currentGraphMetric = "wind";
      pillWind.classList.add("active");
      pillScore.classList.remove("active");
      pillFires.classList.remove("active");
      renderTelemetryGraph();
    });
  }
}

/**
 * Fetch telemetry data from API_BASE or fall back to web/data/latest.json
 */
async function loadData(sourceFile = "data/latest.json") {
  try {
    let payload = null;

    if (API_BASE && API_BASE.trim() !== "" && sourceFile === "data/latest.json") {
      try {
        console.log(`Fetching live data from API: ${API_BASE}`);
        const [riskResp, smokeResp] = await Promise.all([
          fetch(`${API_BASE}/risk`),
          fetch(`${API_BASE}/smoke`),
        ]);

        if (riskResp.ok && smokeResp.ok) {
          const riskData = await riskResp.json();
          const smokeData = await smokeResp.json();
          payload = {
            generated_at: riskData.generated_at || new Date().toISOString(),
            mode: riskData.mode || "live",
            as_of: riskData.as_of || "",
            risk_cells: riskData.risk_cells || [],
            fires: riskData.fires || [],
            cities: smokeData.cities || (Array.isArray(smokeData) ? smokeData : [smokeData]),
            disclaimer: riskData.disclaimer || "Risk score is a heuristic, not a guarantee.",
          };
        }
      } catch (apiErr) {
        console.warn("API request failed, falling back to local dataset:", apiErr);
      }
    }

    if (!payload) {
      console.log(`Loading dataset: ${sourceFile}...`);
      const resp = await fetch(sourceFile);
      if (!resp.ok) {
        throw new Error(`Failed to load ${sourceFile} (HTTP ${resp.status})`);
      }
      payload = await resp.json();
    }

    currentData = payload;
    renderUI(payload);
  } catch (err) {
    console.error("Error loading early warning data:", err);
    document.getElementById("mode-text").textContent = "Telemetry Offline";
    document.getElementById("city-cards-container").innerHTML = `
      <div style="grid-column: 1/-1; padding: 24px; background: rgba(239, 68, 68, 0.1); border: 1px solid rgba(239, 68, 68, 0.3); border-radius: 12px; color: #fca5a5;">
        <strong>Error loading data:</strong> ${err.message}.<br>
        Ensure <code>scripts/run_pipeline_local.py</code> has been executed to generate <code>web/data/latest.json</code>.
      </div>
    `;
  }
}

/**
 * Main render function
 */
function renderUI(data) {
  renderHeaderAndStats(data);
  renderCityCards(data.cities);
  renderRiskCells(data.risk_cells || []);
  renderFires(data.fires || []);
  renderCities(data.cities || []);

  // Select initial city to show trajectory
  if (data.cities && data.cities.length > 0) {
    selectCity(data.cities[0].city);
  }
}

/**
 * Render Header Mode and Top Summary Statistics
 */
function renderHeaderAndStats(data) {
  const modeBadge = document.getElementById("mode-badge");
  const modeText = document.getElementById("mode-text");
  const lastUpdated = document.getElementById("last-updated");

  const mode = (data.mode || "live").toUpperCase();
  modeBadge.className = `mode-badge ${data.mode || "live"}`;

  if (mode === "REPLAY") {
    modeText.textContent = "🔥 PEAK REPLAY • 01 NOV 2024";
    lastUpdated.innerHTML = "<strong>Benchmark:</strong> 01 Nov 2024, 02:00 PM IST (Annual Peak Surge)";
  } else {
    modeText.textContent = "📡 LIVE SENTINEL • 03 OCT 2026";
    lastUpdated.innerHTML = "<strong>Live Stream:</strong> 03 Oct 2026, 06:30 AM IST (Active 5m Sync)";
  }

  const btnLive = document.getElementById("btn-mode-live");
  const btnReplay = document.getElementById("btn-mode-replay");
  if (btnLive && btnReplay) {
    if (mode === "REPLAY") {
      btnReplay.classList.add("active");
      btnLive.classList.remove("active");
    } else {
      btnLive.classList.add("active");
      btnReplay.classList.remove("active");
    }
  }

  // Summary Metrics
  const fireCount = data.fires ? data.fires.length : 0;
  document.getElementById("stat-fires-count").textContent = fireCount.toLocaleString();

  const cellCount = data.risk_cells ? data.risk_cells.length : 0;
  document.getElementById("stat-cells-count").textContent = cellCount.toLocaleString();

  let maxRisk = 0;
  let maxRiskCell = null;
  if (data.risk_cells && data.risk_cells.length > 0) {
    maxRisk = data.risk_cells[0].risk;
    maxRiskCell = data.risk_cells[0];
  }
  document.getElementById("stat-max-risk").textContent = `${maxRisk.toFixed(1)}`;
  if (maxRiskCell) {
    document.getElementById("stat-max-district").textContent = `Lat ${maxRiskCell.lat.toFixed(2)}, Lon ${maxRiskCell.lon.toFixed(2)}`;
  }

  // Highest City Threat
  let highestThreatCity = "None";
  let highestEta = "--";
  const priorityOrder = { HIGH: 4, MODERATE: 3, STAGNANT: 2, LOW: 1 };
  let maxPrio = 0;

  if (data.cities) {
    data.cities.forEach((c) => {
      const p = priorityOrder[c.level] || 0;
      if (p > maxPrio) {
        maxPrio = p;
        highestThreatCity = `${c.city} (${c.level})`;
        highestEta = c.eta_hours !== null ? `ETA: ~${c.eta_hours}h` : c.level;
      }
    });
  }
  document.getElementById("stat-highest-city").textContent = highestThreatCity;
  document.getElementById("stat-highest-eta").textContent = highestEta;
}

/**
 * Render City Threat Cards
 */
function renderCityCards(cities) {
  const container = document.getElementById("city-cards-container");
  container.innerHTML = "";

  if (!cities || cities.length === 0) {
    container.innerHTML = "<p>No city smoke forecasts available.</p>";
    return;
  }

  cities.forEach((c) => {
    const card = document.createElement("div");
    card.className = `city-card ${c.city === activeCityName ? "active" : ""}`;
    card.id = `card-city-${c.city.toLowerCase()}`;
    card.dataset.city = c.city;

    // Accent color based on level
    let accent = "#38bdf8";
    if (c.level === "HIGH") accent = "#ef4444";
    else if (c.level === "MODERATE") accent = "#f59e0b";
    else if (c.level === "LOW") accent = "#10b981";
    else if (c.level === "STAGNANT") accent = "#8b5cf6";
    card.style.setProperty("--city-accent", accent);

    const etaText = c.eta_hours !== null ? `~${c.eta_hours} hours` : (c.level === "STAGNANT" ? "Stagnant" : "N/A");
    const headline = `${c.city}: smoke from <em>${c.upwind_fire_count} upwind fires</em>, estimated arrival in <em>${etaText}</em>, level <em>${c.level}</em>.`;

    const windSpeed = c.wind ? c.wind.speed_kmh.toFixed(1) : "0.0";
    const windInfo = c.wind ? getWindFlowInfo(c.wind.from_deg) : getWindFlowInfo(0);

    card.innerHTML = `
      <div class="city-card-header">
        <div class="city-name-group">
          <span class="city-name">${c.city}</span>
        </div>
        <span class="level-badge ${c.level}">${c.level}</span>
      </div>

      <p class="city-headline">${headline}</p>

      <div class="city-metrics">
        <div class="metric-item">
          <span class="metric-label">Estimated Arrival</span>
          <span class="metric-val">${etaText}</span>
        </div>
        <div class="metric-item">
          <span class="metric-label">Upwind Fires</span>
          <span class="metric-val">${c.upwind_fire_count}</span>
        </div>
        <div class="metric-item">
          <span class="metric-label">Smoke Threat Score</span>
          <span class="metric-val">${c.score.toFixed(1)}</span>
        </div>
        <div class="metric-item">
          <span class="metric-label">Top Cluster Dist</span>
          <span class="metric-val">${c.top_sources && c.top_sources.length > 0 ? `${c.top_sources[0].distance_km.toFixed(0)} km` : "None"}</span>
        </div>
      </div>

      <div class="city-wind-row">
        <div class="wind-indicator" title="${windInfo.label}">
          <span class="compass-arrow-badge" style="
            display: inline-flex;
            align-items: center;
            justify-content: center;
            width: 26px;
            height: 26px;
            border-radius: 50%;
            background: rgba(6, 182, 212, 0.2);
            border: 1px solid #06b6d4;
            transform: rotate(${windInfo.arrowDeg}deg);
            transition: transform 0.4s ease;
            box-shadow: 0 0 10px rgba(6, 182, 212, 0.4);
            margin-right: 6px;
            flex-shrink: 0;
          ">
            <span style="font-weight:900; color:#00f0ff; font-size:1rem; line-height:1;">⬆</span>
          </span>
          <span><strong>Wind:</strong> ${windSpeed} km/h • ${windInfo.shortLabel} (${windInfo.fromDeg}° ➔ ${windInfo.toDeg}°)</span>
        </div>
        <button class="btn-inspect" type="button">Inspect Plumes</button>
      </div>
    `;

    card.addEventListener("click", () => {
      selectCity(c.city);
    });

    container.appendChild(card);
  });
}

/**
 * Handle city selection: highlight card and draw smoke vectors
 */
function selectCity(cityName) {
  activeCityName = cityName;

  // Update card active classes
  document.querySelectorAll(".city-card").forEach((card) => {
    if (card.dataset.city === cityName) {
      card.classList.add("active");
    } else {
      card.classList.remove("active");
    }
  });

  if (!currentData || !currentData.cities) return;
  const cityData = currentData.cities.find((c) => c.city === cityName);
  if (!cityData) return;

  renderCities(currentData.cities);
  drawTrajectories(cityData);
}

/**
 * Render 0.1° Risk Grid Rectangles with subtle glass styling
 */
function renderRiskCells(cells) {
  riskCellsLayer.clearLayers();

  const halfCell = CELL_DEG / 2.0;

  cells.forEach((c) => {
    const south = c.lat - halfCell;
    const north = c.lat + halfCell;
    const west = c.lon - halfCell;
    const east = c.lon + halfCell;

    const bounds = [[south, west], [north, east]];
    const color = getRiskColor(c.risk);
    const opacity = Math.min(0.55, 0.15 + (c.risk / 100.0) * 0.4);

    const rect = L.rectangle(bounds, {
      color: color,
      weight: 0.6,
      fillColor: color,
      fillOpacity: opacity,
    });

    rect.on("mouseover", function () {
      this.setStyle({ weight: 2, color: "#ffffff", fillOpacity: Math.min(0.8, opacity + 0.25) });
    });

    rect.on("mouseout", function () {
      this.setStyle({ weight: 0.6, color: color, fillOpacity: opacity });
    });

    rect.bindTooltip(
      `
      <div style="font-size: 0.83rem; line-height: 1.45; padding: 2px;">
        <div style="font-weight:700; color:${color}; font-size:0.9rem; margin-bottom:2px;">
          📍 Grid Cell ${c.cell_id} &bull; Stubble Risk: ${c.risk.toFixed(1)}/100
        </div>
        Location: ${c.lat.toFixed(2)}°N, ${c.lon.toFixed(2)}°E<br>
        <strong>48h Active Fires:</strong> ${c.fires_48h}<br>
        <strong>Historical Climatology:</strong> ${(c.history_norm * 100).toFixed(1)}%<br>
        <strong>Recent Neighborhood Diffusion:</strong> ${(c.recent_norm * 100).toFixed(1)}%
      </div>
      `,
      { sticky: true, opacity: 0.96 }
    );

    riskCellsLayer.addLayer(rect);
  });
}

/**
 * Get color code for a given 0-100 risk score
 */
function getRiskColor(risk) {
  if (risk >= 80) return "#ef4444"; // Red / High
  if (risk >= 60) return "#f97316"; // Orange
  if (risk >= 40) return "#eab308"; // Amber / Yellow
  if (risk >= 20) return "#84cc16"; // Lime
  return "#10b981"; // Emerald
}

/**
 * Render VIIRS Active Fire points sized by FRP with interactive popups
 */
function renderFires(fires) {
  firesLayer.clearLayers();

  fires.forEach((f) => {
    const frp = f.frp || 10.0;
    const radius = Math.min(10, Math.max(3.5, Math.sqrt(frp) * 1.1));

    const circle = L.circleMarker([f.lat, f.lon], {
      radius: radius,
      fillColor: "#ff4500",
      color: "#ffffff",
      weight: 1.2,
      opacity: 0.95,
      fillOpacity: 0.85,
    });

    circle.on("mouseover", function () {
      this.setStyle({ weight: 2.5, color: "#ffff00", fillOpacity: 1.0 });
    });

    circle.on("mouseout", function () {
      this.setStyle({ weight: 1.2, color: "#ffffff", fillOpacity: 0.85 });
    });

    circle.bindTooltip(
      `
      <div style="font-size: 0.82rem; padding: 2px;">
        <span style="color:#ff6b4a; font-weight:700;">🔥 Active VIIRS Fire</span><br>
        FRP (Power): <strong style="color:#fde047;">${frp.toFixed(1)} MW</strong><br>
        Coords: ${f.lat.toFixed(4)}°N, ${f.lon.toFixed(4)}°E<br>
        Time: ${f.acq_date} ${f.acq_time || ""}
      </div>
      `,
      { sticky: true }
    );

    firesLayer.addLayer(circle);
  });
}

/**
 * Render Target City Markers (Clean, non-overlapping design)
 */
function renderCities(cities) {
  citiesLayer.clearLayers();

  cities.forEach((c) => {
    const pos = [c.lat || 28.6139, c.lon || 77.2090];
    if (!pos[0] || !pos[1]) return;

    const isSelected = (c.city === activeCityName);

    const iconHtml = isSelected
      ? `
        <div style="
          display: flex;
          align-items: center;
          gap: 6px;
          background: rgba(10, 15, 29, 0.96);
          border: 2px solid #00f0ff;
          border-radius: 20px;
          padding: 3px 10px;
          color: #fff;
          font-size: 0.78rem;
          font-weight: 800;
          box-shadow: 0 0 16px rgba(0, 240, 255, 0.8);
          cursor: pointer;
          white-space: nowrap;
        ">
          <span style="width: 8px; height: 8px; border-radius: 50%; background: #00f0ff;"></span>
          ${c.city}
        </div>
      `
      : `
        <div style="
          width: 12px;
          height: 12px;
          border-radius: 50%;
          background: rgba(10, 15, 29, 0.9);
          border: 2px solid #06b6d4;
          box-shadow: 0 0 8px rgba(6, 182, 212, 0.8);
          cursor: pointer;
        "></div>
      `;

    const customIcon = L.divIcon({
      html: iconHtml,
      className: "custom-city-pin",
      iconAnchor: isSelected ? [35, 12] : [6, 6],
    });

    const marker = L.marker(pos, { icon: customIcon });
    marker.bindTooltip(
      `<strong>📍 ${c.city}</strong><br>Threat Level: ${c.level} &bull; Arrival ETA: ~${c.eta_hours !== null ? c.eta_hours + "h" : "N/A"}`,
      { sticky: true }
    );
    marker.on("click", () => {
      selectCity(c.city);
    });

    citiesLayer.addLayer(marker);
  });
}

/**
 * Helper: Convert wind direction angle (deg) into clear origin & destination flow info
 */
function getWindFlowInfo(fromDeg) {
  const cardinals = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
  const fDeg = (parseFloat(fromDeg || 0) + 360) % 360;
  const toDeg = (fDeg + 180) % 360;

  const fromIdx = Math.round(fDeg / 22.5) % 16;
  const toIdx = Math.round(toDeg / 22.5) % 16;

  const fromCard = cardinals[fromIdx];
  const toCard = cardinals[toIdx];

  return {
    fromDeg: Math.round(fDeg),
    toDeg: Math.round(toDeg),
    fromCardinal: fromCard,
    toCardinal: toCard,
    arrowDeg: Math.round(toDeg),
    label: `Wind blowing FROM ${fromCard} (${Math.round(fDeg)}°) ➔ TO ${toCard} (${Math.round(toDeg)}°)`,
    shortLabel: `From ${fromCard} ➔ TO ${toCard}`,
  };
}

/**
 * Draw upwind trajectory vectors from top fire clusters to the selected city
 */
function drawTrajectories(cityData) {
  trajectoriesLayer.clearLayers();

  const cPos = [cityData.lat || 28.6139, cityData.lon || 77.2090];
  if (!cPos[0] || !cPos[1] || !cityData.top_sources || cityData.top_sources.length === 0) {
    return;
  }

  const windSpeed = (cityData.wind && cityData.wind.speed_kmh) ? Math.max(3.0, cityData.wind.speed_kmh) : 10.0;

  // Show top 3 most impactful plumes to keep the map clean and readable
  const displaySources = cityData.top_sources.slice(0, 3);

  displaySources.forEach((src, idx) => {
    const sPos = [src.lat, src.lon];
    const distKm = src.distance_km || haversineKm(src.lat, src.lon, cPos[0], cPos[1]);
    const clusterEta = distKm / windSpeed;

    // Primary vector is thick and glowing; secondary vectors are lighter
    const isPrimary = (idx === 0);
    const line = L.polyline([sPos, cPos], {
      color: isPrimary ? "#00f0ff" : "rgba(6, 182, 212, 0.6)",
      weight: isPrimary ? 3.5 : 2.0,
      opacity: isPrimary ? 0.95 : 0.65,
      className: "animated-trajectory-line",
      dashArray: isPrimary ? "12, 8" : "6, 6",
    });

    line.bindTooltip(
      `
      <div style="font-size: 0.83rem; padding: 4px;">
        <strong style="color:#00f0ff;">💨 Upwind Smoke Plume #${idx + 1} ➔ ${cityData.city}</strong><br>
        Source: ${src.lat.toFixed(2)}°N, ${src.lon.toFixed(2)}°E &bull; FRP: <strong>${src.frp.toFixed(1)} MW</strong><br>
        Total Distance: <strong>${distKm.toFixed(0)} km</strong> &bull; Total ETA: <strong>~${Math.round(clusterEta)} hours</strong>
      </div>
      `,
      { sticky: true }
    );

    trajectoriesLayer.addLayer(line);

    // Directional flow arrow marker placed at midpoint along trajectory towards city
    const midLat = (src.lat + cPos[0]) / 2.0;
    const midLon = (src.lon + cPos[1]) / 2.0;
    const flowAngle = bearingDeg(src.lat, src.lon, cPos[0], cPos[1]);

    const arrowIcon = L.divIcon({
      html: `
        <div style="
          transform: rotate(${flowAngle - 90}deg);
          color: ${isPrimary ? '#00f0ff' : 'rgba(6, 182, 212, 0.7)'};
          font-size: 1.1rem;
          font-weight: 900;
          line-height: 1;
          filter: drop-shadow(0 0 4px #00f0ff);
          user-select: none;
        ">➔</div>
      `,
      className: "vector-flow-arrow-pin",
      iconSize: [16, 16],
      iconAnchor: [8, 8],
    });

    const arrowMarker = L.marker([midLat, midLon], { icon: arrowIcon, interactive: false });
    trajectoriesLayer.addLayer(arrowMarker);

  });

  // Fit bounds cleanly with comfortable padding
  const allPoints = [cPos, ...displaySources.map((s) => [s.lat, s.lon])];
  map.flyToBounds(allPoints, { padding: [70, 70], maxZoom: 8, duration: 0.8 });
}

/* ==========================================================================
   Task 1: Pure Upwind Geospatial Math & Custom Location Analyzer
   ========================================================================== */

const EARTH_RADIUS_KM = 6371.0;

// Boundary polygon strictly enclosing Indian Punjab and Haryana
const PUNJAB_HARYANA_POLYGON = [
  [32.50, 75.60], [32.30, 75.95], [31.40, 76.60], [30.90, 77.10],
  [30.35, 77.60], [29.70, 77.30], [28.95, 77.30], [28.35, 77.60],
  [27.65, 77.35], [27.65, 75.95], [28.25, 75.80], [28.95, 75.40],
  [29.50, 74.45], [30.00, 73.85], [30.60, 74.15], [31.10, 74.55],
  [31.65, 74.80], [32.05, 75.00], [32.50, 75.60]
];

function isInPunjabHaryana(lat, lon) {
  const poly = PUNJAB_HARYANA_POLYGON;
  let inside = false;
  const n = poly.length;
  let p1x = poly[0][1], p1y = poly[0][0];

  for (let i = 1; i <= n; i++) {
    const p2x = poly[i % n][1], p2y = poly[i % n][0];
    if (lat > Math.min(p1y, p2y)) {
      if (lat <= Math.max(p1y, p2y)) {
        if (lon <= Math.max(p1x, p2x)) {
          let xinters = lon;
          if (p1y !== p2y) {
            xinters = (lat - p1y) * (p2x - p1x) / (p2y - p1y) + p1x;
          }
          if (p1x === p2x || lon <= xinters) {
            inside = !inside;
          }
        }
      }
    }
    p1x = p2x;
    p1y = p2y;
  }
  return inside;
}

function haversineKm(lat1, lon1, lat2, lon2) {
  const phi1 = (lat1 * Math.PI) / 180;
  const phi2 = (lat2 * Math.PI) / 180;
  const dphi = ((lat2 - lat1) * Math.PI) / 180;
  const dlambda = ((lon2 - lon1) * Math.PI) / 180;

  const a =
    Math.sin(dphi / 2) ** 2 +
    Math.cos(phi1) * Math.cos(phi2) * Math.sin(dlambda / 2) ** 2;
  const clamped = Math.min(1.0, Math.max(0.0, a));
  return EARTH_RADIUS_KM * 2 * Math.atan2(Math.sqrt(clamped), Math.sqrt(1 - clamped));
}

function bearingDeg(lat1, lon1, lat2, lon2) {
  const phi1 = (lat1 * Math.PI) / 180;
  const phi2 = (lat2 * Math.PI) / 180;
  const dlambda = ((lon2 - lon1) * Math.PI) / 180;

  const y = Math.sin(dlambda) * Math.cos(phi2);
  const x =
    Math.cos(phi1) * Math.sin(phi2) -
    Math.sin(phi1) * Math.cos(phi2) * Math.cos(dlambda);
  const bearingRad = Math.atan2(y, x);
  return ((bearingRad * 180) / Math.PI + 360.0) % 360.0;
}

function angleDiffDeg(a, b) {
  let diff = Math.abs(a - b) % 360.0;
  if (diff > 180.0) diff = 360.0 - diff;
  return diff;
}

function isUpwind(targetLat, targetLon, fireLat, fireLon, windFromDeg, tol = 30) {
  const bearingToFire = bearingDeg(targetLat, targetLon, fireLat, fireLon);
  return angleDiffDeg(bearingToFire, windFromDeg) <= tol;
}

function weightedMedian(pairs) {
  if (!pairs || pairs.length === 0) return 0.0;
  const sorted = [...pairs].sort((a, b) => a[0] - b[0]);
  const totalW = sorted.reduce((sum, p) => sum + p[1], 0);
  if (totalW <= 0) return sorted[Math.floor(sorted.length / 2)][0];
  const halfW = totalW / 2.0;
  let cumW = 0.0;
  for (const [val, w] of sorted) {
    cumW += w;
    if (cumW >= halfW) return val;
  }
  return sorted[sorted.length - 1][0];
}

/**
 * Task 1: Analyze smoke arrival for any user-clicked custom point on the map
 */
function analyzeCustomLocation(lat, lng, townName = null) {
  customLocationData = { lat, lng, name: townName };

  if (!currentData || !currentData.fires) return;

  // Filter fires by min FRP threshold and strictly inside Punjab/Haryana
  const activeFires = (currentData.fires || []).filter(
    (f) => (f.frp || 0) >= minFrpFilter && isInPunjabHaryana(parseFloat(f.lat), parseFloat(f.lon))
  );

  // Resolve surface wind from closest monitoring city
  let windSpeedNow = 10.0;
  let windFromNow = 300.0;

  if (currentData.cities && currentData.cities.length > 0) {
    let minCityDist = Infinity;
    let closestCity = currentData.cities[0];

    currentData.cities.forEach((c) => {
      const cLat = c.lat || 28.6139;
      const cLon = c.lon || 77.2090;
      const d = haversineKm(lat, lng, cLat, cLon);
      if (d < minCityDist) {
        minCityDist = d;
        closestCity = c;
      }
    });

    if (closestCity && closestCity.wind) {
      windSpeedNow = closestCity.wind.speed_kmh || 10.0;
      windFromNow = closestCity.wind.from_deg || 300.0;
    }
  }

  // Cluster active fires into 0.1° cells
  const clusters = {};
  activeFires.forEach((f) => {
    const fLat = parseFloat(f.lat);
    const fLon = parseFloat(f.lon);
    const frp = parseFloat(f.frp || 0);

    const cId = `${Math.floor(fLat / 0.1)}_${Math.floor(fLon / 0.1)}`;
    if (!clusters[cId]) {
      const cLat = Math.round((Math.floor(fLat / 0.1) + 0.5) * 0.1 * 1000000) / 1000000;
      const cLon = Math.round((Math.floor(fLon / 0.1) + 0.5) * 0.1 * 1000000) / 1000000;
      const dist = haversineKm(lat, lng, cLat, cLon);
      clusters[cId] = { lat: cLat, lon: cLon, fires: 0, frp: 0.0, distKm: dist };
    }
    clusters[cId].fires += 1;
    clusters[cId].frp += frp;
  });

  // Filter upwind fire clusters within 600 km
  const upwindClusters = [];
  Object.values(clusters).forEach((c) => {
    if (c.distKm <= 600 && isUpwind(lat, lng, c.lat, c.lon, windFromNow, 30)) {
      upwindClusters.push(c);
    }
  });

  let smokeScore = 0.0;
  const etaPairs = [];
  const transportSpeed = Math.max(3.0, windSpeedNow);

  upwindClusters.forEach((c) => {
    smokeScore += c.frp / (1.0 + c.distKm / 100.0);
    const cEta = c.distKm / transportSpeed;
    etaPairs.push([cEta, Math.max(1.0, c.frp)]);
  });

  let etaHours = null;
  if (etaPairs.length > 0) {
    const rawMedian = weightedMedian(etaPairs);
    const rEta = Math.round(rawMedian);
    if (rEta <= 48) etaHours = rEta;
  }

  let level = "LOW";
  if (smokeScore >= 200) level = "HIGH";
  else if (smokeScore >= 50) level = "MODERATE";

  const totalUpwindFires = upwindClusters.reduce((sum, c) => sum + c.fires, 0);
  upwindClusters.sort((a, b) => b.frp - a.frp);
  const topSources = upwindClusters.slice(0, 5);

  // Render Custom Location Pin Marker
  if (customLocationMarker) {
    map.removeLayer(customLocationMarker);
  }

  const customIcon = L.divIcon({
    html: `
      <div style="
        background: radial-gradient(circle, #00f0ff 0%, #0284c7 70%);
        border: 2px dashed #ffffff;
        border-radius: 50%;
        width: 22px;
        height: 22px;
        box-shadow: 0 0 16px #00f0ff, 0 0 30px rgba(0, 240, 255, 0.8);
      "></div>
    `,
    className: "custom-location-pin",
    iconSize: [22, 22],
    iconAnchor: [11, 11],
  });

  customLocationMarker = L.marker([lat, lng], { icon: customIcon }).addTo(map);

  const etaText = etaHours !== null ? `~${etaHours} hours` : "N/A (Upwind Clear)";
  const titleText = townName ? `📍 ${townName}` : `📍 Custom Location Analyzer`;
  const windInfo = getWindFlowInfo(windFromNow);

  const popupHtml = `
    <div style="font-family: 'Inter', sans-serif; padding: 4px; min-width: 250px;">
      <div style="font-weight:700; color:#00f0ff; font-size:0.95rem; margin-bottom:6px; border-bottom:1px solid rgba(0,240,255,0.3); padding-bottom:4px;">
        ${titleText}
      </div>
      <div style="font-size:0.83rem; line-height:1.55;">
        <strong>Coords:</strong> ${lat.toFixed(4)}°N, ${lng.toFixed(4)}°E<br>
        <strong>Upwind Fires (600km):</strong> <span style="color:#ff6b4a; font-weight:700;">${totalUpwindFires} fires</span><br>
        <strong>Smoke Arrival (ETA):</strong> <strong style="color:#00f0ff;">${etaText}</strong><br>
        <strong>Threat Level:</strong> <span class="level-badge ${level}" style="padding:2px 8px; font-size:0.75rem;">${level}</span><br>
        <strong>Threat Score:</strong> ${smokeScore.toFixed(1)}<br>
        <strong>Wind Speed:</strong> ${windSpeedNow.toFixed(1)} km/h<br>
        <strong>Wind Flow:</strong> ${windInfo.shortLabel} (${windInfo.fromDeg}° ➔ ${windInfo.toDeg}°)
      </div>
    </div>
  `;

  customLocationMarker.bindPopup(popupHtml, { className: "dark-leaflet-popup" }).openPopup();

  // Draw custom upwind trajectory vectors
  customTrajectoriesLayer.clearLayers();
  topSources.forEach((src, idx) => {
    const line = L.polyline([[src.lat, src.lon], [lat, lng]], {
      color: "#00f0ff",
      weight: Math.max(2, 4 - idx * 0.5),
      dashArray: "6, 6",
      opacity: 0.95,
    });
    line.bindTooltip(
      `💨 Upwind Cluster #${idx + 1} to Custom Pin<br>Dist: ${src.distKm.toFixed(1)} km &bull; FRP: ${src.frp.toFixed(1)} MW`,
      { sticky: true }
    );
    customTrajectoriesLayer.addLayer(line);

    // Directional flow arrow marker placed at midpoint along trajectory towards custom pin
    const midLat = (src.lat + lat) / 2.0;
    const midLon = (src.lon + lng) / 2.0;
    const flowAngle = bearingDeg(src.lat, src.lon, lat, lng);

    const arrowIcon = L.divIcon({
      html: `
        <div style="
          transform: rotate(${flowAngle - 90}deg);
          color: #00f0ff;
          font-size: 1.3rem;
          font-weight: 900;
          line-height: 1;
          filter: drop-shadow(0 0 6px #00f0ff);
          user-select: none;
        ">➔</div>
      `,
      className: "vector-flow-arrow-pin",
      iconSize: [20, 20],
      iconAnchor: [10, 10],
    });

    const arrowMarker = L.marker([midLat, midLon], { icon: arrowIcon, interactive: false });
    customTrajectoriesLayer.addLayer(arrowMarker);
  });

  const clearBtn = document.getElementById("btn-clear-custom");
  if (clearBtn) clearBtn.style.display = "inline-block";
}

/**
 * Task 1: Clear Custom Location Pin and Trajectories
 */
function clearCustomLocation() {
  customLocationData = null;
  if (customLocationMarker) {
    map.removeLayer(customLocationMarker);
    customLocationMarker = null;
  }
  if (customTrajectoriesLayer) {
    customTrajectoriesLayer.clearLayers();
  }
  const clearBtn = document.getElementById("btn-clear-custom");
  if (clearBtn) clearBtn.style.display = "none";

  const townSelect = document.getElementById("select-custom-town");
  if (townSelect) townSelect.selectedIndex = 0;
}

/* ==========================================================================
   FRP and Risk Threshold Filters
   ========================================================================== */

function applyFilters() {
  if (!currentData) return;

  const minFrpInput = document.getElementById("filter-min-frp");
  const minRiskInput = document.getElementById("filter-min-risk");

  minFrpFilter = minFrpInput ? parseFloat(minFrpInput.value) : 0;
  minRiskFilter = minRiskInput ? parseFloat(minRiskInput.value) : 0;

  const valFrp = document.getElementById("val-min-frp");
  const valRisk = document.getElementById("val-min-risk");

  if (valFrp) valFrp.textContent = `${minFrpFilter} MW`;
  if (valRisk) valRisk.textContent = `${minRiskFilter}`;

  const filteredFires = (currentData.fires || []).filter(
    (f) => (f.frp || 0) >= minFrpFilter
  );
  const filteredRiskCells = (currentData.risk_cells || []).filter(
    (c) => (c.risk || 0) >= minRiskFilter
  );

  renderFires(filteredFires);
  renderRiskCells(filteredRiskCells);

  // Update header stats counters
  const firesStat = document.getElementById("stat-fires-count");
  const cellsStat = document.getElementById("stat-cells-count");

  if (firesStat) firesStat.textContent = filteredFires.length.toLocaleString();
  if (cellsStat) cellsStat.textContent = filteredRiskCells.length.toLocaleString();

  if (customLocationData) {
    analyzeCustomLocation(customLocationData.lat, customLocationData.lng, customLocationData.name);
  }

  renderTelemetryGraph();
}

/**
 * Render dynamic Delhi sector smoke threat graph
 */
function renderTelemetryGraph() {
  const container = document.getElementById("telemetry-bars-chart");
  const modeIndicator = document.getElementById("graph-mode-indicator");
  const modeHint = document.getElementById("graph-mode-hint");
  if (!container || !currentData || !currentData.cities) return;

  const isReplay = currentData.mode === "replay";
  if (modeIndicator) {
    modeIndicator.textContent = isReplay ? "Mode: Peak Replay (2024-11-01)" : "Mode: Live Telemetry";
    modeIndicator.className = isReplay ? "graph-mode-indicator replay" : "graph-mode-indicator";
  }
  if (modeHint) {
    modeHint.textContent = isReplay
      ? "Showing severe peak season smoke surge across Delhi sectors (Nov 1, 2024)"
      : "Real-time ambient threat & wind conditions across Delhi sectors";
  }

  const cities = currentData.cities.filter((c) => c.city !== "Delhi");
  container.innerHTML = "";

  // Determine max value for the selected metric
  let maxVal = 1;
  cities.forEach((c) => {
    let val = 0;
    if (currentGraphMetric === "score") val = c.score || 0;
    else if (currentGraphMetric === "fires") val = c.upwind_fire_count || 0;
    else if (currentGraphMetric === "wind") val = (c.wind && c.wind.speed_kmh) || 0;
    if (val > maxVal) maxVal = val;
  });

  cities.forEach((c) => {
    const row = document.createElement("div");
    row.className = "bar-row";

    let val = 0;
    let valLabel = "";
    let levelClass = "level-low";

    if (currentGraphMetric === "score") {
      val = c.score || 0;
      valLabel = `${val.toFixed(1)} pts`;
      if (val >= 200 || c.level === "HIGH") levelClass = "level-high";
      else if (val >= 50 || c.level === "MODERATE") levelClass = "level-moderate";
    } else if (currentGraphMetric === "fires") {
      val = c.upwind_fire_count || 0;
      valLabel = `${val} fires`;
      if (val >= 40) levelClass = "level-high";
      else if (val >= 15) levelClass = "level-moderate";
    } else if (currentGraphMetric === "wind") {
      val = (c.wind && c.wind.speed_kmh) || 0;
      valLabel = `${val.toFixed(1)} km/h`;
      levelClass = "level-low";
    }

    const pct = Math.max(3, Math.min(100, (val / maxVal) * 100));

    row.innerHTML = `
      <div class="bar-city-label" title="${c.city}">${c.city}</div>
      <div class="bar-track">
        <div class="bar-fill ${levelClass}" style="width: ${pct}%;"></div>
      </div>
      <div class="bar-value-label">${valLabel}</div>
    `;

    row.style.cursor = "pointer";
    row.addEventListener("click", () => {
      selectCity(c.city);
    });

    container.appendChild(row);
  });
}
