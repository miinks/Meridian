import { EMPTY } from "./format.js";

export const AIRPORT_LAYERS = ["airports-large", "airports-medium", "airports-small"];
export const AIRPORT_LABEL_LAYERS = ["airport-labels-large", "airport-labels-medium", "airport-labels-small"];
export const AIRPORT_CLICK_LAYERS = [...AIRPORT_LAYERS, ...AIRPORT_LABEL_LAYERS];

const AIRPORT_CIRCLE = {
  "airports-large": { radius: 4.2, selectedRadius: 6.2, stroke: "rgba(232, 193, 122, 0.85)" },
  "airports-medium": { radius: 3.1, selectedRadius: 4.6, stroke: "rgba(244, 241, 234, 0.42)" },
  "airports-small": { radius: 2.2, selectedRadius: 3.4, stroke: "rgba(244, 241, 234, 0.28)" },
};

export function highlightAirport(map, ident) {
  const selected = ident || "";
  for (const [id, spec] of Object.entries(AIRPORT_CIRCLE)) {
    if (!map.getLayer(id)) continue;
    map.setPaintProperty(id, "circle-stroke-color", [
      "case",
      ["==", ["get", "ident"], selected],
      "rgba(232, 193, 122, 1)",
      spec.stroke,
    ]);
    map.setPaintProperty(id, "circle-radius", [
      "case",
      ["==", ["get", "ident"], selected],
      spec.selectedRadius,
      spec.radius,
    ]);
  }
}

export function airportsToGeoJSON(rows) {
  return {
    type: "FeatureCollection",
    features: rows.map(([type, ident, iata, name, lon, lat]) => ({
      type: "Feature",
      properties: { type, ident, iata, name },
      geometry: { type: "Point", coordinates: [lon, lat] },
    })),
  };
}

export async function loadAirports() {
  const response = await fetch("/airports.json");
  if (!response.ok) throw new Error(`Airports failed (${response.status})`);
  return airportsToGeoJSON(await response.json());
}

export function airportIndex(collection) {
  return (collection?.features || []).map((feature) => ({
    ident: feature.properties.ident || "",
    iata: feature.properties.iata || "",
    name: feature.properties.name || "",
    type: feature.properties.type || "S",
    longitude: feature.geometry.coordinates[0],
    latitude: feature.geometry.coordinates[1],
  }));
}

function airportCircle(id, types, minzoom, radius, fill, stroke) {
  return {
    id,
    type: "circle",
    source: "airports",
    minzoom,
    filter: ["in", ["get", "type"], ["literal", types]],
    paint: {
      "circle-radius": radius,
      "circle-color": fill,
      "circle-stroke-color": stroke,
      "circle-stroke-width": 1,
      "circle-opacity": 0.95,
    },
  };
}

function airportLabels(id, types, minzoom, size) {
  return {
    id,
    type: "symbol",
    source: "airports",
    minzoom,
    filter: ["in", ["get", "type"], ["literal", types]],
    layout: {
      "text-field": ["coalesce", ["get", "iata"], ["get", "ident"]],
      "text-size": size,
      "text-offset": [0, 0.9],
      "text-anchor": "top",
      "text-optional": true,
      "text-allow-overlap": false,
      "text-padding": 2,
    },
    paint: {
      "text-color": "#c8c3b8",
      "text-halo-color": "#07080a",
      "text-halo-width": 1.2,
    },
  };
}

function stamp(map, id, fill, stroke, glow, draw) {
  const size = 96;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  ctx.translate(size / 2, size / 2);
  if (glow) {
    ctx.shadowColor = fill;
    ctx.shadowBlur = 14;
  }
  ctx.fillStyle = fill;
  ctx.strokeStyle = stroke;
  ctx.lineWidth = 2.2;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  draw(ctx);
  if (map.hasImage(id)) map.removeImage(id);
  map.addImage(id, ctx.getImageData(0, 0, size, size), { pixelRatio: 2 });
}

function fillPath(ctx, build) {
  ctx.beginPath();
  build(ctx);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
}

function drawPlane(ctx, scale, span = 20) {
  const s = scale;
  const w = span;
  fillPath(ctx, (p) => {
    p.moveTo(0, -22 * s);
    p.lineTo(2.5 * s, -13 * s);
    p.lineTo(2.7 * s, -4.5 * s);
    p.lineTo(w * s, 2.2 * s);
    p.lineTo(w * s, 6.8 * s);
    p.lineTo(2.7 * s, 1.8 * s);
    p.lineTo(2.5 * s, 11 * s);
    p.lineTo(8.2 * s, 16.8 * s);
    p.lineTo(8.2 * s, 20 * s);
    p.lineTo(0, 16.2 * s);
    p.lineTo(-8.2 * s, 20 * s);
    p.lineTo(-8.2 * s, 16.8 * s);
    p.lineTo(-2.5 * s, 11 * s);
    p.lineTo(-2.7 * s, 1.8 * s);
    p.lineTo(-w * s, 6.8 * s);
    p.lineTo(-w * s, 2.2 * s);
    p.lineTo(-2.7 * s, -4.5 * s);
    p.lineTo(-2.5 * s, -13 * s);
  });
}

function drawJet(ctx) {
  drawPlane(ctx, 1, 20);
}

function drawHeavy(ctx) {
  drawPlane(ctx, 1.18, 23);
}

function drawSmall(ctx) {
  drawPlane(ctx, 0.74, 18);
}

function drawRotor(ctx) {
  ctx.beginPath();
  ctx.arc(0, -2, 16, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(-16, -2);
  ctx.lineTo(16, -2);
  ctx.moveTo(0, -18);
  ctx.lineTo(0, 10);
  ctx.stroke();
  fillPath(ctx, (p) => {
    p.moveTo(-3.2, -12);
    p.lineTo(3.2, -12);
    p.lineTo(3.2, 7);
    p.lineTo(-3.2, 7);
  });
  ctx.beginPath();
  ctx.moveTo(0, 7);
  ctx.lineTo(0, 16);
  ctx.lineTo(8, 18);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(6.5, 16.2);
  ctx.lineTo(10, 19.4);
  ctx.stroke();
}

function drawGlider(ctx) {
  drawPlane(ctx, 0.78, 28);
}

function drawUav(ctx) {
  drawPlane(ctx, 0.68, 22);
}

function drawBalloon(ctx) {
  ctx.beginPath();
  ctx.ellipse(0, -6, 10, 11, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillRect(-3, 6, 6, 5);
  ctx.strokeRect(-3, 6, 6, 5);
  ctx.beginPath();
  ctx.moveTo(-6, 2);
  ctx.lineTo(-3, 6);
  ctx.moveTo(6, 2);
  ctx.lineTo(3, 6);
  ctx.stroke();
}

function drawGround(ctx) {
  fillPath(ctx, (p) => {
    p.moveTo(-10, -4);
    p.lineTo(8, -4);
    p.lineTo(12, 0);
    p.lineTo(12, 5);
    p.lineTo(-10, 5);
  });
  ctx.beginPath();
  ctx.arc(-5, 6, 2.2, 0, Math.PI * 2);
  ctx.arc(7, 6, 2.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
}

const ICONS = {
  jet: drawJet,
  heavy: drawHeavy,
  small: drawSmall,
  rotor: drawRotor,
  glider: drawGlider,
  uav: drawUav,
  balloon: drawBalloon,
  ground: drawGround,
};

export function selectedExpression(selectedId, selectedValue, fallback) {
  return ["case", ["==", ["get", "id"], selectedId || ""], selectedValue, fallback];
}

export function iconImageExpression(selectedId) {
  return [
    "concat",
    ["coalesce", ["get", "icon"], "jet"],
    ["case", ["==", ["get", "id"], selectedId || ""], "-selected", ""],
  ];
}

const ZOOM_WORLD = 1.5;
const ZOOM_OUT = 4;
const ZOOM_IN = 8;
const WORLD_SCALE = 2.15;
const OUT_SCALE = 1.65;
const BASE_SIZE = 1.08;
const SELECTED_SIZE = 1.42;

export function iconSizeExpression(selectedId) {
  const sizeAt = (factor) => selectedExpression(selectedId, SELECTED_SIZE * factor, BASE_SIZE * factor);
  return [
    "interpolate",
    ["linear"],
    ["zoom"],
    ZOOM_WORLD,
    sizeAt(WORLD_SCALE),
    ZOOM_OUT,
    sizeAt(OUT_SCALE),
    ZOOM_IN,
    sizeAt(1),
  ];
}

export function installMapLayers(map, airports = EMPTY) {
  for (const [name, draw] of Object.entries(ICONS)) {
    stamp(map, name, "#f4f1ea", "#111111", false, draw);
    stamp(map, `${name}-selected`, "#e8c17a", "#111111", true, draw);
  }

  map.addSource("airports", { type: "geojson", data: airports });
  map.addLayer(airportCircle("airports-large", ["L"], 1, 4.2, "rgba(232, 193, 122, 0.18)", "rgba(232, 193, 122, 0.85)"));
  map.addLayer(airportCircle("airports-medium", ["M"], 4.2, 3.1, "rgba(244, 241, 234, 0.08)", "rgba(244, 241, 234, 0.42)"));
  map.addLayer(airportCircle("airports-small", ["S", "P"], 7.4, 2.2, "rgba(244, 241, 234, 0.05)", "rgba(244, 241, 234, 0.28)"));
  map.addLayer(airportLabels("airport-labels-large", ["L"], 5.2, 11));
  map.addLayer(airportLabels("airport-labels-medium", ["M"], 7.6, 10));
  map.addLayer(airportLabels("airport-labels-small", ["S", "P"], 10.4, 9));

  map.addSource("trails", { type: "geojson", data: EMPTY });
  map.addSource("route", { type: "geojson", data: EMPTY });
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
    id: "route",
    type: "line",
    source: "route",
    paint: {
      "line-color": "#e8c17a",
      "line-width": 1.7,
      "line-opacity": 0.72,
      "line-dasharray": [2.2, 1.6],
    },
  });

  map.addLayer({
    id: "flights",
    type: "symbol",
    source: "flights",
    layout: {
      "icon-image": iconImageExpression(null),
      "icon-rotate": ["get", "heading"],
      "icon-rotation-alignment": "map",
      "icon-allow-overlap": true,
      "icon-ignore-placement": true,
      "icon-size": iconSizeExpression(null),
    },
    paint: {
      "icon-opacity": ["case", ["get", "onGround"], 0.28, 0.92],
    },
  });
}
