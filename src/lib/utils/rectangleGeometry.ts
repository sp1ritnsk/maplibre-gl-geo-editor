/**
 * Geometry of the three-click rectangle, in screen pixels.
 *
 * Two clicks set the base edge — its direction and its length. The third sets
 * how far the shape reaches away from that edge. This is how a shelving unit
 * is placed against a wall: the wall dictates the angle, and only the depth is
 * left to choose.
 */

import type { Pixel, Segment } from "./guideGeometry";

export type Corners = [Pixel, Pixel, Pixel, Pixel];

/**
 * Corners of the rectangle built on a base edge, reaching towards the cursor.
 *
 * The offset is signed, so the shape follows the cursor to either side of the
 * base instead of always growing one way. A degenerate base sets no direction
 * and yields nothing.
 */
export function angledRectangleCorners(
  [start, end]: Segment,
  cursor: Pixel,
): Corners | null {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.hypot(dx, dy);
  if (length === 0) return null;

  // Нормаль к основанию, единичной длины.
  const nx = -dy / length;
  const ny = dx / length;
  const offset = (cursor.x - start.x) * nx + (cursor.y - start.y) * ny;

  return [
    start,
    end,
    { x: end.x + nx * offset, y: end.y + ny * offset },
    { x: start.x + nx * offset, y: start.y + ny * offset },
  ];
}
