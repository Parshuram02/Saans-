/**
 * BreathAhead — Frontend Application Logic
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
  setupNavbarNavigation();
  loadData();

  window.addEventListener("resize", () => {
    if (map) map.invalidateSize();
  });
});

/**
 * Setup Navbar scroll shadow, mobile menu toggle, and active section tracking
 */
function setupNavbarNavigation() {
  const header = document.getElementById("app-header");
  const mobileBtn = document.getElementById("mobile-toggle-btn");
  const mobilePanel = document.getElementById("mobile-nav-panel");
  const navLinks = document.querySelectorAll(".nav-link, .mobile-nav-link");

  // Faint scroll shadow past 8px
  window.addEventListener("scroll", () => {
    if (window.scrollY > 8) {
      if (header) header.classList.add("scrolled");
    } else {
      if (header) header.classList.remove("scrolled");
    }
  });

  // Mobile drawer toggle
  if (mobileBtn && mobilePanel) {
    mobileBtn.addEventListener("click", () => {
      const isOpen = mobilePanel.classList.contains("is-open");
      if (isOpen) {
        mobilePanel.classList.remove("is-open");
        mobileBtn.setAttribute("aria-expanded", "false");
        mobilePanel.setAttribute("aria-hidden", "true");
      } else {
        mobilePanel.classList.add("is-open");
        mobileBtn.setAttribute("aria-expanded", "true");
        mobilePanel.setAttribute("aria-hidden", "false");
      }
    });

    // Close mobile panel on Escape key
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && mobilePanel.classList.contains("is-open")) {
        mobilePanel.classList.remove("is-open");
        mobileBtn.setAttribute("aria-expanded", "false");
        mobilePanel.setAttribute("aria-hidden", "true");
        mobileBtn.focus();
      }
    });
  }

  // Active section indicator on scroll & link click
  navLinks.forEach((link) => {
    link.addEventListener("click", () => {
      if (mobilePanel && mobilePanel.classList.contains("is-open")) {
        mobilePanel.classList.remove("is-open");
        if (mobileBtn) mobileBtn.setAttribute("aria-expanded", "false");
        mobilePanel.setAttribute("aria-hidden", "true");
      }

      const targetHref = link.getAttribute("href");
      if (targetHref && targetHref.startsWith("#")) {
        navLinks.forEach((l) => {
          l.classList.remove("active");
          l.removeAttribute("aria-current");
        });
        link.classList.add("active");
        link.setAttribute("aria-current", "page");
      }
    });
  });
}

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

  // 3. OpenStreetMap Standard
  const osmLayer = L.tileLayer(
    "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
    {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      maxZoom: 19,
    }
  );

  // 4. Sleek Dark Canvas Mode (Esri Dark - Zero Watermarks)
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

  // 5. Esri High-Resolution Satellite
  const esriSatellite = L.tileLayer(
    "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    {
      attribution: "Tiles &copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS",
      maxZoom: 19,
    }
  );

  // 6. Google Terrain
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
    osm: osmLayer,
    dark_canvas: darkCanvasGroup,
    esri_satellite: esriSatellite,
    google_terrain: googleTerrain,
  };

  // Set default basemap layer to Google Hybrid
  currentBaseLayer = baseLayers.google_hybrid;
  currentBaseLayer.addTo(map);

  // Ensure canvas size recalculation
  setTimeout(() => {
    if (map) map.invalidateSize();
  }, 250);

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

  // City Sector Search & Dropdown Selectors
  const citySearchInput = document.getElementById("input-city-search");
  if (citySearchInput) {
    citySearchInput.addEventListener("input", (e) => {
      filterCitiesBySearch(e.target.value);
    });
  }

  const cityDropdownSelect = document.getElementById("select-city-dropdown");
  if (cityDropdownSelect) {
    cityDropdownSelect.addEventListener("change", (e) => {
      selectCity(e.target.value);
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
    const modeText = document.getElementById("mode-text");
    if (modeText) modeText.textContent = "Telemetry Offline";
    const container = document.getElementById("city-cards-container");
    if (container) {
      container.innerHTML = `
        <div style="grid-column: 1/-1; padding: 24px; background: #FEF2F2; border: 1px solid #FCA5A5; border-radius: 8px; color: #B91C1C;">
          <strong>Error loading data:</strong> ${err.message}.<br>
          Ensure dataset files exist in <code>web/data/</code>.
        </div>
      `;
    }
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
  if (modeBadge) modeBadge.className = `mode-badge ${data.mode || "live"}`;

  if (mode === "REPLAY") {
    if (modeText) modeText.textContent = "PEAK REPLAY • 01 NOV 2024";
    if (lastUpdated) lastUpdated.innerHTML = "<strong>Peak Episode Benchmark:</strong> 01 Nov 2024, 02:00 PM IST (Annual Peak Surge)";
  } else {
    if (modeText) modeText.textContent = "LIVE TELEMETRY • 03 OCT 2026";
    if (lastUpdated) lastUpdated.innerHTML = "<strong>Live Telemetry:</strong> 03 Oct 2026, 06:30 AM IST (Active Sync)";
  }

  const btnLive = document.getElementById("btn-mode-live");
  const btnReplay = document.getElementById("btn-mode-replay");
  if (btnLive && btnReplay) {
    if (mode === "REPLAY") {
      btnReplay.classList.add("active");
      btnReplay.classList.remove("btn-outline");
      btnLive.classList.remove("active");
      btnLive.classList.add("btn-outline");
    } else {
      btnLive.classList.add("active");
      btnLive.classList.remove("btn-outline");
      btnReplay.classList.remove("active");
      btnReplay.classList.add("btn-outline");
    }
  }

  // Summary Metrics
  const fireCount = data.fires ? data.fires.length : 0;
  const statFires = document.getElementById("stat-fires-count");
  if (statFires) statFires.textContent = fireCount.toLocaleString();

  const cellCount = data.risk_cells ? data.risk_cells.length : 0;
  const statCells = document.getElementById("stat-cells-count");
  if (statCells) statCells.textContent = cellCount.toLocaleString();

  let maxRisk = 0;
  let maxRiskCell = null;
  if (data.risk_cells && data.risk_cells.length > 0) {
    maxRisk = data.risk_cells[0].risk;
    maxRiskCell = data.risk_cells[0];
  }
  const statMaxRisk = document.getElementById("stat-max-risk");
  if (statMaxRisk) statMaxRisk.textContent = `${maxRisk.toFixed(1)}`;
  
  const statMaxDistrict = document.getElementById("stat-max-district");
  if (maxRiskCell && statMaxDistrict) {
    statMaxDistrict.textContent = `Lat ${maxRiskCell.lat.toFixed(2)}, Lon ${maxRiskCell.lon.toFixed(2)}`;
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

  const statHighestCity = document.getElementById("stat-highest-city");
  if (statHighestCity) statHighestCity.textContent = highestThreatCity;
  
  const statHighestEta = document.getElementById("stat-highest-eta");
  if (statHighestEta) statHighestEta.textContent = highestEta;
}

/**
 * Render City Threat Section (Spotlight Hero Card + Quick Chips + Compact Searchable Grid)
 */
function renderCityCards(cities) {
  if (!cities || cities.length === 0) return;

  const validCities = cities.filter(
    (c) => c.city !== "Delhi" && (c.city.includes("Delhi") || c.city.includes("NCR"))
  );

  // 1. Populate Dropdown Options
  const dropdown = document.getElementById("select-city-dropdown");
  if (dropdown) {
    dropdown.innerHTML = "";
    validCities.forEach((c) => {
      const opt = document.createElement("option");
      opt.value = c.city;
      opt.textContent = `📍 ${c.city}`;
      if (c.city === activeCityName) opt.selected = true;
      dropdown.appendChild(opt);
    });
  }

  // 2. Populate Quick-Select Sector Chips Strip
  const chipsContainer = document.getElementById("sector-chips-container");
  if (chipsContainer) {
    chipsContainer.innerHTML = "";
    validCities.forEach((c) => {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = `sector-chip ${c.city === activeCityName ? "active" : ""}`;
      chip.innerHTML = `<span>${c.city}</span> <span class="level-badge ${c.level}" style="padding: 1px 6px; font-size: 0.68rem;">${c.level}</span>`;
      chip.addEventListener("click", () => {
        selectCity(c.city);
      });
      chipsContainer.appendChild(chip);
    });
  }

  // 3. Render Spotlight Hero Card
  const activeCityData = validCities.find((c) => c.city === activeCityName) || validCities[0];
  if (activeCityData) {
    activeCityName = activeCityData.city;
    renderSpotlightCard(activeCityData);
  }

  // 4. Render Compact Sector Grid (Filterable)
  renderCompactCards(validCities);
}

/**
 * Render Hero Spotlight Dashboard Card for the actively selected Delhi sector
 */
function renderSpotlightCard(c) {
  const container = document.getElementById("sector-spotlight-container");
  if (!container || !c) return;

  const etaText = c.eta_hours !== null ? `~${c.eta_hours} hours` : (c.level === "STAGNANT" ? "Stagnant (Calm Winds)" : "N/A (Upwind Clear)");
  const windSpeed = c.wind ? c.wind.speed_kmh.toFixed(1) : "0.0";
  const windInfo = c.wind ? getWindFlowInfo(c.wind.from_deg) : getWindFlowInfo(0);
  const headline = `Smoke traversing from <strong>${c.upwind_fire_count} upwind farm fires</strong> across Punjab & Haryana, estimated arrival in <strong>${etaText}</strong> with threat score <strong>${c.score.toFixed(1)}</strong>.`;

  container.innerHTML = `
    <div class="spotlight-header">
      <div class="spotlight-title-group">
        <span class="spotlight-city-name">${c.city}</span>
        <span class="level-badge ${c.level}">${c.level} RISK</span>
      </div>
      <button class="btn-inspect-trajectories" type="button">🎯 Trace Vectors on Map</button>
    </div>

    <p class="spotlight-headline">${headline}</p>

    <div class="spotlight-grid">
      <div class="spotlight-metric-item">
        <span class="spotlight-metric-label">Estimated Arrival (ETA)</span>
        <span class="spotlight-metric-val">${etaText}</span>
      </div>
      <div class="spotlight-metric-item">
        <span class="spotlight-metric-label">Upwind Fire Sources</span>
        <span class="spotlight-metric-val" style="color: #ff3366;">${c.upwind_fire_count} fires</span>
      </div>
      <div class="spotlight-metric-item">
        <span class="spotlight-metric-label">Smoke Threat Score</span>
        <span class="spotlight-metric-val" style="color: #00f0ff;">${c.score.toFixed(1)} pts</span>
      </div>
      <div class="spotlight-metric-item">
        <span class="spotlight-metric-label">Primary Cluster Distance</span>
        <span class="spotlight-metric-val">${c.top_sources && c.top_sources.length > 0 ? `${c.top_sources[0].distance_km.toFixed(0)} km` : "Clear"}</span>
      </div>
    </div>

    <div class="spotlight-footer">
      <div class="spotlight-wind-info">
        <span class="compass-arrow-badge" style="transform: rotate(${windInfo.arrowDeg}deg); transition: transform 0.4s ease;">
          <span style="font-weight:900; color:#00f0ff; font-size:0.95rem; line-height:1;">⬆</span>
        </span>
        <span><strong>Surface Wind:</strong> ${windSpeed} km/h &bull; Flowing from ${windInfo.fromDeg}° (${windInfo.shortLabel}) toward ${windInfo.toDeg}°</span>
      </div>
      <div style="font-size: 0.8rem; color: var(--text-dim);">
        Coordinates: ${c.lat ? c.lat.toFixed(4) : 28.6139}°N, ${c.lon ? c.lon.toFixed(4) : 77.2090}°E
      </div>
    </div>
  `;

  const btnInspect = container.querySelector(".btn-inspect-trajectories");
  if (btnInspect) {
    btnInspect.addEventListener("click", () => {
      const mapElem = document.getElementById("map-section");
      if (mapElem) mapElem.scrollIntoView({ behavior: "smooth" });
      drawTrajectories(c);
    });
  }

  // Render Action Playbook for this sector
  renderActionPlaybook(c);
}

/**
 * Render Action & Exposure Playbook Hub for schools, households, vulnerable citizens, and municipal response
 */
function renderActionPlaybook(c) {
  const container = document.getElementById("playbook-cards-grid");
  const statusBadge = document.getElementById("playbook-sector-status");
  const playbookTitle = document.getElementById("playbook-title");
  if (!container || !c) return;

  const score = c.score || 0;
  const level = c.level || "LOW";
  const etaHours = c.eta_hours;
  const upwindFires = c.upwind_fire_count || 0;
  const etaText = etaHours !== null ? `~${etaHours} hours` : (level === "STAGNANT" ? "Stagnant (Calm Winds)" : "N/A (Upwind Clear)");

  if (playbookTitle) {
    playbookTitle.textContent = `${c.city} — Sector Protection & Action Playbook`;
  }

  // Determine overall status tag
  let statusClass = "status-low";
  let statusText = "🟢 Normal Operational State";
  if (level === "HIGH" || score >= 200) {
    statusClass = "status-high";
    statusText = `🚨 Code Red Influx Alert (${upwindFires} Upwind Fires &bull; ETA: ${etaText})`;
  } else if (level === "MODERATE" || score >= 50) {
    statusClass = "status-moderate";
    statusText = `⚠️ Moderate Advisory Active (${upwindFires} Fires &bull; ETA: ${etaText})`;
  } else if (level === "STAGNANT") {
    statusClass = "status-stagnant";
    statusText = "🔵 Stagnant Calm Wind Notice";
  }

  if (statusBadge) {
    statusBadge.className = `playbook-status-badge ${statusClass}`;
    statusBadge.innerHTML = statusText;
  }

  // 1. School Safety Advisory
  let schoolBadge = "🟢 REGULAR SCHEDULE";
  let schoolBadgeClass = "badge-low";
  let schoolActions = [
    "Outdoor morning assemblies permitted under standard guidelines.",
    "Monitor afternoon wind shifts for changing upwind trajectories.",
    "Ensure school clinic has basic first-aid for sensitive students."
  ];

  if (level === "HIGH" || score >= 200) {
    schoolBadge = "🚨 CODE RED: EMERGENCY PROTOCOL";
    schoolBadgeClass = "badge-high";
    schoolActions = [
      `<strong>Shift Primary Classes (1–5) to Hybrid / Online:</strong> Send parental notification 12h in advance (Arrival ETA: ${etaText}).`,
      "<strong>Cancel All Outdoor Assemblies & PE:</strong> Strictly prohibit open-air sports during peak smoke transit.",
      "<strong>Activate Classroom HEPA Units:</strong> Pre-scrub indoor air 2 hours before estimated arrival.",
      "<strong>Mandatory Masking on School Transit:</strong> Ensure N95/FFP2 masks for students traveling via open school buses / vans."
    ];
  } else if (level === "MODERATE" || score >= 50) {
    schoolBadge = "⚠️ CODE ORANGE: RESTRICTED ACTIVITY";
    schoolBadgeClass = "badge-moderate";
    schoolActions = [
      "<strong>Move Morning Assembly Indoors:</strong> Limit prolonged outdoor gatherings before 10 AM.",
      "<strong>Exempt Asthmatic / Sensitive Students:</strong> Allow indoor library recreation during physical education periods.",
      "<strong>Pre-Seal Classroom Doors & Windows:</strong> Minimize draft ingress during upwind smoke transit window."
    ];
  }

  // 2. Indoor Air Quality & Filtration Playbook
  let indoorBadge = "🟢 CLEAN AIR WINDOW";
  let indoorBadgeClass = "badge-low";
  let indoorActions = [
    "Safe window ventilation period while upwind transport remains low.",
    "Standard HEPA purifier maintenance and background filtration.",
    "Check indoor PM2.5 levels periodically."
  ];

  if (level === "HIGH" || score >= 200) {
    indoorBadge = "🚨 PRE-SEAL & PURIFY NOW";
    indoorBadgeClass = "badge-high";
    indoorActions = [
      `<strong>HEPA Pre-Purification Window:</strong> Turn indoor air purifiers to MAX speed <strong>2 hours prior to arrival (ETA: ${etaText})</strong> to lower baseline indoor PM2.5.`,
      "<strong>Total Window Lockdown:</strong> Tightly seal north-west facing windows and balcony sliders to prevent toxic plume infiltration.",
      "<strong>Avoid Indoor Pollutant Creation:</strong> Prohibit indoor frying, vacuuming without HEPA exhaust, or lighting incense/candles during smoke surge.",
      "<strong>Create Clean Room Sanctuary:</strong> Designate a central bedroom with door draft-stoppers and continuous filtration."
    ];
  } else if (level === "MODERATE" || score >= 50) {
    indoorBadge = "⚠️ ADVISORY FILTRATION";
    indoorBadgeClass = "badge-moderate";
    indoorActions = [
      `<strong>Timed Ventilation:</strong> Close windows by estimated arrival (~${etaText}). Ventilate briefly only during clean upwind intervals.`,
      "<strong>Run Air Purifiers on Auto/Medium:</strong> Ensure filters are clean and pre-filters washed.",
      "<strong>Wet-Mopping Strategy:</strong> Use damp micro-fiber cloths for dusting to prevent PM2.5 re-suspension."
    ];
  }

  // 3. Vulnerable Groups & Exposure Mitigation
  let vulnBadge = "🟢 ROUTINE MONITORING";
  let vulnBadgeClass = "badge-low";
  let vulnActions = [
    "Elderly and children can conduct regular outdoor walks during daylight hours.",
    "Maintain standard hydration and general respiratory health."
  ];

  if (level === "HIGH" || score >= 200) {
    vulnBadge = "🚨 STRICT EXPOSURE CAPS";
    vulnBadgeClass = "badge-high";
    vulnActions = [
      "<strong>Elderly & Asthmatics:</strong> Strictly avoid morning walks and outdoor exercise; keep bronchodilators / rescue inhalers readily accessible.",
      "<strong>Outdoor Gig & Construction Workers:</strong> Enforce N95 / FFP2 mask mandates; cap outdoor continuous exertion shifts to < 45 minutes with indoor respite stations.",
      "<strong>Expecting Mothers & Infants:</strong> Remain in indoor purified spaces with sealed double-pane barriers during plume passage.",
      "<strong>Cardiovascular Care:</strong> Avoid strenuous physical exertion that increases minute ventilation and particulate lung deposition."
    ];
  } else if (level === "MODERATE" || score >= 50) {
    vulnBadge = "⚠️ TARGETED PRECAUTIONS";
    vulnBadgeClass = "badge-moderate";
    vulnActions = [
      "<strong>Sensitive Individuals:</strong> Limit strenuous outdoor cardio; shift workouts to indoor filtered spaces.",
      "<strong>Commuters:</strong> Wear well-fitted N95 masks during peak morning/evening traffic corridors.",
      "<strong>Hydration:</strong> Maintain adequate fluid intake to support mucociliary respiratory clearance."
    ];
  }

  // 4. Pre-Emptive City & Policy Interventions (GRAP)
  let grapBadge = level === "HIGH" ? "🚨 PRE-EMPTIVE GRAP IV" : (level === "MODERATE" ? "⚠️ GRAP II / III PREPAREDNESS" : "🟢 STAGE I MONITORING");
  let grapBadgeClass = level === "HIGH" ? "badge-high" : (level === "MODERATE" ? "badge-moderate" : "badge-low");
  let grapActions = level === "HIGH" ? [
    `<strong>Pre-Emptive Water Cannon Deployment:</strong> Dispatch anti-smog guns to ${c.city} key traffic junctions 12h ahead of arrival ETA.`,
    "<strong>Targeted Commercial Truck Diversion:</strong> Re-route non-essential diesel freight trucks to Western/Eastern Peripheral Expressways.",
    "<strong>Mandatory Construction Dust Halts:</strong> Issue immediate stop-work notices on open excavation and demolition."
  ] : [
    "Synchronize mechanical street sweepers along major arterial corridors.",
    "Ensure un-interrupted power supply to prevent local diesel generator reliance.",
    "Monitor cross-border transport vectors from Punjab and Haryana."
  ];

  container.innerHTML = `
    <!-- Card 1: School Safety -->
    <div class="playbook-card">
      <div class="playbook-card-header">
        <div class="playbook-card-title-group">
          <span class="playbook-icon">🏫</span>
          <div>
            <h4>School & Student Safety</h4>
            <span class="playbook-card-sub">Protocols for principals, teachers & parents</span>
          </div>
        </div>
        <span class="playbook-mini-badge ${schoolBadgeClass}">${schoolBadge}</span>
      </div>
      <ul class="playbook-list">
        ${schoolActions.map(a => `<li>${a}</li>`).join("")}
      </ul>
    </div>

    <!-- Card 2: Indoor Air & Filtration -->
    <div class="playbook-card">
      <div class="playbook-card-header">
        <div class="playbook-card-title-group">
          <span class="playbook-icon">🏠</span>
          <div>
            <h4>Indoor Air & Filtration</h4>
            <span class="playbook-card-sub">HEPA pre-scrubbing & window sealing guide</span>
          </div>
        </div>
        <span class="playbook-mini-badge ${indoorBadgeClass}">${indoorBadge}</span>
      </div>
      <ul class="playbook-list">
        ${indoorActions.map(a => `<li>${a}</li>`).join("")}
      </ul>
    </div>

    <!-- Card 3: Vulnerable Groups -->
    <div class="playbook-card">
      <div class="playbook-card-header">
        <div class="playbook-card-title-group">
          <span class="playbook-icon">😷</span>
          <div>
            <h4>Vulnerable Population Health</h4>
            <span class="playbook-card-sub">Elderly, children & outdoor gig workers</span>
          </div>
        </div>
        <span class="playbook-mini-badge ${vulnBadgeClass}">${vulnBadge}</span>
      </div>
      <ul class="playbook-list">
        ${vulnActions.map(a => `<li>${a}</li>`).join("")}
      </ul>
    </div>

    <!-- Card 4: Pre-Emptive City Actions -->
    <div class="playbook-card">
      <div class="playbook-card-header">
        <div class="playbook-card-title-group">
          <span class="playbook-icon">🏛️</span>
          <div>
            <h4>Pre-Emptive City & GRAP Action</h4>
            <span class="playbook-card-sub">Municipal interventions 12–24h prior to spike</span>
          </div>
        </div>
        <span class="playbook-mini-badge ${grapBadgeClass}">${grapBadge}</span>
      </div>
      <ul class="playbook-list">
        ${grapActions.map(a => `<li>${a}</li>`).join("")}
      </ul>
    </div>
  `;
}

/**
 * Render compact searchable micro-cards for quick overview of all Delhi sectors
 */
function renderCompactCards(cities, filterText = "") {
  const container = document.getElementById("city-cards-container");
  if (!container) return;
  container.innerHTML = "";

  const query = filterText.trim().toLowerCase();
  const filtered = cities.filter((c) => c.city.toLowerCase().includes(query));

  if (filtered.length === 0) {
    container.innerHTML = `<div style="grid-column: 1/-1; padding: 16px; color: var(--text-dim); font-size: 0.86rem;">No Delhi sectors matching "${filterText}". Try "Rohini", "Saket", "Anand Vihar"...</div>`;
    return;
  }

  filtered.forEach((c) => {
    const card = document.createElement("div");
    card.className = `compact-city-card ${c.city === activeCityName ? "active" : ""}`;
    card.dataset.city = c.city;

    const etaText = c.eta_hours !== null ? `ETA: ~${c.eta_hours}h` : "ETA: N/A";

    card.innerHTML = `
      <div>
        <div class="compact-city-name">${c.city}</div>
        <div class="compact-city-eta">${etaText} &bull; ${c.upwind_fire_count} upwind fires</div>
      </div>
      <span class="level-badge ${c.level}">${c.level}</span>
    `;

    card.addEventListener("click", () => {
      selectCity(c.city);
    });

    container.appendChild(card);
  });
}

/**
 * Filter compact cards by search text
 */
function filterCitiesBySearch(text) {
  if (!currentData || !currentData.cities) return;
  const validCities = currentData.cities.filter(
    (c) => c.city !== "Delhi" && (c.city.includes("Delhi") || c.city.includes("NCR"))
  );
  renderCompactCards(validCities, text);
}

/**
 * Handle city selection: highlight card and draw smoke vectors
 */
function selectCity(cityName) {
  activeCityName = cityName;

  // 1. Sync dropdown
  const dropdown = document.getElementById("select-city-dropdown");
  if (dropdown && dropdown.value !== cityName) {
    dropdown.value = cityName;
  }

  // 2. Sync chips
  document.querySelectorAll(".sector-chip").forEach((chip) => {
    if (chip.textContent.includes(cityName)) {
      chip.classList.add("active");
    } else {
      chip.classList.remove("active");
    }
  });

  // 3. Sync compact cards
  document.querySelectorAll(".compact-city-card").forEach((card) => {
    if (card.dataset.city === cityName) {
      card.classList.add("active");
    } else {
      card.classList.remove("active");
    }
  });

  if (!currentData || !currentData.cities) return;
  const cityData = currentData.cities.find((c) => c.city === cityName);
  if (!cityData) return;

  renderSpotlightCard(cityData);
  renderCities(currentData.cities);
  drawTrajectories(cityData);
}

/**
 * Render 0.1° Risk Grid Rectangles with subtle glass styling
 */
function renderRiskCells(cells) {
  riskCellsLayer.clearLayers();

  const validCells = (cells || []).filter((c) =>
    isInPunjabHaryana(parseFloat(c.lat), parseFloat(c.lon))
  );

  const halfCell = CELL_DEG / 2.0;

  validCells.forEach((c) => {
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

  const validFires = (fires || []).filter((f) =>
    isInPunjabHaryana(parseFloat(f.lat), parseFloat(f.lon))
  );

  validFires.forEach((f) => {
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

  const validCities = (cities || []).filter(
    (c) => c.city !== "Delhi" && (c.city.includes("Delhi") || c.city.includes("NCR"))
  );

  validCities.forEach((c) => {
    const pos = [c.lat || 28.6139, c.lon || 77.2090];
    if (!pos[0] || !pos[1]) return;

    const isSelected = (c.city === activeCityName);

    const iconHtml = isSelected
      ? `
        <div style="
          display: flex;
          align-items: center;
          gap: 6px;
          background: #1E4620;
          border: 1px solid #153317;
          border-radius: 6px;
          padding: 3px 8px;
          color: #ffffff;
          font-size: 0.78rem;
          font-weight: 600;
          box-shadow: 0 1px 3px rgba(0,0,0,0.15);
          cursor: pointer;
          white-space: nowrap;
        ">
          <span style="width: 6px; height: 6px; border-radius: 50%; background: #ffffff;"></span>
          ${c.city}
        </div>
      `
      : `
        <div style="
          width: 10px;
          height: 10px;
          border-radius: 50%;
          background: #ffffff;
          border: 2px solid #1E4620;
          box-shadow: 0 1px 2px rgba(0,0,0,0.1);
          cursor: pointer;
        "></div>
      `;

    const customIcon = L.divIcon({
      html: iconHtml,
      className: "custom-city-pin",
      iconAnchor: isSelected ? [35, 12] : [5, 5],
    });

    const marker = L.marker(pos, { icon: customIcon });
    marker.bindTooltip(
      `<strong>${c.city}</strong><br>Threat Level: ${c.level} &bull; Arrival ETA: ~${c.eta_hours !== null ? c.eta_hours + "h" : "N/A"}`,
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

    // Primary vector is solid accent; secondary vectors are lighter
    const isPrimary = (idx === 0);
    const line = L.polyline([sPos, cPos], {
      color: isPrimary ? "#1E4620" : "#5F6368",
      weight: isPrimary ? 2.5 : 1.5,
      opacity: isPrimary ? 0.85 : 0.5,
      className: "animated-trajectory-line",
      dashArray: isPrimary ? "8, 6" : "4, 4",
    });

    line.bindTooltip(
      `
      <div style="font-size: 0.82rem; padding: 4px;">
        <strong style="color:#1E4620;">Upwind Smoke Plume #${idx + 1} ➔ ${cityData.city}</strong><br>
        Source: ${src.lat.toFixed(2)}°N, ${src.lon.toFixed(2)}°E &bull; FRP: <strong>${src.frp.toFixed(1)} MW</strong><br>
        Distance: <strong>${distKm.toFixed(0)} km</strong> &bull; ETA: <strong>~${Math.round(clusterEta)} hours</strong>
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
          color: ${isPrimary ? '#1E4620' : '#5F6368'};
          font-size: 1rem;
          font-weight: 700;
          line-height: 1;
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
        background: #1E4620;
        border: 2px solid #ffffff;
        border-radius: 50%;
        width: 18px;
        height: 18px;
        box-shadow: 0 2px 6px rgba(0,0,0,0.25);
      "></div>
    `,
    className: "custom-location-pin",
    iconSize: [18, 18],
    iconAnchor: [9, 9],
  });

  customLocationMarker = L.marker([lat, lng], { icon: customIcon }).addTo(map);

  const etaText = etaHours !== null ? `~${etaHours} hours` : "N/A (Upwind Clear)";
  const titleText = townName ? `${townName}` : `Custom Location Analyzer`;
  const windInfo = getWindFlowInfo(windFromNow);

  const popupHtml = `
    <div style="font-family: 'Instrument Sans', sans-serif; padding: 4px; min-width: 240px;">
      <div style="font-weight:600; color:#1E4620; font-size:0.9rem; margin-bottom:6px; border-bottom:1px solid #E8E6E1; padding-bottom:4px;">
        ${titleText}
      </div>
      <div style="font-size:0.82rem; line-height:1.5; color:#1A1A1A;">
        <strong>Coords:</strong> ${lat.toFixed(4)}°N, ${lng.toFixed(4)}°E<br>
        <strong>Upwind Fires (600km):</strong> <span style="color:#B91C1C; font-weight:600;">${totalUpwindFires} fires</span><br>
        <strong>Smoke Arrival (ETA):</strong> <strong style="color:#1E4620;">${etaText}</strong><br>
        <strong>Threat Level:</strong> <span class="level-badge ${level}" style="padding:2px 6px; font-size:0.72rem;">${level}</span><br>
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
      color: "#1E4620",
      weight: Math.max(1.5, 3 - idx * 0.5),
      dashArray: "6, 6",
      opacity: 0.85,
    });
    line.bindTooltip(
      `Upwind Cluster #${idx + 1} to Custom Pin<br>Dist: ${src.distKm.toFixed(1)} km &bull; FRP: ${src.frp.toFixed(1)} MW`,
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
          color: #1E4620;
          font-size: 1.1rem;
          font-weight: 700;
          line-height: 1;
          user-select: none;
        ">➔</div>
      `,
      className: "vector-flow-arrow-pin",
      iconSize: [16, 16],
      iconAnchor: [8, 8],
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

  const cities = (currentData.cities || []).filter(
    (c) => c.city !== "Delhi" && (c.city.includes("Delhi") || c.city.includes("NCR"))
  );
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
