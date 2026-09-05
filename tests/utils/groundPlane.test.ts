import { describe, expect, it } from "vitest";

import { frameAt, toGround, toPosition } from "../../src/lib/utils/groundPlane";

const ALMATY: [number, number] = [76.9286, 43.2567];

describe("ground plane", () => {
  it("returns to the same position it started from", () => {
    const frame = frameAt(ALMATY);
    const there: [number, number] = [76.929, 43.2571];
    const back = toPosition(toGround(there, frame), frame);
    expect(back[0]).toBeCloseTo(there[0], 9);
    expect(back[1]).toBeCloseTo(there[1], 9);
  });

  it("measures ten metres east as ten metres", () => {
    const frame = frameAt(ALMATY);
    const east = toPosition({ x: 10, y: 0 }, frame);
    expect(toGround(east, frame).x).toBeCloseTo(10, 6);
  });

  it("keeps a right angle a right angle", () => {
    const frame = frameAt(ALMATY);
    const east = toGround(toPosition({ x: 10, y: 0 }, frame), frame);
    const north = toGround(toPosition({ x: 0, y: 10 }, frame), frame);
    expect(east.x * north.x + east.y * north.y).toBeCloseTo(0, 6);
  });
});
