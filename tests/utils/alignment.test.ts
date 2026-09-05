import { describe, expect, it } from "vitest";

import { alignShape } from "../../src/lib/utils/alignment";
import type { Pixel, Segment } from "../../src/lib/utils/guideGeometry";

const at = (x: number, y: number): Pixel => ({ x, y });

/** Corners of an axis-aligned box, south-west corner first. */
function box(x: number, y: number, width: number, depth: number): Pixel[] {
  return [at(x, y), at(x + width, y), at(x + width, y + depth), at(x, y + depth)];
}

/** Edges of a box, for use as a neighbour. */
function edgesOf(corners: Pixel[]): Segment[] {
  return corners.map((corner, index): Segment => [
    corner,
    corners[(index + 1) % corners.length],
  ]);
}

const WALL: Segment = [at(0, 10), at(50, 10)];

describe("alignShape", () => {
  it("finds nothing when no corner is within tolerance", () => {
    expect(alignShape(box(5, 5, 2, 1), [WALL], 0.5)).toBeNull();
  });

  it("puts a corner onto the continuation of an edge", () => {
    // The shelf's back is 0.3 short of the wall line.
    const result = alignShape(box(5, 9.4, 2, 0.3), [WALL], 0.5);
    expect(result).not.toBeNull();
    expect(result!.shift.x).toBeCloseTo(0);
    expect(result!.shift.y).toBeCloseTo(0.3);
    expect(result!.guides).toEqual([WALL]);
  });

  it("reaches past the end of the edge: one row with a neighbour far away", () => {
    const neighbour = edgesOf(box(0, 0, 1, 0.5));
    const result = alignShape(box(20, 0.2, 1, 0.5), neighbour, 0.5);
    expect(result).not.toBeNull();
    // Pulled down onto the neighbour's bottom edge, the closest line.
    expect(result!.shift.y).toBeCloseTo(-0.2);
    expect(result!.shift.x).toBeCloseTo(0);
  });

  it("pins along a second, non-parallel edge when one is in reach", () => {
    // Wall along y = 10, a partition along x = 3; the shelf is 0.2 off both.
    const partition: Segment = [at(3, 0), at(3, 20)];
    const result = alignShape(box(3.2, 9.4, 2, 0.4), [WALL, partition], 0.5);
    expect(result).not.toBeNull();
    expect(result!.shift.y).toBeCloseTo(0.2);
    expect(result!.shift.x).toBeCloseTo(-0.2);
    expect(result!.guides).toHaveLength(2);
  });

  it("does not use a parallel edge as the second constraint", () => {
    const other: Segment = [at(0, 12), at(50, 12)];
    const result = alignShape(box(5, 9.7, 2, 2), [WALL, other], 0.5);
    expect(result).not.toBeNull();
    // Only the wall: the far edge is parallel and would say nothing new.
    expect(result!.guides).toEqual([WALL]);
    expect(result!.shift.y).toBeCloseTo(0.3);
  });

  it("prefers corner to corner over corner to edge", () => {
    const neighbour = edgesOf(box(0, 0, 1, 0.5));
    // South-west corner 0.1 from the neighbour's south-east corner.
    const result = alignShape(box(1.1, 0.05, 1, 0.5), neighbour, 0.5);
    expect(result).not.toBeNull();
    expect(result!.shift.x).toBeCloseTo(-0.1);
    expect(result!.shift.y).toBeCloseTo(-0.05);
    expect(result!.guides).toHaveLength(2);
  });

  it("handles a rotated shape against a rotated wall", () => {
    // Wall at 45°, shelf corner just short of its line.
    const wall: Segment = [at(0, 0), at(10, 10)];
    const vertices = [at(4, 4.2), at(6, 6.2), at(5.5, 6.7), at(3.5, 4.7)];
    const result = alignShape(vertices, [wall], 0.5);
    expect(result).not.toBeNull();
    // Shift is perpendicular to the wall: equal and opposite components.
    expect(result!.shift.x).toBeCloseTo(0.1);
    expect(result!.shift.y).toBeCloseTo(-0.1);
  });
});
