export const POLL_MS = 10_000;
export const EMPTY = { type: "FeatureCollection", features: [] };
export const ICAO = /^[a-f0-9]{6}$/i;

export function lerp(from, to, t) {
  return from + (to - from) * t;
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

export function parseFlight(row) {
  const [id, rawCallsign, country, , , lon, lat, altitude, onGround, speed, heading, verticalRate, , , squawk, , category] =
    row;
  if (lon == null || lat == null) return null;
  const cat = Number(category);
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
    category: Number.isFinite(cat) ? cat : 0,
  };
}

export function planeKind(category) {
  if (category === 8) return "rotor";
  if (category === 2 || category === 9 || category === 10 || category === 12 || category === 14) return "light";
  if (category === 4 || category === 5 || category === 6) return "heavy";
  return "medium";
}

export function planeIconSize(category) {
  switch (category) {
    case 2:
    case 9:
    case 10:
    case 12:
    case 14:
      return 0.58;
    case 3:
      return 0.74;
    case 4:
      return 0.96;
    case 5:
      return 1.06;
    case 6:
      return 1.22;
    case 7:
      return 0.8;
    case 8:
      return 0.7;
    default:
      return 0.8;
  }
}

export function formatCategory(category) {
  switch (category) {
    case 2:
      return "Light";
    case 3:
      return "Small";
    case 4:
      return "Large";
    case 5:
      return "High vortex";
    case 6:
      return "Heavy";
    case 7:
      return "High performance";
    case 8:
      return "Rotorcraft";
    case 9:
      return "Glider";
    case 10:
      return "Lighter-than-air";
    case 12:
      return "Ultralight";
    case 14:
      return "UAV";
    default:
      return "Unknown";
  }
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
  const text = String(callsign || "").trim().toUpperCase();
  const icao = text.match(/^([A-Z]{3})/);
  if (icao && airlines[icao[1]]) return airlines[icao[1]];
  const iata = text.match(/^([A-Z0-9]{2})(?=\d)/);
  if (iata && airlines[iata[1]]) return airlines[iata[1]];
  return "";
}

export function matchesQuery(flight, needle, airlines = {}) {
  if (flight.callsign.toLowerCase().includes(needle) || flight.id.toLowerCase().includes(needle)) return true;
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
