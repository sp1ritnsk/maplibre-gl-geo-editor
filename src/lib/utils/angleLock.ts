/**
 * Locking a vertex onto angle steps while it is dragged.
 *
 * Drawing already locks every new side to a multiple of the step measured
 * from the side before it. A shape that already exists needs the same thing:
 * a room traced roughly square is squared up afterwards, by moving its
 * corners, and by hand a corner never lands exactly on the right angle.
 *
 * A lock is a whole line, not a point: the vertex slides along it to wherever
 * the cursor is, and the line itself is what gets drawn for the person to aim
 * at — a lock nobody can see is a lock nobody can hit.
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

/**
 * A side locked onto a whole step: the line it lies on, and where on that
 * line the vertex would land.
 */
export interface Lock {
  /** Neighbour the locked side starts from. */
  origin: Ground;
  /** Direction of the locked side, in radians. */
  direction: number;
  /** Point on the line nearest the cursor — where the vertex lands. */
  position: Ground;
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
 * The locked lines the dragged vertex may sit on: one per side that has a
 * side of its own to be measured from.
 *
 * Which of them the vertex actually takes is decided by whichever is nearest
 * the cursor on screen — that is snapping's job, not geometry's.
 *
 * @param corner - The vertex's neighbours; see {@link Corner}.
 * @param cursor - Where the hand is, on the ground.
 * @param stepDegrees - Angle step, e.g. 45.
 */
export function lockedVertexSides(corner: Corner, cursor: Ground, stepDegrees: number): Lock[] {
  const step = (stepDegrees * Math.PI) / 180;
  const locks: Lock[] = [];

  const lock = (anchor: Ground | null, reference: Ground | null): void => {
    if (anchor === null || reference === null) return;
    // A side of no length sets no direction, and a cursor sitting exactly on
    // the anchor points nowhere: guessing either is worse than leaving them.
    if (apart(reference, anchor) === 0 || apart(anchor, cursor) === 0) return;
    const direction = lockedDirection(
      angleOf(reference, anchor),
      angleOf(anchor, cursor),
      step,
    );
    locks.push({ origin: anchor, direction, position: footOnRay(anchor, direction, cursor) });
  };

  lock(corner.prev, corner.prevPrev);
  lock(corner.next, corner.nextNext);
  return locks;
}

/**
 * Where two locked sides meet: the corner square — or on a step — on both
 * sides at once. Nothing when they are too near parallel to meet anywhere
 * meaningful.
 */
export function lockedCrossing(locks: Lock[]): Ground | null {
  return locks.length === 2 ? linesCross(locks[0], locks[1]) : null;
}

/** Every position the vertex may land on: each locked side, plus their crossing. */
export function lockedVertexPositions(
  corner: Corner,
  cursor: Ground,
  stepDegrees: number,
): Ground[] {
  const locks = lockedVertexSides(corner, cursor, stepDegrees);
  const crossing = lockedCrossing(locks);
  const positions = locks.map((lock) => lock.position);
  return crossing === null ? positions : [...positions, crossing];
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
