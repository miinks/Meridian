import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { activateSearchItem, isPickableResult, moveSearchActive } from "./search.js";

const items = [
  { kind: "flight", id: "abc" },
  { kind: "empty", text: "none" },
  { kind: "airport", id: "KJFK" },
  { kind: "worldwide", query: "UAL" },
];

describe("moveSearchActive", () => {
  it("skips empty rows and wraps", () => {
    assert.equal(moveSearchActive(items, -1, 1), 0);
    assert.equal(moveSearchActive(items, 0, 1), 2);
    assert.equal(moveSearchActive(items, 2, 1), 3);
    assert.equal(moveSearchActive(items, 3, 1), 0);
    assert.equal(moveSearchActive(items, 0, -1), 3);
  });

  it("returns -1 when nothing is pickable", () => {
    assert.equal(moveSearchActive([{ kind: "empty" }], -1, 1), -1);
    assert.equal(moveSearchActive([], -1, 1), -1);
  });
});

describe("activateSearchItem", () => {
  it("routes flights, airports, and world scans", () => {
    const calls = [];
    const handlers = {
      onPick: (id) => calls.push(["flight", id]),
      onPickAirport: (id) => calls.push(["airport", id]),
      onWorldwide: () => calls.push(["world"]),
    };
    assert.equal(activateSearchItem(items[0], handlers), true);
    assert.equal(activateSearchItem(items[2], handlers), true);
    assert.equal(activateSearchItem(items[3], handlers), true);
    assert.equal(activateSearchItem(items[1], handlers), false);
    assert.deepEqual(calls, [
      ["flight", "abc"],
      ["airport", "KJFK"],
      ["world"],
    ]);
  });

  it("knows which rows can be chosen", () => {
    assert.equal(isPickableResult(items[0]), true);
    assert.equal(isPickableResult(items[1]), false);
  });
});
