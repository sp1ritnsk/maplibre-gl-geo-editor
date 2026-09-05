import { describe, expect, it } from "vitest";

import type { Pixel, Segment } from "../../src/lib/utils/guideGeometry";
import { angledRectangleCorners } from "../../src/lib/utils/rectangleGeometry";

const at = (x: number, y: number): Pixel => ({ x, y });

describe("angledRectangleCorners", () => {
  it("builds on the base edge, reaching towards the cursor", () => {
    const base: Segment = [at(0, 0), at(10, 0)];
    expect(angledRectangleCorners(base, at(4, 5))).toEqual([
      at(0, 0),
      at(10, 0),
      at(10, 5),
      at(0, 5),
    ]);
  });

  it("follows the cursor to the other side of the base", () => {
    const base: Segment = [at(0, 0), at(10, 0)];
    const corners = angledRectangleCorners(base, at(4, -3));
    expect(corners?.[2]).toEqual(at(10, -3));
  });

  it("keeps the angle of a base that is not axis aligned", () => {
    // Основание под 45°: стороны обязаны остаться перпендикулярными ему.
    const base: Segment = [at(0, 0), at(10, 10)];
    const corners = angledRectangleCorners(base, at(0, 10));
    const alongX = corners![1].x - corners![0].x;
    const alongY = corners![1].y - corners![0].y;
    const sideX = corners![3].x - corners![0].x;
    const sideY = corners![3].y - corners![0].y;
    expect(alongX * sideX + alongY * sideY).toBeCloseTo(0);
  });

  it("ignores the part of the cursor that runs along the base", () => {
    // Смещение вдоль основания на размер не влияет — только поперёк.
    const base: Segment = [at(0, 0), at(10, 0)];
    const near = angledRectangleCorners(base, at(2, 4));
    const far = angledRectangleCorners(base, at(97, 4));
    expect(near).toEqual(far);
  });

  it("returns nothing for a degenerate base", () => {
    expect(angledRectangleCorners([at(3, 3), at(3, 3)], at(9, 9))).toBeNull();
  });
});
