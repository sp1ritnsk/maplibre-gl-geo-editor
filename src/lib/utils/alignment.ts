/**
 * Lining a moving shape up with its neighbours.
 *
 * Cursor guides catch the moment the *cursor* crosses the continuation of an
 * edge. While an object is dragged the cursor sits somewhere inside it, and
 * what has to line up is not the cursor but the object's own corners: the
 * shelf goes flush against the wall, in one row with the shelf beside it.
 *
 * So the shape is tested corner by corner against the edges around it, and
 * the answer is a shift — how far to move the whole shape so that the best
 * match becomes exact. Everything is in one flat frame; the caller decides
 * whether that frame is metres on the ground or pixels on the screen, and
 * hands the tolerance over in the same units.
 */

import { footOnLine, type Pixel, type Segment } from "./guideGeometry";

export interface Alignment {
  /** Move the shape by this much and it lines up. */
  shift: Pixel;
  /** The edges it lines up with — what to draw as guides. */
  guides: Segment[];
}

interface Candidate {
  vertex: Pixel;
  edge: Segment;
  foot: Pixel;
  gap: number;
}

function subtract(a: Pixel, b: Pixel): Pixel {
  return { x: a.x - b.x, y: a.y - b.y };
}

function add(a: Pixel, b: Pixel): Pixel {
  return { x: a.x + b.x, y: a.y + b.y };
}

function unit([start, end]: Segment): Pixel | null {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const size = Math.hypot(dx, dy);
  return size === 0 ? null : { x: dx / size, y: dy / size };
}

/** Sine of the angle between two edges; zero when they are parallel. */
function sine(a: Segment, b: Segment): number {
  const ua = unit(a);
  const ub = unit(b);
  if (!ua || !ub) return 0;
  return Math.abs(ua.x * ub.y - ua.y * ub.x);
}

/** Two directions this close to parallel are treated as the same direction. */
const PARALLEL_SINE = 0.05;

/**
 * Corner to corner: the closest pair of a shape vertex and an edge endpoint.
 *
 * The most exact match there is, so it wins over everything else. The guides
 * are the edges that meet at that endpoint — they show the corner being hit.
 */
function cornerMatch(
  vertices: Pixel[],
  edges: Segment[],
  tolerance: number,
): Alignment | null {
  let best: { vertex: Pixel; corner: Pixel; gap: number } | null = null;
  for (const vertex of vertices) {
    for (const edge of edges) {
      for (const corner of edge) {
        const gap = Math.hypot(corner.x - vertex.x, corner.y - vertex.y);
        if (gap <= tolerance && (best === null || gap < best.gap)) {
          best = { vertex, corner, gap };
        }
      }
    }
  }
  if (best === null) return null;
  const { corner } = best;
  const guides = edges.filter((edge) =>
    edge.some((end) => end.x === corner.x && end.y === corner.y),
  );
  return { shift: subtract(corner, best.vertex), guides: guides.slice(0, 2) };
}

/**
 * Where the shape should go so that its corners sit on the edges around it.
 *
 * A corner landing on another corner is taken first. Otherwise the closest
 * corner-to-edge match sets the shift across that edge, and a second match on
 * a non-parallel edge, if one is within reach after the first shift, pins the
 * shape along it as well — that is a shelf both flush with the wall and in
 * line with its neighbour. Nothing within tolerance means no alignment.
 */
export function alignShape(
  vertices: Pixel[],
  edges: Segment[],
  tolerance: number,
): Alignment | null {
  const corner = cornerMatch(vertices, edges, tolerance);
  if (corner) return corner;

  const candidates: Candidate[] = [];
  for (const vertex of vertices) {
    for (const edge of edges) {
      const foot = footOnLine(vertex, edge);
      if (!foot) continue;
      const gap = Math.hypot(foot.x - vertex.x, foot.y - vertex.y);
      if (gap <= tolerance) candidates.push({ vertex, edge, foot, gap });
    }
  }
  if (candidates.length === 0) return null;
  candidates.sort((left, right) => left.gap - right.gap);

  const first = candidates[0];
  const shift = subtract(first.foot, first.vertex);
  const along = unit(first.edge);
  if (!along) return { shift, guides: [first.edge] };

  // Sliding along the first edge keeps the first match; look for a second
  // edge, not parallel to it, that a shifted corner is about to reach.
  let second: { candidate: Candidate; slide: number } | null = null;
  for (const candidate of candidates.slice(1)) {
    if (sine(first.edge, candidate.edge) < PARALLEL_SINE) continue;
    const moved = add(candidate.vertex, shift);
    const foot = footOnLine(moved, candidate.edge);
    if (!foot) continue;
    const gap = Math.hypot(foot.x - moved.x, foot.y - moved.y);
    if (gap > tolerance) continue;
    // Solve n·(moved + t·along − foot) = 0 for t, n being the edge normal.
    const across = unit(candidate.edge)!;
    const normal = { x: -across.y, y: across.x };
    const denominator = normal.x * along.x + normal.y * along.y;
    if (Math.abs(denominator) < PARALLEL_SINE) continue;
    const slide =
      (normal.x * (foot.x - moved.x) + normal.y * (foot.y - moved.y)) /
      denominator;
    if (second === null || gap < second.candidate.gap) {
      second = { candidate, slide };
    }
  }
  if (second === null) return { shift, guides: [first.edge] };

  return {
    shift: {
      x: shift.x + along.x * second.slide,
      y: shift.y + along.y * second.slide,
    },
    guides: [first.edge, second.candidate.edge],
  };
}
