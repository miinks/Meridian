const POLL_MS = 10_000;
const EMPTY = { type: "FeatureCollection", features: [] };
const ICAO = /^[a-f0-9]{6}$/i;

const state = {
  flights: new Map(),
  trails: new Map(),
  selectedId: null,
  following: false,
  airborneOnly: true,
  bbox: null,
  creditsRemaining: null,
  authenticated: false,
  retryAt: 0,
  quotaTimer: 0,
  paused: false,
  inflight: false,
  programmaticMove: false,
};

const ui = {
  search: document.getElementById("search"),
  results: document.getElementById("results"),
  status: document.getElementById("status"),
  statusLabel: document.getElementById("status-label"),
  statusMeta: document.getElementById("status-meta"),
  sheet: document.getElementById("sheet"),
  close: document.getElementById("close"),
  follow: document.getElementById("follow"),
  airborne: document.getElementById("airborne"),
  pause: document.getElementById("pause"),
  tip: document.getElementById("tip"),
};

function lerp(from, to, t) {
  return from + (to - from) * t;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
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

function formatWait(seconds) {
  const total = Math.max(0, Math.round(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  if (hours > 0) return minutes ? `${hours}h ${minutes}m` : `${hours}h`;
  if (minutes > 0) return minutes < 10 && secs ? `${minutes}m ${secs}s` : `${minutes}m`;
  return `${secs}s`;
}

function remainingWaitSeconds() {
  return Math.max(0, Math.ceil((state.retryAt - Date.now()) / 1000));
}

function syncPauseButton() {
  const paused = state.paused || remainingWaitSeconds() > 0;
  ui.pause.setAttribute("aria-pressed", paused ? "true" : "false");
  ui.pause.textContent = paused ? "Resume" : "Pause";
}

function canRequest() {
  return !state.paused && remainingWaitSeconds() <= 0;
}

function setPaused(paused) {
  state.paused = paused;
  syncPauseButton();
  if (paused) {
    if (!showQuotaWait()) {
      setStatus("idle", "Requests paused", "OpenSky calls stopped");
    }
    return;
  }
  if (showQuotaWait()) return;
  refresh(map);
}

function showQuotaWait() {
  const wait = remainingWaitSeconds();
  if (wait <= 0) {
    syncPauseButton();
    return false;
  }
  const until = new Date(state.retryAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  setStatus("error", "OpenSky quota reached", `Try again in ${formatWait(wait)} · ${until}`);
  syncPauseButton();
  return true;
}

function armQuotaWait(seconds) {
  const retry = Number(seconds);
  state.retryAt = Date.now() + Math.max(1, Number.isFinite(retry) && retry > 0 ? retry : 60) * 1000;
  state.paused = true;
  showQuotaWait();
  if (state.quotaTimer) clearInterval(state.quotaTimer);
  state.quotaTimer = setInterval(() => {
    if (showQuotaWait()) return;
    clearInterval(state.quotaTimer);
    state.quotaTimer = 0;
    setStatus("idle", "Requests paused", "Click Resume to poll OpenSky");
    syncPauseButton();
  }, 1000);
}

function readRetryAfter(response, payload) {
  const header = Number(response.headers.get("X-Rate-Limit-Retry-After-Seconds") || response.headers.get("Retry-After"));
  const body = Number(payload?.retryAfterSeconds);
  if (Number.isFinite(header) && header > 0) return header;
  if (Number.isFinite(body) && body > 0) return body;
  return 60;
}

function creditMeta() {
  const source = state.authenticated ? "OpenSky signed in" : "OpenSky anonymous";
  if (state.creditsRemaining == null) return source;
  return `${source} · ${state.creditsRemaining.toLocaleString()} credits`;
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

function aroundFlight(flight, deg = 1.1) {
  return {
    south: Math.max(-90, flight.latitude - deg),
    west: Math.max(-180, flight.longitude - deg),
    north: Math.min(90, flight.latitude + deg),
    east: Math.min(180, flight.longitude + deg),
  };
}

function visibleFlights() {
  const rows = [...state.flights.values()];
  if (!state.airborneOnly) return rows;
  return rows.filter((flight) => !flight.onGround || flight.id === state.selectedId);
}

function matchesQuery(flight, needle) {
  return flight.callsign.toLowerCase().includes(needle) || flight.id.toLowerCase().includes(needle);
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

function syncFollowButton() {
  ui.follow.setAttribute("aria-pressed", state.following ? "true" : "false");
  ui.follow.textContent = state.following ? "Following" : "Follow";
}

function syncUrl() {
  const url = new URL(location.href);
  if (state.selectedId) url.searchParams.set("icao", state.selectedId);
  else url.searchParams.delete("icao");
  history.replaceState(null, "", url);
}

function sheetOffset() {
  return window.matchMedia("(max-width: 820px)").matches ? [0, -70] : [160, 0];
}

function renderSheet(flight) {
  if (!flight && !state.selectedId) {
    ui.sheet.hidden = true;
    document.title = "Meridian";
    return;
  }

  const callsign = flight?.callsign || state.selectedId?.toUpperCase() || "Flight";
  const facts = flight
    ? [
        ["Altitude", formatAltitude(flight.altitudeM, flight.onGround)],
        ["Speed", formatSpeed(flight.speedMs)],
        ["Heading", formatHeading(flight.heading)],
        ["Vertical", formatVerticalRate(flight.verticalRateMs, flight.onGround)],
        ["Squawk", flight.squawk || "—"],
        ["Country", flight.country],
      ]
    : [
        ["Altitude", "Locating…"],
        ["Speed", "—"],
        ["Heading", "—"],
        ["Vertical", "—"],
        ["Squawk", "—"],
        ["Country", "—"],
      ];

  document.getElementById("sheet-eyebrow").textContent = state.following
    ? "Tracking"
    : flight?.onGround
      ? "On the ground"
      : flight
        ? "In flight"
        : "Looking up";
  document.getElementById("sheet-callsign").textContent = callsign;
  document.getElementById("sheet-icao").textContent = (flight?.id || state.selectedId || "").toUpperCase();
  document.getElementById("sheet-facts").innerHTML = facts
    .map(([label, value]) => `<div><dt>${label}</dt><dd>${value}</dd></div>`)
    .join("");
  ui.sheet.hidden = false;
  document.title = `${callsign} · Meridian`;
  syncFollowButton();
}

function selectFlight(id, map, { fly = false, follow = false } = {}) {
  state.selectedId = id;
  if (!id) state.following = false;
  else if (follow) state.following = true;

  const flight = id ? state.flights.get(id) : null;
  renderSheet(flight);
  syncUrl();

  if (map.getLayer("flights")) {
    map.setLayoutProperty("flights", "icon-image", selectedExpression(id, "plane-selected", "plane"));
    map.setLayoutProperty("flights", "icon-size", selectedExpression(id, 0.95, 0.62));
  }

  if (fly && flight) {
    state.programmaticMove = true;
    map.easeTo({
      center: [flight.longitude, flight.latitude],
      zoom: Math.max(map.getZoom(), 8.5),
      duration: 900,
      offset: sheetOffset(),
    });
  }
}

function renderResults(query, extra = []) {
  const needle = query.trim().toLowerCase();
  if (needle.length < 2 && extra.length === 0) {
    ui.results.hidden = true;
    ui.results.innerHTML = "";
    return;
  }

  const matches = needle.length < 2 ? [] : visibleFlights().filter((flight) => matchesQuery(flight, needle)).slice(0, 6);
  const items = [
    ...matches.map(
      (flight) => `
        <li>
          <button type="button" data-id="${escapeHtml(flight.id)}">
            <strong>${escapeHtml(flight.callsign)}</strong>
            <span>${escapeHtml(flight.country || "")}</span>
          </button>
        </li>`,
    ),
    ...extra,
  ];

  if (needle.length >= 3) {
    items.push(`
      <li>
        <button type="button" class="worldwide" data-worldwide="1">
          Search worldwide for ${escapeHtml(query.trim())}
        </button>
      </li>`);
  }

  ui.results.innerHTML = items.join("");
  ui.results.hidden = items.length === 0;
}

async function fetchFlights({ bbox, icao24, worldwide } = {}) {
  if (!canRequest()) {
    const error = new Error("paused");
    error.code = "paused";
    throw error;
  }
  const params = new URLSearchParams();
  if (icao24) params.set("icao24", icao24.toLowerCase());
  else if (bbox && !worldwide) {
    params.set("lamin", String(bbox.south));
    params.set("lomin", String(bbox.west));
    params.set("lamax", String(bbox.north));
    params.set("lomax", String(bbox.east));
  }

  const query = params.toString();
  const response = await fetch(`/api/opensky/states/all${query ? `?${query}` : ""}`);
  const remaining = response.headers.get("X-Rate-Limit-Remaining");
  if (remaining != null && remaining !== "") state.creditsRemaining = Number(remaining);

  const raw = await response.text();
  let payload = null;
  try {
    payload = raw ? JSON.parse(raw) : null;
  } catch {
    payload = null;
  }

  if (response.status === 429) {
    armQuotaWait(readRetryAfter(response, payload));
    throw new Error("quota");
  }
  if (!response.ok) throw new Error(`OpenSky returned ${response.status}`);
  return (payload?.states || []).map(parseFlight).filter(Boolean);
}

function ingest(next, { replace = true } = {}) {
  const now = Date.now();
  const nextMap = replace ? new Map() : new Map(state.flights);
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
  return now;
}

function followCamera(map, flight) {
  if (!state.following || !flight) return;
  state.programmaticMove = true;
  map.easeTo({
    center: [flight.longitude, flight.latitude],
    duration: Math.min(POLL_MS, 8000),
    easing: (t) => t,
    offset: sheetOffset(),
    essential: true,
  });
}

async function refresh(map, { silent = false } = {}) {
  if (state.inflight || !state.bbox) return;
  if (document.hidden) return;
  if (showQuotaWait()) return;
  if (state.paused) {
    setStatus("idle", "Requests paused", "OpenSky calls stopped");
    syncPauseButton();
    return;
  }

  const selected = state.selectedId ? state.flights.get(state.selectedId) : null;
  if (!silent && state.flights.size === 0) {
    setStatus("loading", state.selectedId ? `Locating ${state.selectedId.toUpperCase()}` : "Listening for traffic", creditMeta());
  }

  state.inflight = true;
  try {
    let next;
    if (state.following && selected) next = await fetchFlights({ bbox: aroundFlight(selected) });
    else if (state.selectedId && !selected) next = await fetchFlights({ icao24: state.selectedId });
    else next = await fetchFlights({ bbox: state.bbox });

    if (state.following && state.selectedId && !next.some((flight) => flight.id === state.selectedId)) {
      const exact = await fetchFlights({ icao24: state.selectedId });
      if (exact.length) next = [...exact, ...next.filter((flight) => flight.id !== state.selectedId)];
    }

    const now = ingest(next);
    const tracked = state.selectedId ? state.flights.get(state.selectedId) : null;
    const airborne = next.filter((flight) => !flight.onGround).length;

    if (state.selectedId && !tracked) {
      setStatus("error", "Not transmitting", creditMeta());
    } else if (state.following && tracked) {
      setStatus("live", `Tracking ${tracked.callsign}`, creditMeta());
      followCamera(map, tracked);
    } else {
      setStatus(
        "live",
        `${airborne.toLocaleString()} airborne`,
        `Updated ${new Date(now).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })} · ${creditMeta()}`,
      );
    }

    renderSheet(tracked || null);
    renderResults(ui.search.value);
  } catch (error) {
    if (error.code === "paused" || showQuotaWait() || state.paused) return;
    setStatus("error", "Signal lost", error.message);
  } finally {
    state.inflight = false;
  }
}

async function searchWorldwide(map, query) {
  const needle = query.trim().toLowerCase();
  if (needle.length < 2 || state.inflight) return;
  if (showQuotaWait() || state.paused) return;

  setStatus("loading", ICAO.test(needle) ? "Looking up ICAO" : "Scanning worldwide", "Uses extra OpenSky credits");
  ui.results.hidden = true;
  state.inflight = true;
  let foundOne = false;

  try {
    const next = ICAO.test(needle)
      ? await fetchFlights({ icao24: needle })
      : await fetchFlights({ worldwide: true });
    const matches = next.filter((flight) => matchesQuery(flight, needle));

    if (matches.length === 1) {
      ingest(matches, { replace: false });
      selectFlight(matches[0].id, map, { fly: true, follow: true });
      ui.search.value = "";
      renderResults("");
      foundOne = true;
    } else if (matches.length > 0) {
      ingest(matches, { replace: false });
      renderResults(query);
      setStatus("live", `${matches.length} matches worldwide`, creditMeta());
    } else {
      renderResults(query, [
        `<li><button type="button" disabled>No live match for ${escapeHtml(query.trim())}</button></li>`,
      ]);
      setStatus("error", "Not transmitting", creditMeta());
    }
  } catch (error) {
    if (error.code === "paused" || showQuotaWait() || state.paused) return;
    setStatus("error", "Search failed", error.message);
  } finally {
    state.inflight = false;
  }

  if (foundOne) await refresh(map, { silent: true });
}

function paintFlights(map) {
  const source = map.getSource("flights");
  const trailSource = map.getSource("trails");
  if (!source) return;

  const now = Date.now();
  const features = visibleFlights().map((flight) => {
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

function hideTip() {
  ui.tip.hidden = true;
}

function showTip(event) {
  const callsign = event.features?.[0]?.properties?.callsign;
  if (!callsign) return hideTip();
  ui.tip.hidden = false;
  ui.tip.textContent = callsign;
  ui.tip.style.left = `${event.point.x}px`;
  ui.tip.style.top = `${event.point.y}px`;
}

const map = new maplibregl.Map({
  container: "map",
  style: "https://tiles.openfreemap.org/styles/dark",
  center: [-73.95, 40.74],
  zoom: 7.2,
  attributionControl: { compact: true },
});

map.on("load", async () => {
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

  try {
    const status = await fetch("/api/status").then((response) => response.json());
    state.authenticated = Boolean(status.authenticated);
  } catch {
    state.authenticated = false;
  }

  state.bbox = boundsToBBox(map);
  const bootIcao = new URLSearchParams(location.search).get("icao");
  if (bootIcao) {
    selectFlight(bootIcao.toLowerCase(), map, { follow: true });
    renderSheet(null);
  }
  refresh(map);
  setInterval(() => refresh(map), POLL_MS);
  requestAnimationFrame(function tick() {
    paintFlights(map);
    requestAnimationFrame(tick);
  });
});

let moveTimer;
map.on("moveend", () => {
  if (state.programmaticMove) {
    state.programmaticMove = false;
    return;
  }
  if (state.following) return;
  clearTimeout(moveTimer);
  moveTimer = setTimeout(() => {
    state.bbox = boundsToBBox(map);
    refresh(map);
  }, 1600);
});

map.on("dragstart", () => {
  if (!state.following) return;
  state.following = false;
  syncFollowButton();
  const flight = state.selectedId ? state.flights.get(state.selectedId) : null;
  renderSheet(flight || null);
});

map.on("click", "flights", (event) => {
  const id = event.features?.[0]?.properties?.id;
  if (id) selectFlight(id, map, { follow: true, fly: true });
});

map.on("click", (event) => {
  const hits = map.queryRenderedFeatures(event.point, { layers: ["flights"] });
  if (hits.length === 0) {
    const wasTracking = Boolean(state.selectedId);
    selectFlight(null, map);
    if (wasTracking) {
      state.bbox = boundsToBBox(map);
      refresh(map);
    }
  }
});

map.on("mouseenter", "flights", () => {
  map.getCanvas().style.cursor = "pointer";
});
map.on("mousemove", "flights", showTip);
map.on("mouseleave", "flights", () => {
  map.getCanvas().style.cursor = "";
  hideTip();
});

ui.search.addEventListener("input", () => renderResults(ui.search.value));
ui.search.addEventListener("keydown", (event) => {
  if (event.key !== "Enter") return;
  event.preventDefault();
  const needle = ui.search.value.trim().toLowerCase();
  const matches = visibleFlights().filter((flight) => matchesQuery(flight, needle));
  if (matches.length === 1) {
    selectFlight(matches[0].id, map, { fly: true, follow: true });
    ui.search.value = "";
    renderResults("");
    return;
  }
  searchWorldwide(map, ui.search.value);
});

ui.results.addEventListener("click", (event) => {
  const worldwide = event.target.closest("button[data-worldwide]");
  if (worldwide) {
    searchWorldwide(map, ui.search.value);
    return;
  }
  const button = event.target.closest("button[data-id]");
  if (!button) return;
  selectFlight(button.dataset.id, map, { fly: true, follow: true });
  ui.search.value = "";
  renderResults("");
});

ui.close.addEventListener("click", () => {
  selectFlight(null, map);
  state.bbox = boundsToBBox(map);
  refresh(map);
});
ui.follow.addEventListener("click", () => {
  if (!state.selectedId) return;
  state.following = !state.following;
  const flight = state.flights.get(state.selectedId);
  renderSheet(flight || null);
  if (state.following && flight) {
    selectFlight(state.selectedId, map, { fly: true, follow: true });
    refresh(map, { silent: true });
  }
});

ui.airborne.addEventListener("click", () => {
  state.airborneOnly = !state.airborneOnly;
  ui.airborne.setAttribute("aria-pressed", state.airborneOnly ? "true" : "false");
  renderResults(ui.search.value);
});

ui.pause.addEventListener("click", () => {
  if (remainingWaitSeconds() > 0) {
    showQuotaWait();
    return;
  }
  setPaused(!state.paused);
});

document.addEventListener("visibilitychange", () => {
  if (!document.hidden) refresh(map);
});
