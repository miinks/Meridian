import { EMPTY } from "./format.js";

function stamp(map, id, fill, glow, draw) {
  const size = 80;
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

function drawJet(ctx) {
  fillPath(ctx, (p) => {
    p.moveTo(0, -16);
    p.lineTo(4, -5);
    p.lineTo(14, 1);
    p.lineTo(4, -1);
    p.lineTo(2, 10);
    p.lineTo(6, 13);
    p.lineTo(0, 11);
    p.lineTo(-6, 13);
    p.lineTo(-2, 10);
    p.lineTo(-4, -1);
    p.lineTo(-14, 1);
    p.lineTo(-4, -5);
  });
}

function drawHeavy(ctx) {
  fillPath(ctx, (p) => {
    p.moveTo(0, -17);
    p.lineTo(5, -6);
    p.lineTo(17, 2);
    p.lineTo(5, 0);
    p.lineTo(3, 9);
    p.lineTo(8, 13);
    p.lineTo(0, 11);
    p.lineTo(-8, 13);
    p.lineTo(-3, 9);
    p.lineTo(-5, 0);
    p.lineTo(-17, 2);
    p.lineTo(-5, -6);
  });
}

function drawSmall(ctx) {
  fillPath(ctx, (p) => {
    p.moveTo(0, -13);
    p.lineTo(3, -4);
    p.lineTo(11, 1);
    p.lineTo(3, 0);
    p.lineTo(2, 8);
    p.lineTo(5, 11);
    p.lineTo(0, 9);
    p.lineTo(-5, 11);
    p.lineTo(-2, 8);
    p.lineTo(-3, 0);
    p.lineTo(-11, 1);
    p.lineTo(-3, -4);
  });
}

function drawRotor(ctx) {
  ctx.save();
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.ellipse(0, -6, 16, 3.5, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(-16, -6);
  ctx.lineTo(16, -6);
  ctx.stroke();
  fillPath(ctx, (p) => {
    p.moveTo(-5, -2);
    p.lineTo(5, -2);
    p.lineTo(4, 8);
    p.lineTo(0, 12);
    p.lineTo(-4, 8);
  });
  ctx.beginPath();
  ctx.moveTo(0, 10);
  ctx.lineTo(12, 14);
  ctx.lineTo(12, 11);
  ctx.stroke();
  ctx.restore();
}

function drawGlider(ctx) {
  fillPath(ctx, (p) => {
    p.moveTo(0, -12);
    p.lineTo(2, -3);
    p.lineTo(20, 2);
    p.lineTo(2, 1);
    p.lineTo(1, 10);
    p.lineTo(5, 12);
    p.lineTo(0, 10);
    p.lineTo(-5, 12);
    p.lineTo(-1, 10);
    p.lineTo(-2, 1);
    p.lineTo(-20, 2);
    p.lineTo(-2, -3);
  });
}

function drawUav(ctx) {
  fillPath(ctx, (p) => {
    p.moveTo(0, -12);
    p.lineTo(14, 8);
    p.lineTo(0, 4);
    p.lineTo(-14, 8);
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

export function installMapLayers(map) {
  for (const [name, draw] of Object.entries(ICONS)) {
    stamp(map, name, "#d7dde6", false, draw);
    stamp(map, `${name}-selected`, "#e8c17a", true, draw);
  }

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
