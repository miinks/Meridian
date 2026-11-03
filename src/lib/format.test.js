import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { distanceKm, formatDistance, headingAgreesWith, routeFacts } from "./format.js";

const here = { latitude: 40, longitude: -90 };
const north = { latitude: 41, longitude: -90, code: "ORD" };
const south = { latitude: 39, longitude: -90, code: "MSY" };
const remainingNorth = formatDistance(distanceKm(here.latitude, here.longitude, north.latitude, north.longitude));

function plane(overrides = {}) {
  return {
    ...here,
    heading: 0,
    onGround: false,
    speedMs: 200,
    ...overrides,
  };
}

describe("headingAgreesWith", () => {
  it("rejects missing flight or place", () => {
    assert.equal(headingAgreesWith(null, north), false);
    assert.equal(headingAgreesWith(plane(), null), false);
  });

  it("treats a plane on the ground as agreeing", () => {
    assert.equal(headingAgreesWith(plane({ heading: 180, onGround: true }), north), true);
  });

  it("agrees when heading points at the place, including across 360°", () => {
    assert.equal(headingAgreesWith(plane({ heading: 0 }), north), true);
    assert.equal(headingAgreesWith(plane({ heading: 70 }), north), true);
    assert.equal(headingAgreesWith(plane({ heading: 350 }), north), true);
  });

  it("disagrees when heading is well off the bearing", () => {
    assert.equal(headingAgreesWith(plane({ heading: 80 }), north), false);
    assert.equal(headingAgreesWith(plane({ heading: 180 }), north), false);
  });
});

describe("routeFacts", () => {
  it("labels the callsign path as a typical route", () => {
    const facts = routeFacts(plane(), { origin: { code: "LAS" }, destination: north });
    assert.deepEqual(facts[0], ["Typical route", "LAS → ORD"]);
  });

  it("holds the lookup state until a route arrives", () => {
    assert.deepEqual(routeFacts(plane(), undefined), [
      ["Typical route", "Looking up…"],
      ["ETA", "Looking up…"],
      ["Remaining", "—"],
    ]);
  });

  it("hides ETA when heading does not match the typical destination", () => {
    const facts = routeFacts(plane({ heading: 180 }), { origin: { code: "LAS" }, destination: north });
    assert.deepEqual(facts, [
      ["Typical route", "LAS → ORD"],
      ["ETA", "Off typical routing"],
      ["Remaining", remainingNorth],
    ]);
  });

  it("keeps remaining distance even when routing is off", () => {
    const facts = Object.fromEntries(
      routeFacts(plane({ heading: 180 }), { destination: north }),
    );
    assert.equal(facts.ETA, "Off typical routing");
    assert.match(facts.Remaining, /^\d+ km$/);
  });

  it("says arrived when on the ground at the destination", () => {
    const facts = Object.fromEntries(
      routeFacts(plane({ latitude: 40.02, heading: 180, onGround: true }), { destination: here }),
    );
    assert.equal(facts.ETA, "Arrived");
  });

  it("shows a real ETA only when heading matches the destination", () => {
    const facts = Object.fromEntries(routeFacts(plane({ heading: 0 }), { destination: north }));
    assert.notEqual(facts.ETA, "Off typical routing");
    assert.notEqual(facts.ETA, "—");
    assert.equal(facts.Remaining, remainingNorth);
  });

  it("does not invent a destination", () => {
    const facts = routeFacts(plane(), { origin: { code: "LAS" } });
    assert.deepEqual(facts, [
      ["Typical route", "LAS → —"],
      ["ETA", "—"],
      ["Remaining", "—"],
    ]);
  });

  it("shows no ETA when the plane is on the ground far from the destination", () => {
    const facts = Object.fromEntries(
      routeFacts(plane({ heading: 180, onGround: true }), { destination: south }),
    );
    assert.equal(facts.ETA, "—");
  });
});
