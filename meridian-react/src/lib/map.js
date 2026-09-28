import { EMPTY } from "./format.js";

export const AIRPORT_LAYERS = ["airports-large", "airports-medium", "airports-small"];

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

export function drawAircraftIcon(map, id, fill, { glow = false, kind = "medium" } = {}) {
  const size = 64;
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
  ctx.beginPath();
  if (kind === "rotor") {
    ctx.arc(0, 0, 3.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = fill;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-14, 0);
    ctx.lineTo(14, 0);
    ctx.moveTo(0, -14);
    ctx.lineTo(0, 14);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, 2);
    ctx.lineTo(2.5, 11);
    ctx.lineTo(-2.5, 11);
    ctx.closePath();
    ctx.fill();
  } else {
    const wing = kind === "heavy" ? 17 : kind === "light" ? 9 : 13;
    const nose = kind === "heavy" ? -17 : kind === "light" ? -12 : -15;
    const tail = kind === "heavy" ? 12 : kind === "light" ? 8 : 10;
    ctx.moveTo(0, nose);
    ctx.lineTo(kind === "heavy" ? 5 : 3.2, nose + 11);
    ctx.lineTo(wing, 1);
    ctx.lineTo(kind === "heavy" ? 5 : 3.5, -1);
    ctx.lineTo(2.4, tail - 1);
    ctx.lineTo(kind === "heavy" ? 8 : 5.5, tail + 3);
    ctx.lineTo(0, tail);
    ctx.lineTo(kind === "heavy" ? -8 : -5.5, tail + 3);
    ctx.lineTo(-2.4, tail - 1);
    ctx.lineTo(kind === "heavy" ? -5 : -3.5, -1);
    ctx.lineTo(-wing, 1);
    ctx.lineTo(kind === "heavy" ? -5 : -3.2, nose + 11);
    ctx.closePath();
    ctx.fill();
  }
  if (map.hasImage(id)) map.removeImage(id);
  map.addImage(id, ctx.getImageData(0, 0, size, size), { pixelRatio: 2 });
}

export function planeImageExpression(selectedId) {
  const selected = selectedId || "";
  return [
    "case",
    ["==", ["get", "id"], selected],
    ["match", ["get", "kind"], "light", "plane-light-selected", "heavy", "plane-heavy-selected", "rotor", "plane-rotor-selected", "plane-selected"],
    ["match", ["get", "kind"], "light", "plane-light", "heavy", "plane-heavy", "rotor", "plane-rotor", "plane"],
  ];
}

export function planeSizeExpression(selectedId) {
  return [
    "*",
    ["get", "iconSize"],
    ["interpolate", ["linear"], ["zoom"], 2, 2.15, 5, 1.55, 8, 1.18, 12, 1],
    ["case", ["==", ["get", "id"], selectedId || ""], 1.32, 1],
  ];
}

export function installMapLayers(map, airports = EMPTY) {
  const kinds = [
    ["plane-light", "#d7dde6", { kind: "light" }],
    ["plane", "#d7dde6", { kind: "medium" }],
    ["plane-heavy", "#d7dde6", { kind: "heavy" }],
    ["plane-rotor", "#d7dde6", { kind: "rotor" }],
    ["plane-light-selected", "#e8c17a", { kind: "light", glow: true }],
    ["plane-selected", "#e8c17a", { kind: "medium", glow: true }],
    ["plane-heavy-selected", "#e8c17a", { kind: "heavy", glow: true }],
    ["plane-rotor-selected", "#e8c17a", { kind: "rotor", glow: true }],
  ];
  for (const [id, fill, options] of kinds) drawAircraftIcon(map, id, fill, options);

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
      "icon-image": planeImageExpression(""),
      "icon-rotate": ["get", "heading"],
      "icon-rotation-alignment": "map",
      "icon-allow-overlap": true,
      "icon-ignore-placement": true,
      "icon-size": planeSizeExpression(""),
    },
    paint: {
      "icon-opacity": ["case", ["get", "onGround"], 0.28, 0.92],
    },
  });
}
