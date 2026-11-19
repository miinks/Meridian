import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { categoryLabel, formatAircraft } from "./identity.js";

describe("formatAircraft", () => {
  it("prefers manufacturer, model, and typecode", () => {
    assert.equal(
      formatAircraft({ manufacturer: "Boeing", model: "737-800", typecode: "B738" }, 0),
      "Boeing 737-800 (B738)",
    );
  });

  it("does not repeat the manufacturer when the model already includes it", () => {
    assert.equal(
      formatAircraft({ manufacturer: "Cessna", model: "Cessna Citation III", typecode: "C650" }, 0),
      "Cessna Citation III (C650)",
    );
  });

  it("falls back to model, then typecode", () => {
    assert.equal(formatAircraft({ model: "A320", typecode: "A320" }, 4), "A320 (A320)");
    assert.equal(formatAircraft({ model: "A320" }, 4), "A320");
    assert.equal(formatAircraft({ typecode: "B77W" }, 6), "B77W");
  });

  it("uses the OpenSky category when the type is unknown", () => {
    assert.equal(formatAircraft({}, 6), "Heavy aircraft");
    assert.equal(formatAircraft(null, 8), "Rotorcraft");
    assert.equal(formatAircraft(undefined, 14), "UAV");
  });

  it("never prints Unknown type", () => {
    for (const category of [0, 1, 13, 15, "", null, undefined, "Aircraft"]) {
      const label = formatAircraft({}, category);
      assert.notEqual(label, "Unknown type");
      assert.equal(label, "Aircraft");
    }
  });
});

describe("categoryLabel", () => {
  it("names the usual OpenSky categories", () => {
    assert.equal(categoryLabel(2), "Light aircraft");
    assert.equal(categoryLabel(4), "Large aircraft");
    assert.equal(categoryLabel(6), "Heavy aircraft");
    assert.equal(categoryLabel(8), "Rotorcraft");
  });
});
