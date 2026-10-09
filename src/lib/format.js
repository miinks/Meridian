import { lookupAirline, aircraftIcon } from "./identity.js";

export const POLL_MS = 10_000;
export const EMPTY = { type: "FeatureCollection", features: [] };
export const ICAO = /^[a-f0-9]{6}$/i;

export function lerp(from, to, t) {
  return from + (to - from) * t;
}

export function distanceKm(lat1, lon1, lat2, lon2) {
  const toRad = (degrees) => (degrees * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 12742 * Math.asin(Math.min(1, Math.sqrt(a)));
}

export function formatDistance(km) {
  if (!Number.isFinite(km)) return "—";
  if (km < 10) return `${km.toFixed(1)} km`;
  return `${Math.round(km)} km`;
}

export function headingDelta(from, to) {
  return Math.abs(((Number(from) - Number(to) + 540) % 360) - 180);
}

export function bearingTo(lat1, lon1, lat2, lon2) {
  const toRad = (degrees) => (degrees * Math.PI) / 180;
  const toDeg = (radians) => (radians * 180) / Math.PI;
  const φ1 = toRad(lat1);
  const φ2 = toRad(lat2);
  const Δλ = toRad(lon2 - lon1);
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

function approachLimits(type) {
  if (type === "L") return { maxKm: 45, maxAltM: 3000, groundKm: 8 };
  if (type === "M") return { maxKm: 28, maxAltM: 1800, groundKm: 5 };
  return { maxKm: 12, maxAltM: 900, groundKm: 3.5 };
}

export function airportAsPlace(airport) {
  if (!airport) return null;
  return {
    code: airport.iata || airport.ident,
    ident: airport.ident,
    name: airport.name || "",
    longitude: airport.longitude,
    latitude: airport.latitude,
  };
}

export function sameAirport(left, right) {
  if (!left || !right) return false;
  const keys = (place) =>
    [place.ident, place.code, place.iata]
      .filter(Boolean)
      .map((value) => String(value).trim().toUpperCase());
  const set = new Set(keys(left));
  return keys(right).some((value) => set.has(value));
}

export function approachingAirport(flight, airports) {
  if (!flight || !airports?.length) return null;
  const lat = flight.latitude;
  const lon = flight.longitude;
  const padLat = 45 / 111;
  const padLon = 45 / (111 * Math.max(0.2, Math.cos((lat * Math.PI) / 180)));
  let best = null;
  for (const airport of airports) {
    if (Math.abs(airport.latitude - lat) > padLat || Math.abs(airport.longitude - lon) > padLon) continue;
    const limits = approachLimits(airport.type);
    const km = distanceKm(lat, lon, airport.latitude, airport.longitude);
    if (flight.onGround) {
      if (km > limits.groundKm) continue;
      const score = km + (airport.type === "L" ? 0 : airport.type === "M" ? 0.5 : 1.5);
      if (!best || score < best.score) best = { airport, score };
      continue;
    }
    if (km > limits.maxKm) continue;
    const alt = flight.altitudeM;
    if (Number.isFinite(alt) && alt > limits.maxAltM) continue;
    if (Number.isFinite(alt) && alt > 120 + km * 95) continue;
    const error = headingDelta(flight.heading, bearingTo(lat, lon, airport.latitude, airport.longitude));
    const headingLimit = km < 3 ? 180 : km < 8 ? 80 : 48;
    if (error > headingLimit) continue;
    const climbing = Number.isFinite(flight.verticalRateMs) && flight.verticalRateMs > 2.5;
    if (climbing && km > 5) continue;
    const typePenalty = airport.type === "L" ? 0 : airport.type === "M" ? 1.8 : 5;
    const score = km + error * 0.08 + typePenalty;
    if (!best || score < best.score) best = { airport, score };
  }
  return best?.airport || null;
}

export function greatCircle(lon1, lat1, lon2, lat2, steps = 48) {
  const toRad = (degrees) => (degrees * Math.PI) / 180;
  const toDeg = (radians) => (radians * 180) / Math.PI;
  const φ1 = toRad(lat1);
  const λ1 = toRad(lon1);
  const φ2 = toRad(lat2);
  const λ2 = toRad(lon2);
  const Δ = 2 * Math.asin(
    Math.min(
      1,
      Math.sqrt(Math.sin((φ2 - φ1) / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin((λ2 - λ1) / 2) ** 2),
    ),
  );
  if (!Number.isFinite(Δ) || Δ < 1e-6) return [[lon1, lat1], [lon2, lat2]];

  const coords = [];
  for (let i = 0; i <= steps; i += 1) {
    const fraction = i / steps;
    const a = Math.sin((1 - fraction) * Δ) / Math.sin(Δ);
    const b = Math.sin(fraction * Δ) / Math.sin(Δ);
    const x = a * Math.cos(φ1) * Math.cos(λ1) + b * Math.cos(φ2) * Math.cos(λ2);
    const y = a * Math.cos(φ1) * Math.sin(λ1) + b * Math.cos(φ2) * Math.sin(λ2);
    const z = a * Math.sin(φ1) + b * Math.sin(φ2);
    coords.push([toDeg(Math.atan2(y, x)), toDeg(Math.atan2(z, Math.hypot(x, y)))]);
  }
  return coords;
}

export function splitAntimeridian(coords) {
  const parts = [[]];
  for (const point of coords) {
    const current = parts[parts.length - 1];
    if (current.length && Math.abs(point[0] - current[current.length - 1][0]) > 180) {
      parts.push([point]);
    } else {
      current.push(point);
    }
  }
  return parts.filter((part) => part.length > 1);
}

export function airportKindLabel(type) {
  switch (type) {
    case "L":
      return "Large airport";
    case "M":
      return "Medium airport";
    case "P":
      return "Seaplane base";
    default:
      return "Small airport";
  }
}

export function formatAltitude(meters, onGround) {
  if (onGround) return "On ground";
  if (meters == null) return "—";
  return `${Math.round(meters * 3.28084).toLocaleString()} ft`;
}

export function formatSpeed(metersPerSecond) {
  if (metersPerSecond == null) return "—";
  return `${Math.round(metersPerSecond * 1.94384)} kt`;
}

export function formatHeading(degrees) {
  return `${Math.round((degrees + 360) % 360)
    .toString()
    .padStart(3, "0")}°`;
}

export function formatVerticalRate(metersPerSecond, onGround) {
  if (onGround || metersPerSecond == null) return "Level";
  const fpm = Math.round(metersPerSecond * 196.85);
  if (Math.abs(fpm) < 80) return "Level";
  return `${fpm > 0 ? "+" : ""}${fpm.toLocaleString()} fpm`;
}

export function formatWait(seconds) {
  const total = Math.max(0, Math.round(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  if (hours > 0) return minutes ? `${hours}h ${minutes}m` : `${hours}h`;
  if (minutes > 0) return minutes < 10 && secs ? `${minutes}m ${secs}s` : `${minutes}m`;
  return `${secs}s`;
}

export function formatRoute(origin, destination, empty = "—") {
  const from = origin?.code;
  const to = destination?.code;
  if (from && to) return `${from} → ${to}`;
  if (from) return `${from} → —`;
  if (to) return `— → ${to}`;
  return empty;
}

const MIN_ETA_SPEED_MS = 25;

export function etaSeconds(km, speedMs) {
  if (!Number.isFinite(km) || km < 0 || !Number.isFinite(speedMs) || speedMs < MIN_ETA_SPEED_MS) return null;
  const seconds = (km / (speedMs * 3.6)) * 3600;
  if (!Number.isFinite(seconds) || seconds > 36 * 3600) return null;
  return seconds;
}

export function formatEta(seconds) {
  if (!Number.isFinite(seconds)) return "—";
  if (seconds < 90) return "Soon";
  const minutesTotal = Math.max(1, Math.round(seconds / 60));
  const hours = Math.floor(minutesTotal / 60);
  const minutes = minutesTotal % 60;
  const duration = hours > 0 ? (minutes ? `${hours}h ${minutes}m` : `${hours}h`) : `${minutes}m`;
  const clock = new Date(Date.now() + seconds * 1000).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return `${duration} · ${clock}`;
}

export function formatFlightEta(flight, destination) {
  if (!flight || !destination) return "—";
  const km = distanceKm(flight.latitude, flight.longitude, destination.latitude, destination.longitude);
  if (flight.onGround && km <= 8) return "Arrived";
  if (flight.onGround) return "—";
  return formatEta(etaSeconds(km, flight.speedMs));
}

export function routeFacts(flight, route) {
  const pending = route === undefined;
  const origin = route?.origin;
  const destination = route?.destination;
  const empty = pending ? "Looking up…" : "—";
  const facts = [["Route", formatRoute(origin, destination, empty)]];
  if (!flight || !destination) {
    facts.push(["ETA", pending ? "Looking up…" : "—"], ["Remaining", "—"]);
    return facts;
  }
  const km = distanceKm(flight.latitude, flight.longitude, destination.latitude, destination.longitude);
  facts.push(["ETA", formatFlightEta(flight, destination)], ["Remaining", formatDistance(km)]);
  return facts;
}

export function parseFlight(row) {
  const [id, rawCallsign, country, , , lon, lat, altitude, onGround, speed, heading, verticalRate, , , squawk, , , category] =
    row;
  if (lon == null || lat == null) return null;
  const callsign = (rawCallsign || "").trim() || id.toUpperCase();
  const airline = lookupAirline(callsign);
  const cat = Number(category);
  return {
    id,
    callsign,
    country,
    longitude: lon,
    latitude: lat,
    altitudeM: altitude,
    onGround,
    speedMs: speed,
    heading: heading ?? 0,
    verticalRateMs: verticalRate,
    squawk,
    category: Number.isFinite(cat) ? cat : 0,
    airlineName: airline?.name || "",
    airlineFlight: airline?.flight || "",
    icon: aircraftIcon(category),
  };
}

export function boundsToBBox(map) {
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

export function aroundFlight(flight, deg = 1.1) {
  return {
    south: Math.max(-90, flight.latitude - deg),
    west: Math.max(-180, flight.longitude - deg),
    north: Math.min(90, flight.latitude + deg),
    east: Math.min(180, flight.longitude + deg),
  };
}

export async function loadAirlines() {
  const response = await fetch("/airlines.json");
  if (!response.ok) throw new Error(`Airlines failed (${response.status})`);
  return response.json();
}

export function airlineFromCallsign(callsign, airlines = {}) {
  const text = String(callsign || "")
    .trim()
    .toUpperCase();
  const icao = text.match(/^([A-Z]{3})/);
  if (icao && airlines[icao[1]]) return airlines[icao[1]];
  const iata = text.match(/^([A-Z0-9]{2})(?=\d)/);
  if (iata && airlines[iata[1]]) return airlines[iata[1]];
  return "";
}

export function matchesQuery(flight, needle, airlines = {}) {
  if (flight.callsign.toLowerCase().includes(needle) || flight.id.toLowerCase().includes(needle)) return true;
  if ((flight.airlineName || "").toLowerCase().includes(needle)) return true;
  if ((flight.airlineFlight || "").toLowerCase().includes(needle)) return true;
  const airline = airlineFromCallsign(flight.callsign, airlines).toLowerCase();
  return Boolean(airline) && airline.includes(needle);
}

export function matchesAirport(airport, needle) {
  return (
    airport.ident.toLowerCase().includes(needle) ||
    airport.iata.toLowerCase().includes(needle) ||
    airport.name.toLowerCase().includes(needle)
  );
}

export function rankAirport(airport, needle) {
  const ident = airport.ident.toLowerCase();
  const iata = airport.iata.toLowerCase();
  const name = airport.name.toLowerCase();
  const typeBoost = airport.type === "L" ? 0 : airport.type === "M" ? 1 : 2;
  if (iata === needle || ident === needle) return typeBoost;
  if (iata.startsWith(needle) || ident.startsWith(needle)) return 10 + typeBoost;
  if (name.startsWith(needle)) return 20 + typeBoost;
  return 30 + typeBoost;
}
