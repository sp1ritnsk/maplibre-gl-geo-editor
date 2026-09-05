import { describe, expect, it } from "vitest";

import {
  distanceToLine,
  extend,
  footOnLine,
  lineIntersection,
  midpoint,
  type Pixel,
  type Segment,
} from "../../src/lib/utils/guideGeometry";

const at = (x: number, y: number): Pixel => ({ x, y });

describe("footOnLine", () => {
  it("reaches past the end of the segment", () => {
    const edge: Segment = [at(0, 0), at(10, 0)];
    expect(footOnLine(at(50, 4), edge)).toEqual(at(50, 0));
  });

  it("returns nothing for a degenerate edge", () => {
    expect(footOnLine(at(5, 5), [at(1, 1), at(1, 1)])).toBeNull();
  });
});

describe("distanceToLine", () => {
  it("measures to the continuation, not to the nearest end", () => {
    expect(distanceToLine(at(100, 3), [at(0, 0), at(10, 0)])).toBeCloseTo(3);
  });
});

describe("lineIntersection", () => {
  it("crosses two continuations well away from both edges", () => {
    const across: Segment = [at(0, 0), at(10, 0)];
    const down: Segment = [at(50, 40), at(50, 60)];
    expect(lineIntersection(across, down)).toEqual(at(50, 0));
  });

  it("returns nothing for parallel edges", () => {
    expect(
      lineIntersection([at(0, 0), at(10, 0)], [at(0, 5), at(10, 5)]),
    ).toBeNull();
  });

  it("returns nothing for near-parallel edges, where the point is meaningless", () => {
    expect(
      lineIntersection([at(0, 0), at(1000, 0)], [at(0, 5), at(1000, 6)]),
    ).toBeNull();
  });
});

describe("midpoint", () => {
  it("halves the edge", () => {
    expect(midpoint([at(0, 0), at(10, 4)])).toEqual(at(5, 2));
  });
});

describe("extend", () => {
  it("keeps the direction and grows around the middle", () => {
    const stretched = extend([at(0, 0), at(10, 0)], 100);
    expect(stretched).toEqual([at(-95, 0), at(105, 0)]);
  });

  it("returns nothing for a degenerate edge", () => {
    expect(extend([at(3, 3), at(3, 3)], 100)).toBeNull();
  });
});
