import { describe, expect, it } from "vitest";

import {
  cornerAt,
  footOnRay,
  lockedDirection,
  lockedVertexPositions,
} from "../../src/lib/utils/angleLock";
import type { Ground } from "../../src/lib/utils/groundPlane";

const at = (x: number, y: number): Ground => ({ x, y });
const QUARTER = Math.PI / 2;
const STEP = 45;

/** Square corners A(0,0) B(10,0) C(10,10) D(0,10), walked anticlockwise. */
const SQUARE = [at(0, 0), at(10, 0), at(10, 10), at(0, 10)];

describe("lockedDirection", () => {
  it("takes the nearest whole step from the reference", () => {
    expect(lockedDirection(0, 0.4 * QUARTER, QUARTER)).toBeCloseTo(0);
    expect(lockedDirection(0, 0.6 * QUARTER, QUARTER)).toBeCloseTo(QUARTER);
  });

  it("counts steps from the reference, not from the axes", () => {
    // Reference at 10°, cursor at 98°: the nearest step is 10 + 90.
    const base = (10 * Math.PI) / 180;
    const wanted = (98 * Math.PI) / 180;
    expect((lockedDirection(base, wanted, QUARTER) * 180) / Math.PI).toBeCloseTo(100);
  });
});

describe("footOnRay", () => {
  it("slides along the locked line instead of holding a distance", () => {
    expect(footOnRay(at(0, 0), 0, at(7, 3))).toEqual({ x: 7, y: 0 });
  });

  it("reaches behind the origin", () => {
    expect(footOnRay(at(0, 0), 0, at(-4, 2))).toEqual({ x: -4, y: 0 });
  });
});

describe("lockedVertexPositions", () => {
  it("squares up a corner dragged off true", () => {
    // C is dragged to (10.4, 9.6); its sides must meet B and D at right angles.
    const corner = cornerAt(SQUARE, 2, true);
    const positions = lockedVertexPositions(corner, at(10.4, 9.6), STEP);

    // Perpendicular to A->B through B: the line x = 10.
    expect(positions).toContainEqual({ x: 10, y: 9.6 });
    // Perpendicular to A->D through D: the line y = 10.
    expect(positions.some((p) => Math.abs(p.x - 10.4) < 1e-9 && Math.abs(p.y - 10) < 1e-9)).toBe(
      true,
    );
    // And the crossing of both: the exact corner.
    expect(positions.some((p) => Math.abs(p.x - 10) < 1e-9 && Math.abs(p.y - 10) < 1e-9)).toBe(true);
  });

  it("offers a 45° side, not only right angles", () => {
    const corner = cornerAt(SQUARE, 2, true);
    // Dragged out beyond B, close to the diagonal leaving it: the line y = x - 10.
    const positions = lockedVertexPositions(corner, at(14.1, 3.9), STEP);
    const diagonal = positions.find((p) => Math.abs(p.x - p.y - 10) < 1e-9);

    expect(diagonal!.x).toBeCloseTo(14, 9);
    expect(diagonal!.y).toBeCloseTo(4, 9);
  });

  it("keeps the shape's own bearing: a building askew to north", () => {
    // The same square turned by 20°.
    const turn = (20 * Math.PI) / 180;
    const spun = SQUARE.map((point) => ({
      x: point.x * Math.cos(turn) - point.y * Math.sin(turn),
      y: point.x * Math.sin(turn) + point.y * Math.cos(turn),
    }));
    const corner = cornerAt(spun, 2, true);
    const cursor = { x: spun[2].x + 0.3, y: spun[2].y - 0.2 };

    const positions = lockedVertexPositions(corner, cursor, STEP);
    const square = positions.find(
      (p) => Math.abs(p.x - spun[2].x) < 1e-9 && Math.abs(p.y - spun[2].y) < 1e-9,
    );

    // The crossing is the corner the shape was drawn with, not an axis-aligned one.
    expect(square).toBeDefined();
  });

  it("has nothing to say without a reference side", () => {
    const line = [at(0, 0), at(10, 0)];
    expect(lockedVertexPositions(cornerAt(line, 1, false), at(9, 4), STEP)).toEqual([]);
  });

  it("locks the one side an open line's end does have", () => {
    const line = [at(0, 0), at(10, 0), at(20, 0)];
    // Dragging the far end: only the side arriving at it has a reference.
    const positions = lockedVertexPositions(cornerAt(line, 2, false), at(11, 6), STEP);

    // Square to the side before it, and sliding to wherever the cursor is.
    expect(positions).toEqual([{ x: 10, y: 6 }]);
  });

  it("refuses a triangle's wrapped-around reference", () => {
    const triangle = [at(0, 0), at(10, 0), at(5, 8)];
    // Both "beyond" vertices would wrap onto the dragged one — no reference.
    expect(lockedVertexPositions(cornerAt(triangle, 2, true), at(5.2, 8.1), STEP)).toEqual([]);
  });
});

describe("cornerAt", () => {
  it("wraps a closed ring", () => {
    expect(cornerAt(SQUARE, 0, true)).toEqual({
      prevPrev: SQUARE[2],
      prev: SQUARE[3],
      next: SQUARE[1],
      nextNext: SQUARE[2],
    });
  });

  it("runs out at the end of an open line", () => {
    const line = [at(0, 0), at(1, 0), at(2, 0)];
    expect(cornerAt(line, 0, false)).toEqual({
      prevPrev: null,
      prev: null,
      next: line[1],
      nextNext: line[2],
    });
  });
});

describe("вогнутый угол Г-образного зала", () => {
  /**
   * Зал буквой «Г»; D — внутренний, вогнутый угол. Обход против часовой:
   *
   *   F(0,10) ── E(4,10)
   *     │           │
   *     │       D(4,4) ── C(10,4)
   *     │                    │
   *   A(0,0) ─────────── B(10,0)
   */
  const L_SHAPE = [at(0, 0), at(10, 0), at(10, 4), at(4, 4), at(4, 10), at(0, 10)];

  it("считает стороны так же, как у выпуклого: вогнутость роли не играет", () => {
    // D уведён из (4, 4) в (4.5, 3.6) — как его нарисовали бы от руки.
    const crooked = [...L_SHAPE];
    crooked[3] = at(4.5, 3.6);
    const corner = cornerAt(crooked, 3, true);

    // Сторона, приходящая в угол, меряется от южной стены здания (B→C),
    // уходящая — от северной (F→E).
    expect(corner.prevPrev).toEqual(crooked[1]);
    expect(corner.prev).toEqual(crooked[2]);
    expect(corner.next).toEqual(crooked[4]);
    expect(corner.nextNext).toEqual(crooked[5]);
  });

  it("сводит вогнутый угол в прямой с обеих сторон", () => {
    const crooked = [...L_SHAPE];
    crooked[3] = at(4.5, 3.6);
    const positions = lockedVertexPositions(cornerAt(crooked, 3, true), at(4.25, 3.85), STEP);

    // Обе стороны: горизонталь через C и вертикаль через E.
    expect(positions.some((p) => Math.abs(p.y - at(0, 4).y) < 1e-9)).toBe(true);
    expect(positions.some((p) => Math.abs(p.x - at(4, 0).x) < 1e-9)).toBe(true);
    // И сам угол — их пересечение, ровно (4, 4).
    const corner = positions.find(
      (p) => Math.abs(p.x - at(4, 0).x) < 1e-9 && Math.abs(p.y - at(0, 4).y) < 1e-9,
    );
    expect(corner).toBeDefined();
  });
});
