import { EMPTY } from "./format.js";

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

export function installMapLayers(map) {
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
}
