/**
 * Geometry behind alignment guides, in screen pixels.
 *
 * Kept apart from the map so it can be tested without one: every guide bug so
 * far has been an arithmetic bug, and arithmetic is exactly what a browser
 * makes hard to check.
 */

export interface Pixel {
  x: number;
  y: number;
}

export type Segment = [Pixel, Pixel];

export function distance(from: Pixel, to: Pixel): number {
  return Math.hypot(to.x - from.x, to.y - from.y);
}

export function midpoint([start, end]: Segment): Pixel {
  return { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
}

/**
 * Foot of the perpendicular from a point to the infinite line through a
 * segment. The line, not the segment: a guide is the continuation of an edge,
 * and continuations reach past the edge itself.
 */
export function footOnLine(point: Pixel, [start, end]: Segment): Pixel | null {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return null;
  const t = ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared;
  return { x: start.x + t * dx, y: start.y + t * dy };
}

/** Distance from a point to the infinite line through a segment. */
export function distanceToLine(point: Pixel, segment: Segment): number | null {
  const foot = footOnLine(point, segment);
  return foot === null ? null : distance(point, foot);
}

/**
 * Where the infinite lines through two segments cross.
 *
 * Parallel lines never do, and near-parallel ones cross so far away that the
 * point is meaningless — both cases return nothing.
 */
export function lineIntersection(
  [a1, a2]: Segment,
  [b1, b2]: Segment,
): Pixel | null {
  const ax = a2.x - a1.x;
  const ay = a2.y - a1.y;
  const bx = b2.x - b1.x;
  const by = b2.y - b1.y;
  const denominator = ax * by - ay * bx;
  // Синус угла между направлениями; на почти сонаправленных он близок к нулю.
  const sine = Math.abs(denominator) / (Math.hypot(ax, ay) * Math.hypot(bx, by));
  if (!Number.isFinite(sine) || sine < 0.05) return null;
  const t = ((b1.x - a1.x) * by - (b1.y - a1.y) * bx) / denominator;
  return { x: a1.x + t * ax, y: a1.y + t * ay };
}

/**
 * The segment stretched both ways to `length` pixels around its middle, so a
 * guide crosses the viewport instead of ending where the edge does.
 */
export function extend([start, end]: Segment, length: number): Segment | null {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const size = Math.hypot(dx, dy);
  if (size === 0) return null;
  const ux = (dx / size) * length;
  const uy = (dy / size) * length;
  const middle = midpoint([start, end]);
  return [
    { x: middle.x - ux, y: middle.y - uy },
    { x: middle.x + ux, y: middle.y + uy },
  ];
}
