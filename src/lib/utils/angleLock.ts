/**
 * Locking a vertex onto angle steps while it is dragged.
 *
 * Drawing already locks every new side to a multiple of the step measured
 * from the side before it. A shape that already exists needs the same thing:
 * a room traced roughly square is squared up afterwards, by moving its
 * corners, and by hand a corner never lands exactly on the right angle.
 *
 * The rule is the drawing rule applied to both sides that meet at the dragged
 * vertex. The side arriving at the vertex is measured from the side before
 * it; the side leaving it is measured from the side after it. Each lock is a
 * line the vertex may slide along, so it still follows the cursor; where both
 * locks can hold at once, their crossing is offered as well — that is the
 * corner square on both sides.
 *
 * Everything is in the flat ground frame, in metres: on the scale of a
 * building a right angle on the ground is not a right angle on a pitched
 * screen.
 */

import type { Ground } from "./groundPlane";

/**
 * The vertex's surroundings: its two neighbours, and the vertices beyond them
 * that give each side its reference direction. Any of them may be missing —
 * at the end of an open line, or on a shape too short to have them.
 */
export interface Corner {
  prevPrev: Ground | null;
  prev: Ground | null;
  next: Ground | null;
  nextNext: Ground | null;
}

/** Two directions closer than this in sine are treated as the same one. */
const PARALLEL_SINE = 0.05;

function angleOf(from: Ground, to: Ground): number {
  return Math.atan2(to.y - from.y, to.x - from.x);
}

function apart(from: Ground, to: Ground): number {
  return Math.hypot(to.x - from.x, to.y - from.y);
}

/**
 * The direction, a whole number of steps away from `base`, that lies closest
 * to where the hand actually points.
 */
export function lockedDirection(base: number, wanted: number, step: number): number {
  return base + Math.round((wanted - base) / step) * step;
}

/** The point on the line through `origin` along `direction` nearest the cursor. */
export function footOnRay(origin: Ground, direction: number, cursor: Ground): Ground {
  const dx = Math.cos(direction);
  const dy = Math.sin(direction);
  const along = (cursor.x - origin.x) * dx + (cursor.y - origin.y) * dy;
  return { x: origin.x + dx * along, y: origin.y + dy * along };
}

/** Where two lines cross; nothing when they are too near parallel to say. */
export function linesCross(
  first: { origin: Ground; direction: number },
  second: { origin: Ground; direction: number },
): Ground | null {
  const c1 = Math.cos(first.direction);
  const s1 = Math.sin(first.direction);
  const c2 = Math.cos(second.direction);
  const s2 = Math.sin(second.direction);
  const denominator = c1 * s2 - s1 * c2;
  if (Math.abs(denominator) < PARALLEL_SINE) return null;
  const t =
    ((second.origin.x - first.origin.x) * s2 - (second.origin.y - first.origin.y) * c2) /
    denominator;
  return { x: first.origin.x + c1 * t, y: first.origin.y + s1 * t };
}

/**
 * Where the dragged vertex may land so that its sides sit on whole steps.
 *
 * Returned as candidates rather than as one answer: which of them the vertex
 * actually takes is decided by whichever is nearest the cursor on screen, and
 * that is snapping's job, not geometry's.
 *
 * @param corner - The vertex's neighbours; see {@link Corner}.
 * @param cursor - Where the hand is, on the ground.
 * @param stepDegrees - Angle step, e.g. 45.
 */
export function lockedVertexPositions(
  corner: Corner,
  cursor: Ground,
  stepDegrees: number,
): Ground[] {
  const step = (stepDegrees * Math.PI) / 180;
  const rays: { origin: Ground; direction: number }[] = [];

  const lock = (anchor: Ground | null, reference: Ground | null): void => {
    if (anchor === null || reference === null) return;
    // A side of no length sets no direction, and a cursor sitting exactly on
    // the anchor points nowhere: guessing either is worse than leaving them.
    if (apart(reference, anchor) === 0 || apart(anchor, cursor) === 0) return;
    rays.push({
      origin: anchor,
      direction: lockedDirection(angleOf(reference, anchor), angleOf(anchor, cursor), step),
    });
  };

  lock(corner.prev, corner.prevPrev);
  lock(corner.next, corner.nextNext);

  const positions = rays.map((ray) => footOnRay(ray.origin, ray.direction, cursor));
  if (rays.length === 2) {
    const crossing = linesCross(rays[0], rays[1]);
    if (crossing !== null) positions.push(crossing);
  }
  return positions;
}

/**
 * The neighbourhood of the vertex at `index`.
 *
 * A closed ring wraps: the vertex before the first is the last. An open line
 * simply runs out, and the missing neighbours come back as null.
 *
 * @param vertices - Distinct vertices, without a ring's repeated last point.
 */
export function cornerAt(vertices: Ground[], index: number, closed: boolean): Corner {
  const count = vertices.length;
  const at = (offset: number): Ground | null => {
    const position = index + offset;
    if (closed) return count === 0 ? null : vertices[((position % count) + count) % count];
    return position >= 0 && position < count ? vertices[position] : null;
  };
  // On a closed ring shorter than four vertices the "vertex beyond the
  // neighbour" wraps back onto the dragged one, which is no reference at all.
  const beyond = (offset: number): Ground | null => (closed && count < 4 ? null : at(offset));
  return { prevPrev: beyond(-2), prev: at(-1), next: at(1), nextNext: beyond(2) };
}
