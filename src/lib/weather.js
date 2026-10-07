export const METAR_MS = 5 * 60 * 1000;

export const FLT_CAT_PAINT = {
  VFR: { fill: "rgba(110, 176, 122, 0.22)", stroke: "rgba(110, 176, 122, 0.95)" },
  MVFR: { fill: "rgba(90, 148, 210, 0.22)", stroke: "rgba(90, 148, 210, 0.95)" },
  IFR: { fill: "rgba(214, 110, 110, 0.22)", stroke: "rgba(214, 110, 110, 0.95)" },
  LIFR: { fill: "rgba(186, 120, 196, 0.22)", stroke: "rgba(186, 120, 196, 0.95)" },
};

export function isImportantAirport(airport, runways) {
  return airport?.type === "L" || Boolean(airport?.ident && runways?.has(airport.ident));
}

export function weatherFillExpression(_selected, fallback) {
  return [
    "case",
    ["==", ["feature-state", "fltCat"], "LIFR"],
    FLT_CAT_PAINT.LIFR.fill,
    ["==", ["feature-state", "fltCat"], "IFR"],
    FLT_CAT_PAINT.IFR.fill,
    ["==", ["feature-state", "fltCat"], "MVFR"],
    FLT_CAT_PAINT.MVFR.fill,
    ["==", ["feature-state", "fltCat"], "VFR"],
    FLT_CAT_PAINT.VFR.fill,
    fallback,
  ];
}

export function weatherStrokeExpression(selected, fallback) {
  return [
    "case",
    ["==", ["get", "ident"], selected || ""],
    "rgba(232, 193, 122, 1)",
    ["==", ["feature-state", "fltCat"], "LIFR"],
    FLT_CAT_PAINT.LIFR.stroke,
    ["==", ["feature-state", "fltCat"], "IFR"],
    FLT_CAT_PAINT.IFR.stroke,
    ["==", ["feature-state", "fltCat"], "MVFR"],
    FLT_CAT_PAINT.MVFR.stroke,
    ["==", ["feature-state", "fltCat"], "VFR"],
    FLT_CAT_PAINT.VFR.stroke,
    fallback,
  ];
}

function round(value) {
  return Number.isFinite(value) ? Math.round(value) : null;
}

export function formatMetarWind(metar) {
  if (!metar) return "—";
  if (!Number.isFinite(metar.wspd) || metar.wspd === 0) return "Calm";
  const variable = metar.wdir == null || metar.wdir === "" || Number(metar.wdir) === 0;
  const dir = variable ? "VRB" : `${round(metar.wdir)}°`;
  const gust = Number.isFinite(metar.wgst) ? `G${round(metar.wgst)}` : "";
  return `${dir} ${round(metar.wspd)}${gust} kt`;
}

export function formatMetarVisibility(metar) {
  if (!metar?.vis && !Number.isFinite(metar?.visSm)) return "—";
  if (typeof metar.vis === "string" && metar.vis.includes("+")) return `${metar.vis} SM`;
  if (Number.isFinite(metar.visSm)) {
    const miles = metar.visSm >= 10 ? String(Math.round(metar.visSm)) : metar.visSm.toFixed(1).replace(/\.0$/, "");
    return `${miles} SM`;
  }
  return `${metar.vis} SM`;
}

export function formatMetarCeiling(metar) {
  if (Number.isFinite(metar?.base) && metar.cover) {
    return `${metar.cover} ${Math.round(metar.base).toLocaleString()} ft`;
  }
  if (metar?.cover) return metar.cover;
  return "Clear";
}

export function formatMetarTemp(metar) {
  if (!Number.isFinite(metar?.temp)) return "—";
  const dew = Number.isFinite(metar.dewp) ? ` / ${round(metar.dewp)}°C` : "";
  return `${round(metar.temp)}°C${dew}`;
}

export function formatMetarAltimeter(metar) {
  if (!Number.isFinite(metar?.altim)) return "—";
  return `${metar.altim.toFixed(2)} inHg`;
}

export function formatMetarTime(metar) {
  if (!metar?.time) return "—";
  const date = new Date(metar.time);
  if (Number.isNaN(date.getTime())) return "—";
  const hh = String(date.getUTCHours()).padStart(2, "0");
  const mm = String(date.getUTCMinutes()).padStart(2, "0");
  return `${hh}:${mm}Z`;
}

export function formatMetarRaw(metar) {
  return (metar?.raw || "").replace(/^(METAR|SPECI)\s+/i, "") || "—";
}

export function formatMetarSummary(metar) {
  if (!metar) return "";
  const parts = [metar.cat, formatMetarWind(metar), metar.wx].filter((part) => part && part !== "—");
  return parts.join(" · ");
}

export function metarFacts(metar, { loaded } = {}) {
  if (!metar) return [["Weather", loaded ? "No METAR" : "Looking up…"]];
  return [
    ["Weather", metar.cat || "—"],
    ["Wind", formatMetarWind(metar)],
    ["Visibility", formatMetarVisibility(metar)],
    ["Ceiling", formatMetarCeiling(metar)],
    ["Temp / dew", formatMetarTemp(metar)],
    ["Altimeter", formatMetarAltimeter(metar)],
    ["Observed", formatMetarTime(metar)],
    ["METAR", formatMetarRaw(metar)],
  ];
}
