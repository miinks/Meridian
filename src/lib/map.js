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

function stamp(map, id, fill, glow, draw) {
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
  ctx.strokeStyle = fill;
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
}

function capsule(ctx, half, y0, y1) {
  const radius = half;
  ctx.beginPath();
  ctx.moveTo(-half, y0 + radius);
  ctx.arcTo(-half, y0, 0, y0, radius);
  ctx.arcTo(half, y0, half, y0 + radius, radius);
  ctx.lineTo(half, y1 - radius);
  ctx.arcTo(half, y1, 0, y1, radius);
  ctx.arcTo(-half, y1, -half, y1 - radius, radius);
  ctx.closePath();
  ctx.fill();
}

function sweptWing(ctx, side, rootX, y, span, sweep, chord) {
  const s = side;
  fillPath(ctx, (p) => {
    p.moveTo(s * rootX, y);
    p.lineTo(s * span, y + sweep);
    p.lineTo(s * span, y + sweep + chord * 0.45);
    p.lineTo(s * (span - 1.8), y + sweep + chord);
    p.lineTo(s * rootX, y + chord * 0.72);
  });
}

function stab(ctx, side, rootX, y, span) {
  const s = side;
  fillPath(ctx, (p) => {
    p.moveTo(s * rootX, y);
    p.lineTo(s * span, y + 2.2);
    p.lineTo(s * (span - 0.6), y + 4.2);
    p.lineTo(s * rootX, y + 3.2);
  });
}

function engine(ctx, x, y) {
  ctx.beginPath();
  ctx.ellipse(x, y, 1.7, 3.1, 0, 0, Math.PI * 2);
  ctx.fill();
}

function drawAirliner(ctx, spec) {
  const {
    half = 2.35,
    nose = -21,
    tail = 18,
    wingY = -2,
    span = 19,
    sweep = 7.5,
    chord = 6.2,
    stabSpan = 7.2,
    stabY = 12.5,
    engines = true,
    engineX = 8.5,
    engineY = 3.2,
  } = spec;

  sweptWing(ctx, 1, half - 0.2, wingY, span, sweep, chord);
  sweptWing(ctx, -1, half - 0.2, wingY, span, sweep, chord);
  if (engines) {
    engine(ctx, engineX, engineY);
    engine(ctx, -engineX, engineY);
  }
  stab(ctx, 1, half * 0.55, stabY, stabSpan);
  stab(ctx, -1, half * 0.55, stabY, stabSpan);
  capsule(ctx, half, nose, tail);
}

function drawJet(ctx) {
  drawAirliner(ctx, {});
}

function drawHeavy(ctx) {
  drawAirliner(ctx, {
    half: 2.85,
    nose: -22,
    tail: 19,
    span: 23,
    sweep: 8.5,
    chord: 7.2,
    stabSpan: 8.4,
    stabY: 13,
    engineX: 10.2,
    engineY: 3.8,
  });
  engine(ctx, 6.2, 2.4);
  engine(ctx, -6.2, 2.4);
}

function drawSmall(ctx) {
  drawAirliner(ctx, {
    half: 1.9,
    nose: -17,
    tail: 15,
    wingY: -1,
    span: 16,
    sweep: 2.2,
    chord: 5,
    stabSpan: 5.8,
    stabY: 10.5,
    engines: false,
  });
  ctx.beginPath();
  ctx.arc(0, -16.2, 1.6, 0, Math.PI * 2);
  ctx.fill();
}

function drawRotor(ctx) {
  ctx.save();
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(0, -3, 17, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(-17, -3);
  ctx.lineTo(17, -3);
  ctx.moveTo(0, -20);
  ctx.lineTo(0, 11);
  ctx.stroke();
  capsule(ctx, 3.1, -13, 8);
  ctx.beginPath();
  ctx.moveTo(0, 8);
  ctx.lineTo(0, 16);
  ctx.lineTo(9, 18);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(7, 16.2);
  ctx.lineTo(11, 19.2);
  ctx.stroke();
  ctx.restore();
}

function drawGlider(ctx) {
  drawAirliner(ctx, {
    half: 1.45,
    nose: -16,
    tail: 15,
    wingY: -1,
    span: 25,
    sweep: 1.2,
    chord: 3.4,
    stabSpan: 5.2,
    stabY: 11,
    engines: false,
  });
}

function drawUav(ctx) {
  fillPath(ctx, (p) => {
    p.moveTo(0, -17);
    p.lineTo(3.5, -4);
    p.lineTo(17, 5);
    p.lineTo(15, 8);
    p.lineTo(3, 3);
    p.lineTo(2.2, 11);
    p.lineTo(6, 15);
    p.lineTo(0, 12.5);
    p.lineTo(-6, 15);
    p.lineTo(-2.2, 11);
    p.lineTo(-3, 3);
    p.lineTo(-15, 8);
    p.lineTo(-17, 5);
    p.lineTo(-3.5, -4);
  });
}

function drawBalloon(ctx) {
  ctx.beginPath();
  ctx.ellipse(0, -6, 10, 11, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillRect(-3, 6, 6, 5);
  ctx.lineWidth = 1.5;
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
    stamp(map, name, "#d7dde6", false, draw);
    stamp(map, `${name}-selected`, "#e8c17a", true, draw);
  }

  map.addSource("airports", { type: "geojson", data: airports });
  map.addLayer(airportCircle("airports-large", ["L"], 1, 4.2, "rgba(232, 193, 122, 0.18)", "rgba(232, 193, 122, 0.85)"));
  map.addLayer(airportCircle("airports-medium", ["M"], 4.2, 3.1, "rgba(244, 241, 234, 0.08)", "rgba(244, 241, 234, 0.42)"));
  map.addLayer(airportCircle("airports-small", ["S", "P"], 7.4, 2.2, "rgba(244, 241, 234, 0.05)", "rgba(244, 241, 234, 0.28)"));
  map.addLayer(airportLabels("airport-labels-large", ["L"], 5.2, 11));
  map.addLayer(airportLabels("airport-labels-medium", ["M"], 7.6, 10));
  map.addLayer(airportLabels("airport-labels-small", ["S", "P"], 10.4, 9));

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
