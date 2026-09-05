import type { Feature } from "geojson";
import { describe, expect, it } from "vitest";

import { canStand, isWithin, overlaps } from "../../src/lib/utils/placement";

const LATITUDE = 43.2567;
const LONGITUDE = 76.9286;

function at(east: number, north: number): [number, number] {
  return [
    LONGITUDE + east / (111320 * Math.cos((LATITUDE * Math.PI) / 180)),
    LATITUDE + north / 110540,
  ];
}

/** Axis-aligned rectangle given by its south-west corner and size, in metres. */
function box(east: number, north: number, width: number, depth: number): Feature {
  return {
    type: "Feature",
    properties: {},
    geometry: {
      type: "Polygon",
      coordinates: [
        [
          at(east, north),
          at(east + width, north),
          at(east + width, north + depth),
          at(east, north + depth),
          at(east, north),
        ],
      ],
    },
  };
}

function line(from: [number, number], to: [number, number]): Feature {
  return {
    type: "Feature",
    properties: {},
    geometry: { type: "LineString", coordinates: [from, to] },
  };
}

const ROOM = box(0, 0, 20, 20);

describe("isWithin", () => {
  it("lets an object stand inside the room", () => {
    expect(isWithin(box(5, 5, 2, 1), ROOM)).toBe(true);
  });

  it("refuses one that hangs over the edge", () => {
    expect(isWithin(box(19, 5, 2, 1), ROOM)).toBe(false);
  });

  it("allows an object flush against the wall of the room", () => {
    expect(isWithin(box(0, 5, 2, 1), ROOM)).toBe(true);
  });

  it("has no opinion without a room", () => {
    expect(isWithin(box(100, 100, 2, 1), null)).toBe(true);
  });
});

describe("overlaps", () => {
  it("sees two objects standing on the same spot", () => {
    expect(overlaps(box(5, 5, 2, 2), box(6, 6, 2, 2))).toBe(true);
  });

  it("lets shelves stand flush against each other", () => {
    expect(overlaps(box(5, 5, 2, 2), box(7, 5, 2, 2))).toBe(false);
  });

  it("leaves a gap alone", () => {
    expect(overlaps(box(5, 5, 2, 2), box(9, 5, 2, 2))).toBe(false);
  });

  it("sees an object sitting across a wall", () => {
    expect(overlaps(box(5, 5, 4, 2), line(at(7, 0), at(7, 20)))).toBe(true);
  });

  it("lets an object stand alongside a wall", () => {
    expect(overlaps(box(5, 5, 2, 2), line(at(7, 0), at(7, 20)))).toBe(false);
  });
});

describe("canStand", () => {
  it("allows a free spot inside the room", () => {
    expect(canStand(box(5, 5, 2, 2), ROOM, [box(10, 10, 2, 2)])).toBe(true);
  });

  it("refuses a spot outside the room even when nothing is there", () => {
    expect(canStand(box(25, 5, 2, 2), ROOM, [])).toBe(false);
  });

  it("refuses a spot taken by a neighbour", () => {
    expect(canStand(box(5, 5, 2, 2), ROOM, [box(6, 6, 2, 2)])).toBe(false);
  });
});
