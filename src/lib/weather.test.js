import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  formatMetarAltimeter,
  formatMetarCeiling,
  formatMetarRaw,
  formatMetarSummary,
  formatMetarTemp,
  formatMetarTime,
  formatMetarVisibility,
  formatMetarWind,
  metarFacts,
} from "./weather.js";

const vfr = {
  cat: "VFR",
  wspd: 12,
  wdir: 270,
  wgst: 20,
  visSm: 10,
  vis: "10+",
  cover: "BKN",
  base: 500,
  temp: 12.4,
  dewp: 7.6,
  altim: 29.92,
  time: "2026-03-15T14:07:00Z",
  wx: "-RA",
  raw: "METAR KIAH 151407Z 27012G20KT 10SM -RA BKN005 12/08 A2992",
};

describe("METAR formatting", () => {
  it("formats wind, including calm, variable, and gusts", () => {
    assert.equal(formatMetarWind(null), "—");
    assert.equal(formatMetarWind({ wspd: 0, wdir: 270 }), "Calm");
    assert.equal(formatMetarWind({ wspd: 8, wdir: 0 }), "VRB 8 kt");
    assert.equal(formatMetarWind({ wspd: 8, wdir: null }), "VRB 8 kt");
    assert.equal(formatMetarWind(vfr), "270° 12G20 kt");
  });

  it("formats visibility in statute miles", () => {
    assert.equal(formatMetarVisibility(null), "—");
    assert.equal(formatMetarVisibility({ vis: "10+" }), "10+ SM");
    assert.equal(formatMetarVisibility({ visSm: 10 }), "10 SM");
    assert.equal(formatMetarVisibility({ visSm: 3.5 }), "3.5 SM");
  });

  it("formats ceiling or clear skies", () => {
    assert.equal(formatMetarCeiling({}), "Clear");
    assert.equal(formatMetarCeiling({ cover: "CLR" }), "CLR");
    assert.equal(formatMetarCeiling({ cover: "OVC", base: 500 }), "OVC 500 ft");
  });

  it("formats temp, altimeter, time, and raw METAR", () => {
    assert.equal(formatMetarTemp({}), "—");
    assert.equal(formatMetarTemp(vfr), "12°C / 8°C");
    assert.equal(formatMetarAltimeter(vfr), "29.92 inHg");
    assert.equal(formatMetarTime(vfr), "14:07Z");
    assert.equal(formatMetarTime({ time: "not-a-date" }), "—");
    assert.equal(formatMetarRaw(vfr), "KIAH 151407Z 27012G20KT 10SM -RA BKN005 12/08 A2992");
    assert.equal(formatMetarRaw({ raw: "SPECI KHOU 151400Z" }), "KHOU 151400Z");
  });

  it("summarizes category, wind, and weather", () => {
    assert.equal(formatMetarSummary(null), "");
    assert.equal(formatMetarSummary(vfr), "VFR · 270° 12G20 kt · -RA");
    assert.equal(formatMetarSummary({ cat: "IFR", wspd: 0 }), "IFR · Calm");
  });

  it("builds sheet facts, including empty and loading states", () => {
    assert.deepEqual(metarFacts(null), [["Weather", "Looking up…"]]);
    assert.deepEqual(metarFacts(null, { loaded: true }), [["Weather", "No METAR"]]);
    assert.deepEqual(metarFacts(vfr), [
      ["Weather", "VFR"],
      ["Wind", "270° 12G20 kt"],
      ["Visibility", "10+ SM"],
      ["Ceiling", "BKN 500 ft"],
      ["Temp / dew", "12°C / 8°C"],
      ["Altimeter", "29.92 inHg"],
      ["Observed", "14:07Z"],
      ["METAR", "KIAH 151407Z 27012G20KT 10SM -RA BKN005 12/08 A2992"],
    ]);
  });
});
