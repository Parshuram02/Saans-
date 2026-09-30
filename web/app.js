/**
 * Saans (साँस) — Frontend Application Logic
 * Pure Vanilla JavaScript + Leaflet.js
 */

// Global configuration: API_BASE can be overridden by deployment or left blank for local JSON fallback
const API_BASE = window.API_BASE || "";

// Carto Maps API key for authenticated dark basemap tiles
const CARTO_API_KEY = "cb1_45g4_1_c1c32825df893b0075fc601b";

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

let currentData = null;
let activeCityName = "Delhi";

// Initialize on DOM ready
document.addEventListener("DOMContentLoaded", () => {
  initMap();
  setupEventListeners();
  loadData();
});

/**
 * Initialize Leaflet map with CartoDB Dark Matter tiles
 */
function initMap() {
  map = L.map("map", {
    center: DEFAULT_MAP_CENTER,
    zoom: DEFAULT_MAP_ZOOM,
    zoomControl: true,
  });

  // Dark matter basemap for satellite data contrast
  L.tileLayer(
    `https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png?api_key=${CARTO_API_KEY}`,
    {
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
      subdomains: "abcd",
      maxZoom: 20,
      errorTileUrl: "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", // fallback without key on tile error
    }
  ).addTo(map);

  // Initialize Layer Groups
  riskCellsLayer = L.layerGroup().addTo(map);
  firesLayer = L.layerGroup().addTo(map);
  trajectoriesLayer = L.layerGroup().addTo(map);
  citiesLayer = L.layerGroup().addTo(map);
}

/**
 * Setup UI control listeners
 */
function setupEventListeners() {
  document.getElementById("btn-reset-map").addEventListener("click", () => {
    map.flyTo(DEFAULT_MAP_CENTER, DEFAULT_MAP_ZOOM);
  });

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
    modeText.textContent = `REPLAY of ${data.as_of || "Historical Peak"}`;
  } else {
    modeText.textContent = `LIVE SATELLITE TELEMETRY`;
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

  if (data.generated_at) {
    const dt = new Date(data.generated_at);
    lastUpdated.textContent = `Generated: ${dt.toLocaleString()}`;
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
    const windFrom = c.wind ? c.wind.from_deg.toFixed(0) : "0";

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
        <div class="wind-indicator" title="Wind blowing FROM ${windFrom}°">
          <span class="compass-arrow" style="transform: rotate(${windFrom}deg);">⬇</span>
          <span>Wind: ${windSpeed} km/h from ${windFrom}°</span>
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

  drawTrajectories(cityData);
}

/**
 * Render 0.1° Risk Grid Rectangles
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
    const opacity = Math.min(0.7, 0.2 + (c.risk / 100.0) * 0.5);

    const rect = L.rectangle(bounds, {
      color: color,
      weight: 1,
      fillColor: color,
      fillOpacity: opacity,
    });

    rect.bindTooltip(
      `
      <div style="font-size: 0.82rem; line-height: 1.4;">
        <strong>Grid Cell ${c.cell_id}</strong><br>
        Center: ${c.lat.toFixed(2)}°N, ${c.lon.toFixed(2)}°E<br>
        <span style="color:${color}; font-weight:700;">Stubble Risk: ${c.risk.toFixed(1)} / 100</span><br>
        48h Active Fires: ${c.fires_48h}<br>
        History Climatology: ${(c.history_norm * 100).toFixed(1)}%<br>
        Recent Diffusion: ${(c.recent_norm * 100).toFixed(1)}%
      </div>
      `,
      { sticky: true, opacity: 0.95 }
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
 * Render VIIRS Active Fire points sized by FRP
 */
function renderFires(fires) {
  firesLayer.clearLayers();

  fires.forEach((f) => {
    const frp = f.frp || 10.0;
    // Radius proportional to sqrt(frp)
    const radius = Math.min(10, Math.max(3, Math.sqrt(frp) * 1.2));

    const circle = L.circleMarker([f.lat, f.lon], {
      radius: radius,
      fillColor: "#ff4500",
      color: "#ffddbb",
      weight: 1,
      opacity: 0.9,
      fillOpacity: 0.85,
    });

    circle.bindTooltip(
      `
      <div style="font-size: 0.8rem;">
        <span style="color:#ff6633; font-weight:700;">🔥 Active Fire Detection</span><br>
        Coords: ${f.lat.toFixed(4)}, ${f.lon.toFixed(4)}<br>
        FRP (Radiative Power): <strong>${frp.toFixed(1)} MW</strong><br>
        Acquired: ${f.acq_date} ${f.acq_time || ""}
      </div>
      `,
      { sticky: true }
    );

    firesLayer.addLayer(circle);
  });
}

/**
 * Render Target City Markers
 */
function renderCities(cities) {
  citiesLayer.clearLayers();

  const cityCoords = {
    Delhi: [28.6139, 77.2090],
    Ludhiana: [30.9010, 75.8573],
    Chandigarh: [30.7333, 76.7794],
  };

  cities.forEach((c) => {
    const pos = cityCoords[c.city];
    if (!pos) return;

    const iconHtml = `
      <div style="
        display: flex;
        align-items: center;
        gap: 6px;
        background: rgba(10, 15, 29, 0.9);
        border: 2px solid #06b6d4;
        border-radius: 20px;
        padding: 3px 10px;
        color: #fff;
        font-size: 0.78rem;
        font-weight: 700;
        box-shadow: 0 0 12px rgba(6, 182, 212, 0.6);
        cursor: pointer;
        white-space: nowrap;
      ">
        <span style="width: 8px; height: 8px; border-radius: 50%; background: #06b6d4;"></span>
        ${c.city}
      </div>
    `;

    const customIcon = L.divIcon({
      html: iconHtml,
      className: "custom-city-pin",
      iconAnchor: [35, 12],
    });

    const marker = L.marker(pos, { icon: customIcon });
    marker.on("click", () => {
      selectCity(c.city);
    });

    citiesLayer.addLayer(marker);
  });
}

/**
 * Draw upwind trajectory vectors from top fire clusters to the selected city
 */
function drawTrajectories(cityData) {
  trajectoriesLayer.clearLayers();

  const cityCoords = {
    Delhi: [28.6139, 77.2090],
    Ludhiana: [30.9010, 75.8573],
    Chandigarh: [30.7333, 76.7794],
  };

  const cPos = cityCoords[cityData.city];
  if (!cPos || !cityData.top_sources || cityData.top_sources.length === 0) {
    return;
  }

  cityData.top_sources.forEach((src, idx) => {
    const sPos = [src.lat, src.lon];

    // Dashed trajectory vector
    const line = L.polyline([sPos, cPos], {
      color: "#38bdf8",
      weight: Math.max(2, 4 - idx * 0.5),
      opacity: 0.85,
      dashArray: "6, 6",
    });

    line.bindTooltip(
      `
      <div style="font-size: 0.8rem;">
        <strong>Smoke Vector #${idx + 1} to ${cityData.city}</strong><br>
        Source Cluster: ${src.lat.toFixed(2)}°N, ${src.lon.toFixed(2)}°E<br>
        Distance: ${src.distance_km.toFixed(1)} km<br>
        Cluster Fires: ${src.fires} (FRP: ${src.frp.toFixed(1)} MW)
      </div>
      `,
      { sticky: true }
    );

    trajectoriesLayer.addLayer(line);
  });

  // Fit bounds to show city and its sources
  const allPoints = [cPos, ...cityData.top_sources.map((s) => [s.lat, s.lon])];
  map.flyToBounds(allPoints, { padding: [60, 60], maxZoom: 8, duration: 1.0 });
}
