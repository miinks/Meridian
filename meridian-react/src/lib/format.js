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

export function matchesQuery(flight, needle) {
  return flight.callsign.toLowerCase().includes(needle) || flight.id.toLowerCase().includes(needle);
}
