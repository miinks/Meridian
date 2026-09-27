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

export function drawAircraftIcon(map, id, fill, glow = false) {
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

export function selectedExpression(selectedId, selectedValue, fallback) {
  return ["case", ["==", ["get", "id"], selectedId || ""], selectedValue, fallback];
}

export function installMapLayers(map, airports = EMPTY) {
  drawAircraftIcon(map, "plane", "#d7dde6");
  drawAircraftIcon(map, "plane-selected", "#e8c17a", true);

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
}
