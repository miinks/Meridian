const POLL_MS = 10_000;
const EMPTY = { type: "FeatureCollection", features: [] };

const state = {
  flights: new Map(),
  trails: new Map(),
  selectedId: null,
  bbox: null,
};

const ui = {
  search: document.getElementById("search"),
  results: document.getElementById("results"),
  status: document.getElementById("status"),
  statusLabel: document.getElementById("status-label"),
  statusMeta: document.getElementById("status-meta"),
  sheet: document.getElementById("sheet"),
  close: document.getElementById("close"),
};

function lerp(from, to, t) {
  return from + (to - from) * t;
}

function formatAltitude(meters, onGround) {
  if (onGround) return "On ground";
  if (meters == null) return "—";
  return `${Math.round(meters * 3.28084).toLocaleString()} ft`;
}

function formatSpeed(metersPerSecond) {
  if (metersPerSecond == null) return "—";
  return `${Math.round(metersPerSecond * 1.94384)} kt`;
}

function formatHeading(degrees) {
  return `${Math.round((degrees + 360) % 360)
    .toString()
    .padStart(3, "0")}°`;
}

function formatVerticalRate(metersPerSecond, onGround) {
  if (onGround || metersPerSecond == null) return "Level";
  const fpm = Math.round(metersPerSecond * 196.85);
  if (Math.abs(fpm) < 80) return "Level";
  return `${fpm > 0 ? "+" : ""}${fpm.toLocaleString()} fpm`;
}

function setStatus(kind, label, meta) {
  ui.status.dataset.state = kind;
  ui.statusLabel.textContent = label;
  ui.statusMeta.textContent = meta;
}

function parseFlight(row) {
  const [id, rawCallsign, country, , , lon, lat, altitude, onGround, speed, heading, verticalRate, , , squawk] = row;
  if (lon == null || lat == null) return null;
  return {
    id,
    callsign: (rawCallsign || "").trim() || id.toUpperCase(),
    country,
    longitude: lon,
    latitude: lat,
    altitudeM: altitude,
    onGround,
    speedMs: speed,
    heading: heading ?? 0,
    verticalRateMs: verticalRate,
    squawk,
  };
}

function boundsToBBox(map) {
  const bounds = map.getBounds();
  const padLng = (bounds.getEast() - bounds.getWest()) * 0.12;
  const padLat = (bounds.getNorth() - bounds.getSouth()) * 0.12;
  return {
    south: Math.max(-90, bounds.getSouth() - padLat),
    west: Math.max(-180, bounds.getWest() - padLng),
    north: Math.min(90, bounds.getNorth() + padLat),
    east: Math.min(180, bounds.getEast() + padLng),
  };
}

async function fetchFlights(bbox) {
  const params = new URLSearchParams({
    lamin: String(bbox.south),
    lomin: String(bbox.west),
    lamax: String(bbox.north),
    lomax: String(bbox.east),
  });
  const response = await fetch(`/api/opensky/states/all?${params}`);
  if (response.status === 429) {
    throw new Error("OpenSky is rate-limiting this IP. Wait about 10 seconds.");
  }
  if (!response.ok) throw new Error(`OpenSky returned ${response.status}`);
  const payload = await response.json();
  return (payload.states || []).map(parseFlight).filter(Boolean);
}

function rememberTrail(flight) {
  const trail = state.trails.get(flight.id) || [];
  const last = trail[trail.length - 1];
  if (!last || last[0] !== flight.longitude || last[1] !== flight.latitude) {
    trail.push([flight.longitude, flight.latitude]);
    state.trails.set(flight.id, trail.slice(-40));
  }
}

function drawAircraftIcon(map, id, fill, glow = false) {
  const size = 56;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  ctx.translate(size / 2, size / 2);
  if (glow) {
    ctx.shadowColor = fill;
    ctx.shadowBlur = 14;
  }
  ctx.beginPath();
  ctx.moveTo(0, -15);
  ctx.lineTo(4, -4);
  ctx.lineTo(13, 1);
  ctx.lineTo(4, -1);
  ctx.lineTo(2, 10);
  ctx.lineTo(6, 13);
  ctx.lineTo(0, 11);
  ctx.lineTo(-6, 13);
  ctx.lineTo(-2, 10);
  ctx.lineTo(-4, -1);
  ctx.lineTo(-13, 1);
  ctx.lineTo(-4, -4);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  if (map.hasImage(id)) map.removeImage(id);
  map.addImage(id, ctx.getImageData(0, 0, size, size), { pixelRatio: 2 });
}

function selectedExpression(selectedId, selectedValue, fallback) {
  return ["case", ["==", ["get", "id"], selectedId || ""], selectedValue, fallback];
}

function renderSheet(flight) {
  if (!flight) {
    ui.sheet.hidden = true;
    return;
  }

  const facts = [
    ["Altitude", formatAltitude(flight.altitudeM, flight.onGround)],
    ["Speed", formatSpeed(flight.speedMs)],
    ["Heading", formatHeading(flight.heading)],
    ["Vertical", formatVerticalRate(flight.verticalRateMs, flight.onGround)],
    ["Squawk", flight.squawk || "—"],
    ["Country", flight.country],
  ];

  document.getElementById("sheet-eyebrow").textContent = flight.onGround ? "On the ground" : "In flight";
  document.getElementById("sheet-callsign").textContent = flight.callsign;
  document.getElementById("sheet-icao").textContent = flight.id.toUpperCase();
  document.getElementById("sheet-facts").innerHTML = facts
    .map(([label, value]) => `<div><dt>${label}</dt><dd>${value}</dd></div>`)
    .join("");
  ui.sheet.hidden = false;
}

function selectFlight(id, map, { fly = false } = {}) {
  state.selectedId = id;
  const flight = id ? state.flights.get(id) : null;
  renderSheet(flight);

  if (map.getLayer("flights")) {
    map.setLayoutProperty("flights", "icon-image", selectedExpression(id, "plane-selected", "plane"));
    map.setLayoutProperty("flights", "icon-size", selectedExpression(id, 0.95, 0.62));
  }

  if (fly && flight) {
    map.easeTo({
      center: [flight.longitude, flight.latitude],
      zoom: Math.max(map.getZoom(), 8.5),
      duration: 900,
      offset: [160, 0],
    });
  }
}

function renderResults(query) {
  const needle = query.trim().toLowerCase();
  if (needle.length < 2) {
    ui.results.hidden = true;
    ui.results.innerHTML = "";
    return;
  }

  const matches = [...state.flights.values()]
    .filter((flight) => flight.callsign.toLowerCase().includes(needle) || flight.id.includes(needle))
    .slice(0, 6);

  ui.results.innerHTML = matches
    .map(
      (flight) => `
        <li>
          <button type="button" data-id="${flight.id}">
            <strong>${flight.callsign}</strong>
            <span>${flight.country}</span>
          </button>
        </li>`,
    )
    .join("");
  ui.results.hidden = matches.length === 0;
}

function paintFlights(map) {
  const source = map.getSource("flights");
  const trailSource = map.getSource("trails");
  if (!source) return;

  const now = Date.now();
  const features = [...state.flights.values()].map((flight) => {
    const t = Math.min(1, (now - flight.receivedAt) / POLL_MS);
    const eased = t * t * (3 - 2 * t);
    return {
      type: "Feature",
      properties: {
        id: flight.id,
        callsign: flight.callsign,
        heading: flight.heading,
        onGround: flight.onGround,
      },
      geometry: {
        type: "Point",
        coordinates: [
          lerp(flight.prevLongitude, flight.longitude, eased),
          lerp(flight.prevLatitude, flight.latitude, eased),
        ],
      },
    };
  });
  source.setData({ type: "FeatureCollection", features });

  const trail = state.selectedId ? state.trails.get(state.selectedId) || [] : [];
  trailSource.setData({
    type: "FeatureCollection",
    features:
      trail.length > 1
        ? [
            {
              type: "Feature",
              properties: {},
              geometry: { type: "LineString", coordinates: trail },
            },
          ]
        : [],
  });
}

async function refresh(map) {
  if (!state.bbox) return;
  if (state.flights.size === 0) setStatus("loading", "Listening for traffic", "OpenSky live positions");

  try {
    const next = await fetchFlights(state.bbox);
    const now = Date.now();
    const nextMap = new Map();

    for (const flight of next) {
      const previous = state.flights.get(flight.id);
      nextMap.set(flight.id, {
        ...flight,
        prevLongitude: previous?.longitude ?? flight.longitude,
        prevLatitude: previous?.latitude ?? flight.latitude,
        receivedAt: now,
      });
      rememberTrail(flight);
    }

    state.flights = nextMap;
    const airborne = next.filter((flight) => !flight.onGround).length;
    setStatus(
      "live",
      `${airborne.toLocaleString()} airborne`,
      `Updated ${new Date(now).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}`,
    );
    renderSheet(state.selectedId ? state.flights.get(state.selectedId) : null);
    renderResults(ui.search.value);
  } catch (error) {
    setStatus("error", "Signal lost", error.message);
  }
}

const map = new maplibregl.Map({
  container: "map",
  style: "https://tiles.openfreemap.org/styles/dark",
  center: [-73.95, 40.74],
  zoom: 7.2,
  attributionControl: { compact: true },
});

map.on("load", () => {
  drawAircraftIcon(map, "plane", "#d7dde6");
  drawAircraftIcon(map, "plane-selected", "#e8c17a", true);

  map.addSource("trails", { type: "geojson", data: EMPTY });
  map.addSource("flights", { type: "geojson", data: EMPTY });

  map.addLayer({
    id: "trails",
    type: "line",
    source: "trails",
    paint: {
      "line-color": "#e8c17a",
      "line-width": 1.4,
      "line-opacity": 0.45,
    },
  });

  map.addLayer({
    id: "flights",
    type: "symbol",
    source: "flights",
    layout: {
      "icon-image": "plane",
      "icon-rotate": ["get", "heading"],
      "icon-rotation-alignment": "map",
      "icon-allow-overlap": true,
      "icon-ignore-placement": true,
      "icon-size": 0.62,
    },
    paint: {
      "icon-opacity": ["case", ["get", "onGround"], 0.28, 0.92],
    },
  });

  state.bbox = boundsToBBox(map);
  refresh(map);
  setInterval(() => refresh(map), POLL_MS);
  requestAnimationFrame(function tick() {
    paintFlights(map);
    requestAnimationFrame(tick);
  });
});

let moveTimer;
map.on("moveend", () => {
  clearTimeout(moveTimer);
  moveTimer = setTimeout(() => {
    state.bbox = boundsToBBox(map);
    refresh(map);
  }, 700);
});

map.on("click", "flights", (event) => {
  const id = event.features?.[0]?.properties?.id;
  if (id) selectFlight(id, map);
});

map.on("click", (event) => {
  const hits = map.queryRenderedFeatures(event.point, { layers: ["flights"] });
  if (hits.length === 0) selectFlight(null, map);
});

map.on("mouseenter", "flights", () => {
  map.getCanvas().style.cursor = "pointer";
});
map.on("mouseleave", "flights", () => {
  map.getCanvas().style.cursor = "";
});

ui.search.addEventListener("input", () => renderResults(ui.search.value));
ui.results.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-id]");
  if (!button) return;
  selectFlight(button.dataset.id, map, { fly: true });
  ui.search.value = "";
  renderResults("");
});
ui.close.addEventListener("click", () => selectFlight(null, map));
