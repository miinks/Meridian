import {
  POLL_MS,
  ICAO,
  EMPTY,
  lerp,
  formatAltitude,
  formatSpeed,
  formatHeading,
  formatVerticalRate,
  formatWait,
  parseFlight,
  boundsToBBox,
  aroundFlight,
  matchesQuery,
  airlineFromCallsign,
  matchesAirport,
  rankAirport,
  distanceKm,
  formatDistance,
  airportKindLabel,
  greatCircle,
  splitAntimeridian,
  routeFacts,
} from "./format.js";
import { highlightAirport, iconImageExpression, iconSizeExpression, AIRPORT_CLICK_LAYERS } from "./map.js";
import { formatAircraft, iconFromTypecode } from "./identity.js";
import { formatMetarSummary, isImportantAirport, METAR_MS, metarFacts } from "./weather.js";

const noop = () => {};

/**
 * Owns all imperative flight-tracking behaviour (map, polling, quota timers,
 * search, follow mode). React supplies callbacks so the HUD / sheet / results
 * can re-render from plain data instead of direct DOM writes.
 */
export class MeridianController {
  constructor(map, callbacks = {}) {
    this.map = map;
    this.cb = {
      onStatus: noop,
      onSheet: noop,
      onResults: noop,
      onPaused: noop,
      onTip: noop,
      onSearchValue: noop,
      ...callbacks,
    };

    this.flights = new Map();
    this.trails = new Map();
    this.selectedId = null;
    this.following = false;
    this.airborneOnly = true;
    this.bbox = null;
    this.creditsRemaining = null;
    this.authenticated = false;
    this.retryAt = 0;
    this.quotaTimer = 0;
    this.pollTimer = 0;
    this.rafId = 0;
    this.paused = false;
    this.inflight = false;
    this.airports = [];
    this.airlines = {};
    this.runways = new Map();
    this.selectedAirport = null;
    this.programmaticMove = false;
    this.searchValue = "";
    this.aircraftCache = new Map();
    this.routeCache = new Map();
    this.metar = new Map();
    this.metarLoaded = false;
    this.metarInflight = false;
    this.metarTimer = 0;
  }

  // ---- quota + pause -------------------------------------------------------

  remainingWaitSeconds() {
    return Math.max(0, Math.ceil((this.retryAt - Date.now()) / 1000));
  }

  syncPauseButton() {
    const paused = this.paused || this.remainingWaitSeconds() > 0;
    this.cb.onPaused(paused);
  }

  canRequest() {
    return !this.paused && this.remainingWaitSeconds() <= 0;
  }

  setPaused(paused) {
    this.paused = paused;
    this.syncPauseButton();
    if (paused) {
      if (!this.showQuotaWait()) {
        this.setStatus("idle", "Requests paused", "OpenSky calls stopped");
      }
      return;
    }
    if (this.showQuotaWait()) return;
    this.refresh();
  }

  togglePause() {
    if (this.remainingWaitSeconds() > 0) {
      this.showQuotaWait();
      return;
    }
    this.setPaused(!this.paused);
  }

  showQuotaWait() {
    const wait = this.remainingWaitSeconds();
    if (wait <= 0) {
      this.syncPauseButton();
      return false;
    }
    const until = new Date(this.retryAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    this.setStatus("error", "OpenSky quota reached", `Try again in ${formatWait(wait)} · ${until}`);
    this.syncPauseButton();
    return true;
  }

  armQuotaWait(seconds) {
    const retry = Number(seconds);
    this.retryAt = Date.now() + Math.max(1, Number.isFinite(retry) && retry > 0 ? retry : 60) * 1000;
    this.paused = true;
    this.showQuotaWait();
    if (this.quotaTimer) clearInterval(this.quotaTimer);
    this.quotaTimer = setInterval(() => {
      if (this.showQuotaWait()) return;
      clearInterval(this.quotaTimer);
      this.quotaTimer = 0;
      this.setStatus("idle", "Requests paused", "Click Resume to poll OpenSky");
      this.syncPauseButton();
    }, 1000);
  }

  readRetryAfter(response, payload) {
    const header = Number(
      response.headers.get("X-Rate-Limit-Retry-After-Seconds") || response.headers.get("Retry-After"),
    );
    const body = Number(payload?.retryAfterSeconds);
    if (Number.isFinite(header) && header > 0) return header;
    if (Number.isFinite(body) && body > 0) return body;
    return 60;
  }

  // ---- status --------------------------------------------------------------

  creditMeta() {
    const source = this.authenticated ? "OpenSky signed in" : "OpenSky anonymous";
    if (this.creditsRemaining == null) return source;
    return `${source} · ${this.creditsRemaining.toLocaleString()} credits`;
  }

  setStatus(kind, label, meta) {
    this.cb.onStatus({ kind, label, meta });
  }

  // ---- flight collections --------------------------------------------------

  visibleFlights() {
    const rows = [...this.flights.values()];
    if (!this.airborneOnly) return rows;
    return rows.filter((flight) => !flight.onGround || flight.id === this.selectedId);
  }

  rememberTrail(flight) {
    const trail = this.trails.get(flight.id) || [];
    const last = trail[trail.length - 1];
    if (!last || last[0] !== flight.longitude || last[1] !== flight.latitude) {
      trail.push([flight.longitude, flight.latitude]);
      this.trails.set(flight.id, trail.slice(-40));
    }
  }

  ingest(next, { replace = true } = {}) {
    const now = Date.now();
    const nextMap = replace ? new Map() : new Map(this.flights);
    for (const flight of next) {
      const previous = this.flights.get(flight.id);
      nextMap.set(flight.id, {
        ...flight,
        category: flight.category || previous?.category || 0,
        prevLongitude: previous?.longitude ?? flight.longitude,
        prevLatitude: previous?.latitude ?? flight.latitude,
        receivedAt: now,
      });
      this.rememberTrail(flight);
    }
    this.flights = nextMap;
    return now;
  }

  // ---- selection + sheet ---------------------------------------------------

  syncUrl() {
    const url = new URL(location.href);
    if (this.selectedId) url.searchParams.set("icao", this.selectedId);
    else url.searchParams.delete("icao");
    history.replaceState(null, "", url);
  }

  sheetOffset() {
    return window.matchMedia("(max-width: 820px)").matches ? [0, -70] : [160, 0];
  }

  nearbyForAirport(airport) {
    const groundKm = airport.type === "L" ? 8 : airport.type === "M" ? 5 : 3.5;
    const airKm = airport.type === "L" ? 45 : airport.type === "M" ? 28 : 16;
    const nearby = [];
    for (const flight of this.flights.values()) {
      const km = distanceKm(airport.latitude, airport.longitude, flight.latitude, flight.longitude);
      if (flight.onGround && km <= groundKm) nearby.push({ flight, km, where: "ground" });
      else if (!flight.onGround && km <= airKm) nearby.push({ flight, km, where: "air" });
    }
    nearby.sort((left, right) => left.km - right.km);
    return nearby;
  }

  renderAirportSheet() {
    const airport = this.selectedAirport;
    if (!airport) return;
    const nearby = this.nearbyForAirport(airport);
    const onGround = nearby.filter((item) => item.where === "ground");
    const airborne = nearby.filter((item) => item.where === "air");
    const listed = [...onGround.slice(0, 4), ...airborne.slice(0, 4)];
    const code = airport.iata || airport.ident;
    const pairs = this.runways.get(airport.ident) || [];
    const metar = this.metar.get(airport.ident);
    const facts = [
      ["ICAO", airport.ident],
      ["IATA", airport.iata || "—"],
      ["Type", airportKindLabel(airport.type)],
    ];
    if (metar || isImportantAirport(airport, this.runways)) {
      facts.push(...metarFacts(metar, { loaded: this.metarLoaded }));
    }
    if (pairs.length) facts.push(["Runways", pairs.join(" · ")]);
    facts.push(["Nearby", `${airborne.length} airborne · ${onGround.length} on ground`]);
    this.cb.onSheet({
      kind: "airport",
      eyebrow: "Airport",
      callsign: code,
      airline: airport.name,
      icao: airport.ident,
      facts,
      nearby: listed.map(({ flight, km, where }) => ({
        id: flight.id,
        callsign: flight.callsign,
        detail: `${where === "ground" ? "On ground" : formatAltitude(flight.altitudeM, false)} · ${formatDistance(km)}`,
      })),
      following: false,
    });
    document.title = `${code} · ${airport.name} · Meridian`;
  }

  renderSheet(flight) {
    if (!flight && !this.selectedId) {
      if (this.selectedAirport) {
        this.renderAirportSheet();
        return;
      }
      this.cb.onSheet(null);
      document.title = "Meridian";
      return;
    }

    const callsign = flight?.callsign || this.selectedId?.toUpperCase() || "Flight";
    const info = flight
      ? this.aircraftCache.get(flight.id) || {
          model: flight.model,
          typecode: flight.typecode,
          manufacturer: flight.manufacturer,
          operator: flight.airlineName,
        }
      : undefined;
    const airline = flight?.airlineName || this.airlineName(callsign) || info?.operator || "";
    const route = flight ? this.routeFor(flight) : undefined;
    const facts = flight
      ? [
          ["Flight", flight.airlineFlight || flight.callsign],
          ["Aircraft", formatAircraft(info, flight.category)],
          ...routeFacts(flight, route),
          ["Altitude", formatAltitude(flight.altitudeM, flight.onGround)],
          ["Speed", formatSpeed(flight.speedMs)],
          ["Heading", formatHeading(flight.heading)],
          ["Vertical", formatVerticalRate(flight.verticalRateMs, flight.onGround)],
          ["Squawk", flight.squawk || "—"],
          ["Country", flight.country],
        ]
      : [
          ["Flight", "—"],
          ["Aircraft", "Locating…"],
          ...routeFacts(null, undefined),
          ["Altitude", "Locating…"],
          ["Speed", "—"],
          ["Heading", "—"],
          ["Vertical", "—"],
          ["Squawk", "—"],
          ["Country", "—"],
        ];

    const eyebrow = this.following
      ? "Tracking"
      : flight?.onGround
        ? "On the ground"
        : flight
          ? "In flight"
          : "Looking up";

    this.cb.onSheet({
      kind: "flight",
      eyebrow,
      callsign,
      airline,
      icao: (flight?.id || this.selectedId || "").toUpperCase(),
      facts,
      following: this.following,
    });
    document.title = airline ? `${callsign} · ${airline} · Meridian` : `${callsign} · Meridian`;
  }

  selectFlight(id, { fly = false, follow = false } = {}) {
    this.selectedId = id;
    if (id) {
      this.selectedAirport = null;
      highlightAirport(this.map, null);
    }
    if (!id) this.following = false;
    else if (follow) this.following = true;

    const flight = id ? this.flights.get(id) : null;
    if (id) this.lookupAircraft(id);
    if (flight) this.lookupRoute(flight);
    this.renderSheet(flight);
    this.syncUrl();

    if (this.map.getLayer("flights")) {
      this.map.setLayoutProperty("flights", "icon-image", iconImageExpression(id));
      this.map.setLayoutProperty("flights", "icon-size", iconSizeExpression(id));
    }

    if (fly && flight) {
      this.programmaticMove = true;
      this.map.easeTo({
        center: [flight.longitude, flight.latitude],
        zoom: Math.max(this.map.getZoom(), 8.5),
        duration: 900,
        offset: this.sheetOffset(),
      });
    }
  }

  async lookupAircraft(id) {
    if (!id || this.aircraftCache.has(id)) return;
    try {
      const response = await fetch(`https://api.adsbdb.com/v0/aircraft/${id.toLowerCase()}`);
      const payload = await response.json();
      const ac = payload?.response?.aircraft;
      if (!response.ok || !ac || typeof ac !== "object") {
        this.aircraftCache.set(id, null);
        return;
      }
      this.aircraftCache.set(id, {
        model: (ac.type || ac.icao_type || "").trim(),
        typecode: (ac.icao_type || "").trim(),
        manufacturer: (ac.manufacturer || "").trim(),
        operator: (ac.registered_owner || "").trim(),
        registration: (ac.registration || "").trim(),
      });
    } catch {
      this.aircraftCache.set(id, null);
    }
    if (id === this.selectedId) this.renderSheet(this.flights.get(id) || null);
  }

  routeKey(callsign) {
    return String(callsign || "")
      .trim()
      .toUpperCase()
      .replace(/\s+/g, "");
  }

  routeFor(flight) {
    const key = this.routeKey(flight?.callsign);
    if (!key || this.routeCache.get(key) === "pending") return undefined;
    return this.routeCache.get(key) || null;
  }

  airportByCode(code) {
    const needle = String(code || "")
      .trim()
      .toUpperCase();
    if (!needle) return null;
    return this.airports.find((airport) => airport.ident === needle || airport.iata === needle) || null;
  }

  placeFromRouteAirport(place) {
    if (!place || typeof place !== "object") return null;
    const icao = (place.icao_code || place.icao || "").trim().toUpperCase();
    const iata = (place.iata_code || place.iata || "").trim().toUpperCase();
    const local = this.airportByCode(icao) || this.airportByCode(iata);
    const longitude = Number(place.longitude ?? local?.longitude);
    const latitude = Number(place.latitude ?? local?.latitude);
    if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) return null;
    return {
      code: iata || icao || local?.iata || local?.ident || "",
      name: (place.name || local?.name || "").trim(),
      longitude,
      latitude,
    };
  }

  async lookupRoute(flight) {
    const key = this.routeKey(flight?.callsign);
    if (!key || ICAO.test(key) || this.routeCache.has(key)) return;
    this.routeCache.set(key, "pending");
    try {
      const response = await fetch(`https://api.adsbdb.com/v0/callsign/${encodeURIComponent(key)}`);
      const payload = await response.json();
      const route = payload?.response?.flightroute;
      const destination = this.placeFromRouteAirport(route?.destination);
      const origin = this.placeFromRouteAirport(route?.origin);
      this.routeCache.set(key, destination || origin ? { origin, destination } : null);
    } catch {
      this.routeCache.set(key, null);
    }
    if (this.selectedId === flight.id) this.renderSheet(this.flights.get(flight.id) || null);
  }

  // ---- results dropdown ----------------------------------------------------

  setAirports(airports) {
    this.airports = airports || [];
    if (this.searchValue) this.renderResults(this.searchValue);
  }

  setRunways(runways) {
    this.runways = runways || new Map();
    if (this.selectedAirport) this.renderAirportSheet();
  }

  applyMetar(rows) {
    const next = new Map();
    for (const row of rows || []) {
      if (row?.id) next.set(row.id, row);
    }
    const previous = [...this.metar.keys()];
    this.metar = next;
    this.metarLoaded = true;
    if (!this.map.getSource("airports")) return;
    for (const ident of previous) {
      if (!next.has(ident)) this.map.setFeatureState({ source: "airports", id: ident }, { fltCat: null });
    }
    for (const [ident, metar] of next) {
      this.map.setFeatureState({ source: "airports", id: ident }, { fltCat: metar.cat || null });
    }
    highlightAirport(this.map, this.selectedAirport?.ident || null);
    if (this.selectedAirport) this.renderAirportSheet();
  }

  async refreshMetar() {
    if (this.metarInflight || document.hidden) return;
    this.metarInflight = true;
    try {
      const response = await fetch("/api/metar");
      if (!response.ok) throw new Error(`METAR failed (${response.status})`);
      const rows = await response.json();
      if (Array.isArray(rows)) this.applyMetar(rows);
    } catch {
      this.metarLoaded = true;
      if (this.selectedAirport) this.renderAirportSheet();
    } finally {
      this.metarInflight = false;
    }
  }

  setAirlines(airlines) {
    this.airlines = airlines || {};
    if (this.searchValue) this.renderResults(this.searchValue);
    if (this.selectedAirport) this.renderAirportSheet();
    else if (this.selectedId) this.renderSheet(this.flights.get(this.selectedId) || null);
  }

  airlineName(callsign) {
    return airlineFromCallsign(callsign, this.airlines);
  }

  matchingAirports(needle) {
    if (needle.length < 2) return [];
    return this.airports
      .filter((airport) => matchesAirport(airport, needle))
      .sort((left, right) => rankAirport(left, needle) - rankAirport(right, needle))
      .slice(0, 8);
  }

  setSearchValue(value) {
    this.searchValue = value;
    this.renderResults(value);
  }

  renderResults(query = this.searchValue, extra = []) {
    const needle = query.trim().toLowerCase();
    if (needle.length < 2 && extra.length === 0) {
      this.cb.onResults({ items: [], visible: false });
      return;
    }

    const flights =
      needle.length < 2
        ? []
        : this.visibleFlights()
            .filter((flight) => matchesQuery(flight, needle, this.airlines))
            .slice(0, 6);
    const airports = this.matchingAirports(needle);
    const items = [
      ...flights.map((flight) => ({
        kind: "flight",
        id: flight.id,
        callsign: flight.callsign,
        airline: flight.airlineName || this.airlineName(flight.callsign),
        country: flight.country || "",
      })),
      ...airports.map((airport) => ({
        kind: "airport",
        id: airport.ident,
        code: airport.iata || airport.ident,
        name: airport.name,
      })),
      ...extra,
    ];

    if (needle.length >= 3) {
      items.push({ kind: "worldwide", query: query.trim() });
    }

    this.cb.onResults({ items, visible: items.length > 0 });
  }

  // ---- network -------------------------------------------------------------

  async fetchFlights({ bbox, icao24, worldwide } = {}) {
    if (!this.canRequest()) {
      const error = new Error("paused");
      error.code = "paused";
      throw error;
    }
    const params = new URLSearchParams();
    params.set("extended", "1");
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
    if (remaining != null && remaining !== "") this.creditsRemaining = Number(remaining);

    const raw = await response.text();
    let payload = null;
    try {
      payload = raw ? JSON.parse(raw) : null;
    } catch {
      payload = null;
    }

    if (response.status === 429) {
      this.armQuotaWait(this.readRetryAfter(response, payload));
      throw new Error("quota");
    }
    if (!response.ok) throw new Error(`OpenSky returned ${response.status}`);
    const extras = payload?.aircraft || {};
    return (payload?.states || [])
      .map(parseFlight)
      .filter(Boolean)
      .map((flight) => {
        const extra = extras[flight.id] || extras[flight.id?.toLowerCase()];
        if (!extra) return flight;
        const typecode = extra.typecode || "";
        return {
          ...flight,
          typecode,
          model: extra.model || "",
          manufacturer: extra.manufacturer || "",
          icon: iconFromTypecode(typecode) || flight.icon,
        };
      });
  }

  followCamera(flight) {
    if (!this.following || !flight) return;
    this.programmaticMove = true;
    this.map.easeTo({
      center: [flight.longitude, flight.latitude],
      duration: Math.min(POLL_MS, 8000),
      easing: (t) => t,
      offset: this.sheetOffset(),
      essential: true,
    });
  }

  async refresh({ silent = false } = {}) {
    if (this.inflight || !this.bbox) return;
    if (document.hidden) return;
    if (this.showQuotaWait()) return;
    if (this.paused) {
      this.setStatus("idle", "Requests paused", "OpenSky calls stopped");
      this.syncPauseButton();
      return;
    }

    const selected = this.selectedId ? this.flights.get(this.selectedId) : null;
    if (!silent && this.flights.size === 0) {
      this.setStatus(
        "loading",
        this.selectedId ? `Locating ${this.selectedId.toUpperCase()}` : "Listening for traffic",
        this.creditMeta(),
      );
    }

    this.inflight = true;
    try {
      let next;
      if (this.following && selected) next = await this.fetchFlights({ bbox: aroundFlight(selected) });
      else if (this.selectedId && !selected) next = await this.fetchFlights({ icao24: this.selectedId });
      else next = await this.fetchFlights({ bbox: this.bbox });

      if (this.following && this.selectedId && !next.some((flight) => flight.id === this.selectedId)) {
        const exact = await this.fetchFlights({ icao24: this.selectedId });
        if (exact.length) next = [...exact, ...next.filter((flight) => flight.id !== this.selectedId)];
      }

      const now = this.ingest(next);
      const tracked = this.selectedId ? this.flights.get(this.selectedId) : null;
      const airborne = next.filter((flight) => !flight.onGround).length;

      if (this.selectedId && !tracked) {
        this.setStatus("error", "Not transmitting", this.creditMeta());
      } else if (this.following && tracked) {
        const airline = tracked.airlineName || this.airlineName(tracked.callsign);
        this.setStatus("live", `Tracking ${tracked.callsign}`, airline ? `${airline} · ${this.creditMeta()}` : this.creditMeta());
        this.followCamera(tracked);
      } else if (this.selectedAirport) {
        this.setStatus("live", this.selectedAirport.iata || this.selectedAirport.ident, this.selectedAirport.name);
      } else {
        this.setStatus(
          "live",
          `${airborne.toLocaleString()} airborne`,
          `Updated ${new Date(now).toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
          })} · ${this.creditMeta()}`,
        );
      }

      if (tracked) this.lookupRoute(tracked);
      this.renderSheet(tracked || null);
      this.renderResults(this.searchValue);
    } catch (error) {
      if (error.code === "paused" || this.showQuotaWait() || this.paused) return;
      this.setStatus("error", "Signal lost", error.message);
    } finally {
      this.inflight = false;
    }
  }

  async searchWorldwide(query = this.searchValue) {
    const needle = query.trim().toLowerCase();
    if (needle.length < 2 || this.inflight) return;
    if (this.showQuotaWait() || this.paused) return;

    this.setStatus("loading", ICAO.test(needle) ? "Looking up ICAO" : "Scanning worldwide", "Uses extra OpenSky credits");
    this.cb.onResults({ items: [], visible: false });
    this.inflight = true;
    let foundOne = false;

    try {
      const next = ICAO.test(needle)
        ? await this.fetchFlights({ icao24: needle })
        : await this.fetchFlights({ worldwide: true });
      const matches = next.filter((flight) => matchesQuery(flight, needle, this.airlines));

      if (matches.length === 1) {
        this.ingest(matches, { replace: false });
        this.selectFlight(matches[0].id, { fly: true, follow: true });
        this.searchValue = "";
        this.cb.onSearchValue("");
        this.renderResults("");
        foundOne = true;
      } else if (matches.length > 0) {
        this.ingest(matches, { replace: false });
        this.renderResults(query);
        this.setStatus("live", `${matches.length} matches worldwide`, this.creditMeta());
      } else {
        this.renderResults(query, [{ kind: "empty", text: `No live match for ${query.trim()}` }]);
        this.setStatus("error", "Not transmitting", this.creditMeta());
      }
    } catch (error) {
      if (error.code === "paused" || this.showQuotaWait() || this.paused) return;
      this.setStatus("error", "Search failed", error.message);
    } finally {
      this.inflight = false;
    }

    if (foundOne) await this.refresh({ silent: true });
  }

  // ---- animation frame -----------------------------------------------------

  paintFlights() {
    const source = this.map.getSource("flights");
    const trailSource = this.map.getSource("trails");
    if (!source) return;

    const now = Date.now();
    const features = this.visibleFlights().map((flight) => {
      const t = Math.min(1, (now - flight.receivedAt) / POLL_MS);
      const eased = t * t * (3 - 2 * t);
      return {
        type: "Feature",
        properties: {
          id: flight.id,
          callsign: flight.callsign,
          heading: flight.heading,
          onGround: flight.onGround,
          icon: flight.icon || "jet",
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

    const trail = this.selectedId ? this.trails.get(this.selectedId) || [] : [];
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

    const routeSource = this.map.getSource("route");
    if (!routeSource) return;
    const selected = this.selectedId ? this.flights.get(this.selectedId) : null;
    const route = selected ? this.routeFor(selected) : null;
    const origin = route?.origin;
    const dest = route?.destination;
    if (!selected || (!origin && !dest)) {
      routeSource.setData(EMPTY);
      return;
    }
    const selectedFeature = features.find((feature) => feature.properties.id === selected.id);
    const here = selectedFeature?.geometry.coordinates || [selected.longitude, selected.latitude];
    routeSource.setData({
      type: "FeatureCollection",
      features: [
        ...(origin ? this.routeLineFeatures("origin", [origin.longitude, origin.latitude], here) : []),
        ...(dest ? this.routeLineFeatures("dest", here, [dest.longitude, dest.latitude]) : []),
      ],
    });
  }

  routeLineFeatures(kind, from, to) {
    return splitAntimeridian(greatCircle(from[0], from[1], to[0], to[1])).map((coordinates) => ({
      type: "Feature",
      properties: { kind },
      geometry: { type: "LineString", coordinates },
    }));
  }

  // ---- tip -----------------------------------------------------------------

  showTip(event) {
    const callsign = event.features?.[0]?.properties?.callsign;
    if (!callsign) return this.hideTip();
    const flight = this.flights.get(event.features[0].properties.id);
    const airline = flight?.airlineName || this.airlineName(callsign);
    this.cb.onTip({
      visible: true,
      text: airline ? `${callsign} · ${airline}` : callsign,
      x: event.point.x,
      y: event.point.y,
    });
  }

  showAirportTip(event) {
    const props = event.features?.[0]?.properties;
    if (!props) return this.hideTip();
    const airport = props.ident ? this.airports.find((item) => item.ident === props.ident) : null;
    const code = props.iata || airport?.iata || props.ident;
    const name = props.name || airport?.name;
    const base = code && name ? `${code} · ${name}` : name || code;
    const summary = formatMetarSummary(airport ? this.metar.get(airport.ident) : null);
    const text = [base, summary].filter(Boolean).join(" · ");
    if (!text) return this.hideTip();
    this.cb.onTip({ visible: true, text, x: event.point.x, y: event.point.y });
  }

  hideTip() {
    this.cb.onTip({ visible: false, text: "", x: 0, y: 0 });
  }

  // ---- user actions from React --------------------------------------------

  setAirborneOnly(value) {
    this.airborneOnly = value;
    this.renderResults(this.searchValue);
  }

  toggleFollow() {
    if (!this.selectedId) return;
    this.following = !this.following;
    const flight = this.flights.get(this.selectedId);
    this.renderSheet(flight || null);
    if (this.following && flight) {
      this.selectFlight(this.selectedId, { fly: true, follow: true });
      this.refresh({ silent: true });
    }
  }

  closeSheet() {
    this.selectedAirport = null;
    highlightAirport(this.map, null);
    this.selectFlight(null);
    this.bbox = boundsToBBox(this.map);
    this.refresh();
  }

  submitSearch() {
    const needle = this.searchValue.trim().toLowerCase();
    if (needle.length < 2) return;

    const exactAirports = this.airports.filter(
      (airport) => airport.iata.toLowerCase() === needle || airport.ident.toLowerCase() === needle,
    );
    if (exactAirports.length === 1) {
      this.pickAirport(exactAirports[0].ident);
      return;
    }

    const flights = this.visibleFlights().filter((flight) => matchesQuery(flight, needle, this.airlines));
    if (flights.length === 1) {
      this.selectFlight(flights[0].id, { fly: true, follow: true });
      this.searchValue = "";
      this.cb.onSearchValue("");
      this.renderResults("");
      return;
    }

    const airports = this.matchingAirports(needle);
    if (airports.length === 1 && flights.length === 0) {
      this.pickAirport(airports[0].ident);
      return;
    }

    this.searchWorldwide(this.searchValue);
  }

  pickResult(id) {
    this.selectFlight(id, { fly: true, follow: true });
    this.searchValue = "";
    this.cb.onSearchValue("");
    this.renderResults("");
  }

  pickAirport(ident) {
    const airport = this.airports.find((item) => item.ident === ident);
    if (!airport) return;

    this.selectedAirport = airport;
    highlightAirport(this.map, airport.ident);
    this.selectFlight(null);
    this.programmaticMove = true;
    const zoom = this.runways.has(airport.ident)
      ? 12.6
      : airport.type === "L"
        ? 10
        : airport.type === "M"
          ? 11.2
          : 12.4;
    this.map.easeTo({
      center: [airport.longitude, airport.latitude],
      zoom: Math.max(this.map.getZoom(), zoom),
      duration: 900,
      offset: this.sheetOffset(),
    });
    this.searchValue = "";
    this.cb.onSearchValue("");
    this.renderResults("");
    this.setStatus("live", airport.iata || airport.ident, airport.name);
  }

  // ---- map event handlers --------------------------------------------------

  handleMoveEnd() {
    if (this.programmaticMove) {
      this.programmaticMove = false;
      if (this.selectedAirport) {
        this.bbox = boundsToBBox(this.map);
        this.refresh();
      }
      return;
    }
    if (this.following) return;
    clearTimeout(this.moveTimer);
    this.moveTimer = setTimeout(() => {
      this.bbox = boundsToBBox(this.map);
      this.refresh();
    }, 1600);
  }

  handleDragStart() {
    if (!this.following) return;
    this.following = false;
    const flight = this.selectedId ? this.flights.get(this.selectedId) : null;
    this.renderSheet(flight || null);
  }

  handleMapClick(event) {
    const { x, y } = event.point;
    const flightHits = this.map.queryRenderedFeatures(event.point, { layers: ["flights"] });
    const airportLayers = AIRPORT_CLICK_LAYERS.filter((id) => this.map.getLayer(id));
    const pad = 14;
    const airportHits = airportLayers.length
      ? this.map.queryRenderedFeatures(
          [
            [x - pad, y - pad],
            [x + pad, y + pad],
          ],
          { layers: airportLayers },
        )
      : [];

    const distance = (feature) => {
      const coords = feature.geometry?.coordinates;
      if (!Array.isArray(coords) || coords.length < 2) return Number.POSITIVE_INFINITY;
      const points = Array.isArray(coords[0]) ? coords : [coords];
      let best = Number.POSITIVE_INFINITY;
      for (const pair of points) {
        if (!Array.isArray(pair) || pair.length < 2) continue;
        const point = this.map.project(pair);
        best = Math.min(best, Math.hypot(point.x - x, point.y - y));
      }
      return best;
    };

    const flight = flightHits[0];
    const airport = airportHits[0];
    if (flight && airport) {
      if (distance(airport) <= distance(flight) + 8) {
        const ident = airport.properties?.ident;
        if (ident) this.pickAirport(ident);
        return;
      }
      this.selectFlight(flight.properties.id, { follow: true, fly: true });
      return;
    }
    if (airport?.properties?.ident) {
      this.pickAirport(airport.properties.ident);
      return;
    }
    if (flight?.properties?.id) {
      this.selectFlight(flight.properties.id, { follow: true, fly: true });
      return;
    }

    const wasTracking = Boolean(this.selectedId);
    this.selectedAirport = null;
    highlightAirport(this.map, null);
    this.selectFlight(null);
    if (wasTracking) {
      this.bbox = boundsToBBox(this.map);
      this.refresh();
    }
  }

  // ---- lifecycle -----------------------------------------------------------

  async boot() {
    try {
      const status = await fetch("/api/status").then((response) => response.json());
      this.authenticated = Boolean(status.authenticated);
    } catch {
      this.authenticated = false;
    }

    this.bbox = boundsToBBox(this.map);
    const bootIcao = new URLSearchParams(location.search).get("icao");
    if (bootIcao) {
      this.selectFlight(bootIcao.toLowerCase(), { follow: true });
      this.renderSheet(null);
    }
    this.refresh();
    this.refreshMetar();
    this.pollTimer = setInterval(() => this.refresh(), POLL_MS);
    this.metarTimer = setInterval(() => this.refreshMetar(), METAR_MS);
    const tick = () => {
      this.paintFlights();
      this.rafId = requestAnimationFrame(tick);
    };
    this.rafId = requestAnimationFrame(tick);
  }

  destroy() {
    if (this.quotaTimer) clearInterval(this.quotaTimer);
    if (this.pollTimer) clearInterval(this.pollTimer);
    if (this.metarTimer) clearInterval(this.metarTimer);
    if (this.moveTimer) clearTimeout(this.moveTimer);
    if (this.rafId) cancelAnimationFrame(this.rafId);
  }
}
