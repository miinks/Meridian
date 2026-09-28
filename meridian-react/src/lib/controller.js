import {
  POLL_MS,
  ICAO,
  lerp,
  formatAltitude,
  formatSpeed,
  formatHeading,
  formatVerticalRate,
  formatWait,
  parseFlight,
  planeKind,
  planeIconSize,
  formatCategory,
  boundsToBBox,
  aroundFlight,
  matchesQuery,
  airlineFromCallsign,
  matchesAirport,
  rankAirport,
} from "./format.js";
import { planeImageExpression, planeSizeExpression } from "./map.js";

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
    this.programmaticMove = false;
    this.searchValue = "";
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

  renderSheet(flight) {
    if (!flight && !this.selectedId) {
      this.cb.onSheet(null);
      document.title = "Meridian";
      return;
    }

    const callsign = flight?.callsign || this.selectedId?.toUpperCase() || "Flight";
    const airline = this.airlineName(callsign);
    const facts = flight
      ? [
          ["Altitude", formatAltitude(flight.altitudeM, flight.onGround)],
          ["Speed", formatSpeed(flight.speedMs)],
          ["Heading", formatHeading(flight.heading)],
          ["Vertical", formatVerticalRate(flight.verticalRateMs, flight.onGround)],
          ["Type", formatCategory(flight.category)],
          ["Squawk", flight.squawk || "—"],
          ["Country", flight.country],
        ]
      : [
          ["Altitude", "Locating…"],
          ["Speed", "—"],
          ["Heading", "—"],
          ["Vertical", "—"],
          ["Type", "—"],
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
    if (!id) this.following = false;
    else if (follow) this.following = true;

    const flight = id ? this.flights.get(id) : null;
    this.renderSheet(flight);
    this.syncUrl();

    if (this.map.getLayer("flights")) {
      this.map.setLayoutProperty("flights", "icon-image", planeImageExpression(id));
      this.map.setLayoutProperty("flights", "icon-size", planeSizeExpression(id));
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

  // ---- results dropdown ----------------------------------------------------

  setAirports(airports) {
    this.airports = airports || [];
    if (this.searchValue) this.renderResults(this.searchValue);
  }

  setAirlines(airlines) {
    this.airlines = airlines || {};
    if (this.searchValue) this.renderResults(this.searchValue);
    if (this.selectedId) this.renderSheet(this.flights.get(this.selectedId) || null);
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
        airline: this.airlineName(flight.callsign),
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
    return (payload?.states || []).map(parseFlight).filter(Boolean);
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
        const airline = this.airlineName(tracked.callsign);
        this.setStatus("live", `Tracking ${tracked.callsign}`, airline ? `${airline} · ${this.creditMeta()}` : this.creditMeta());
        this.followCamera(tracked);
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
          kind: planeKind(flight.category),
          iconSize: planeIconSize(flight.category),
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
  }

  // ---- tip -----------------------------------------------------------------

  showTip(event) {
    const callsign = event.features?.[0]?.properties?.callsign;
    if (!callsign) return this.hideTip();
    const airline = this.airlineName(callsign);
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
    const code = props.iata || props.ident;
    const text = code && props.name ? `${code} · ${props.name}` : props.name || code;
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

    this.selectFlight(null);
    this.following = false;
    this.programmaticMove = true;
    const zoom = airport.type === "L" ? 10 : airport.type === "M" ? 11.2 : 12.4;
    this.map.easeTo({
      center: [airport.longitude, airport.latitude],
      zoom: Math.max(this.map.getZoom(), zoom),
      duration: 900,
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

  handleFlightClick(event) {
    const id = event.features?.[0]?.properties?.id;
    if (id) this.selectFlight(id, { follow: true, fly: true });
  }

  handleMapClick(event) {
    const hits = this.map.queryRenderedFeatures(event.point, { layers: ["flights"] });
    if (hits.length === 0) {
      const wasTracking = Boolean(this.selectedId);
      this.selectFlight(null);
      if (wasTracking) {
        this.bbox = boundsToBBox(this.map);
        this.refresh();
      }
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
    this.pollTimer = setInterval(() => this.refresh(), POLL_MS);
    const tick = () => {
      this.paintFlights();
      this.rafId = requestAnimationFrame(tick);
    };
    this.rafId = requestAnimationFrame(tick);
  }

  destroy() {
    if (this.quotaTimer) clearInterval(this.quotaTimer);
    if (this.pollTimer) clearInterval(this.pollTimer);
    if (this.moveTimer) clearTimeout(this.moveTimer);
    if (this.rafId) cancelAnimationFrame(this.rafId);
  }
}
