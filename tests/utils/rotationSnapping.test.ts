import { describe, expect, it } from "vitest";

import {
  directionDelta,
  directionOf,
  fold,
  principalDirection,
  snapRotation,
} from "../../src/lib/utils/rotationSnapping";

const LATITUDE = 43.2567;
const LONGITUDE = 76.9286;

/** A point offset from the origin by metres east and north. */
function at(east: number, north: number): [number, number] {
  return [
    LONGITUDE + east / (111320 * Math.cos((LATITUDE * Math.PI) / 180)),
    LATITUDE + north / 110540,
  ];
}

describe("directionOf", () => {
  it("reads due east as 90 degrees", () => {
    expect(directionOf(at(0, 0), at(10, 0))).toBeCloseTo(90, 1);
  });

  it("reads due north as 0 degrees", () => {
    expect(directionOf(at(0, 0), at(0, 10))).toBeCloseTo(0, 1);
  });

  // Not exactly equal: the longitude scale is taken at the first point of the
  // edge, and the two directions start from different ends. The gap is around
  // a hundred-thousandth of a degree over ten metres, far below any tolerance
  // a hand can hold.
  it("gives an edge and the same edge reversed one direction", () => {
    const forward = directionOf(at(0, 0), at(10, 6));
    const backward = directionOf(at(10, 6), at(0, 0));

    expect(forward).toBeCloseTo(backward, 3);
  });
});

describe("fold", () => {
  it("keeps every angle inside [0, 180)", () => {
    expect(fold(200)).toBeCloseTo(20, 6);
    expect(fold(-30)).toBeCloseTo(150, 6);
    expect(fold(180)).toBeCloseTo(0, 6);
  });
});

describe("directionDelta", () => {
  it("takes the short way round", () => {
    expect(directionDelta(170, 10)).toBeCloseTo(20, 6);
    expect(directionDelta(10, 170)).toBeCloseTo(-20, 6);
  });
});

describe("principalDirection", () => {
  it("takes the longest edge, not the first", () => {
    const ring = [at(0, 0), at(1, 0), at(1, 8), at(0, 8), at(0, 0)];

    expect(principalDirection(ring)).toBeCloseTo(0, 1);
  });

  it("has no direction without edges", () => {
    expect(principalDirection([at(0, 0)])).toBeNull();
  });
});

describe("snapRotation", () => {
  const WALL = 30;

  it("pulls a near-parallel turn onto the wall", () => {
    const snapped = snapRotation(0, 27, [WALL], 5);

    expect(snapped.angle).toBeCloseTo(30, 6);
    expect(snapped.target).toBeCloseTo(30, 6);
  });

  it("pulls onto the perpendicular just as readily", () => {
    const snapped = snapRotation(0, 118, [WALL], 5);

    expect(snapped.angle).toBeCloseTo(120, 6);
    expect(snapped.target).toBeCloseTo(120, 6);
  });

  it("leaves a turn that is nowhere near anything alone", () => {
    const snapped = snapRotation(0, 70, [WALL], 5);

    expect(snapped.angle).toBe(70);
    expect(snapped.target).toBeNull();
  });

  it("accounts for the direction the object already faces", () => {
    const snapped = snapRotation(90, -63, [WALL], 5);

    expect(snapped.angle).toBeCloseTo(-60, 6);
    expect(snapped.target).toBeCloseTo(30, 6);
  });

  it("has nothing to snap to on an empty plan", () => {
    expect(snapRotation(0, 27, [], 5)).toEqual({ angle: 27, target: null });
  });
});
