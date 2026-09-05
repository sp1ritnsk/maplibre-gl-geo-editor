import type { Position } from "geojson";

/**
 * Snapping a rotation to the directions already present on the plan.
 *
 * Placing a cabinet parallel to a wall is the ordinary case, and hitting the
 * wall's angle by hand is impossible: a tenth of a degree off still reads as
 * crooked. So the candidate angles are taken from the plan itself — every edge
 * of every other object, plus its perpendicular — and the rotation is pulled
 * onto the nearest one.
 *
 * Directions are kept in [0, 180): an edge and the same edge walked backwards
 * point the same way, and a shelf turned by 180° stands exactly as it stood.
 */

/** Direction of a segment in degrees clockwise from north, folded into [0, 180). */
export function directionOf(from: Position, to: Position): number {
  // Longitude is compressed towards the poles; on the scale of a room the
  // cosine of the latitude is constant enough to take it at the first point.
  const scale = Math.cos((from[1] * Math.PI) / 180);
  const east = (to[0] - from[0]) * scale;
  const north = to[1] - from[1];
  if (east === 0 && north === 0) return 0;
  return fold((Math.atan2(east, north) * 180) / Math.PI);
}

/** Folds any angle into [0, 180). */
export function fold(degrees: number): number {
  const wrapped = degrees % 180;
  return wrapped < 0 ? wrapped + 180 : wrapped;
}

/** Shortest signed distance between two directions, in (-90, 90]. */
export function directionDelta(from: number, to: number): number {
  const delta = fold(to) - fold(from);
  if (delta > 90) return delta - 180;
  if (delta <= -90) return delta + 180;
  return delta;
}

/**
 * The longest edge of a ring — what a person reads as "the way it faces".
 *
 * A shelf is a long thin rectangle; its long side is the one that has to end
 * up parallel to the wall. Rings are expected closed, but an open one works
 * just as well.
 */
export function principalDirection(ring: Position[]): number | null {
  let best: number | null = null;
  let longest = 0;
  for (let index = 0; index < ring.length - 1; index += 1) {
    const [from, to] = [ring[index], ring[index + 1]];
    const scale = Math.cos((from[1] * Math.PI) / 180);
    const length = Math.hypot((to[0] - from[0]) * scale, to[1] - from[1]);
    if (length > longest) {
      longest = length;
      best = directionOf(from, to);
    }
  }
  return best;
}

export interface SnappedRotation {
  /** Rotation to apply, in degrees clockwise. */
  angle: number;
  /** Direction it locked onto, or null when nothing was close enough. */
  target: number | null;
}

/**
 * Pulls a free rotation onto the nearest candidate direction.
 *
 * @param own - Direction the object faces before the rotation.
 * @param angle - Rotation the hand asks for, in degrees clockwise.
 * @param targets - Candidate directions; perpendiculars are added here, so
 *   callers pass the neighbouring edges as they are.
 * @param tolerance - How far off, in degrees, still counts as parallel.
 */
export function snapRotation(
  own: number,
  angle: number,
  targets: number[],
  tolerance: number,
): SnappedRotation {
  const resulting = fold(own + angle);
  let best: number | null = null;
  let bestDelta = Number.POSITIVE_INFINITY;
  for (const target of targets) {
    for (const candidate of [fold(target), fold(target + 90)]) {
      const delta = directionDelta(resulting, candidate);
      if (Math.abs(delta) < Math.abs(bestDelta)) {
        bestDelta = delta;
        best = candidate;
      }
    }
  }
  if (best === null || Math.abs(bestDelta) > tolerance) {
    return { angle, target: null };
  }
  return { angle: angle + bestDelta, target: best };
}
