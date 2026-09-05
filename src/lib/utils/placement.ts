import type { Feature, LineString, Polygon, Position } from "geojson";
import * as turf from "@turf/turf";

/**
 * Whether an object may stand where it has been dragged.
 *
 * Two rules, and they are not the same rule: an object has to stay inside the
 * room, and it must not sit on top of another one.
 *
 * Touching is allowed on purpose. A shelf stands flush against the wall and
 * the next shelf stands flush against it — that is how a hall is laid out, and
 * the snapping leads straight to it. Only real overlap is refused, measured by
 * area so that a shared edge, which turf reports as an intersection of zero
 * area, passes.
 */

/** Overlap smaller than this counts as touching, in square metres. */
export const TOUCH_TOLERANCE_SQM = 0.01;

/**
 * Does the line pass through the shape, rather than run along its edge?
 *
 * A wall laid exactly against the side of a shelf shares the whole edge with
 * it, and every boundary test calls that an intersection. What matters is
 * whether any part of the line is strictly inside, so the crossings are found
 * first and the stretches between them are sampled away from the boundary.
 */
function crossesInterior(line: Feature<LineString>, shape: Feature<Polygon>): boolean {
  const inside = (point: Position): boolean =>
    turf.booleanPointInPolygon(turf.point(point), shape, { ignoreBoundary: true });
  if (line.geometry.coordinates.some(inside)) return true;
  const hits = turf
    .lineIntersect(line, shape)
    .features.map((point) => point.geometry.coordinates);
  for (let a = 0; a < hits.length; a += 1) {
    for (let b = a + 1; b < hits.length; b += 1) {
      if (inside([(hits[a][0] + hits[b][0]) / 2, (hits[a][1] + hits[b][1]) / 2])) {
        return true;
      }
    }
  }
  return false;
}

function asPolygon(feature: Feature): Feature<Polygon> | null {
  return feature.geometry.type === "Polygon"
    ? (feature as Feature<Polygon>)
    : null;
}

/** Does the object stay inside the boundary? No boundary means no limit. */
export function isWithin(feature: Feature, boundary: Feature | null): boolean {
  const shape = asPolygon(feature);
  const room = boundary ? asPolygon(boundary) : null;
  if (!shape || !room) return true;
  try {
    return turf.booleanWithin(shape, room);
  } catch {
    // A malformed ring must not make the editor unusable; let it pass and let
    // the eye judge.
    return true;
  }
}

/**
 * Does the object overlap this neighbour?
 *
 * Walls arrive as lines — their thickness lives elsewhere — so a wall counts
 * as hit when the object's outline actually crosses it, not when it merely
 * runs alongside.
 */
export function overlaps(feature: Feature, other: Feature): boolean {
  const shape = asPolygon(feature);
  if (!shape) return false;
  try {
    if (other.geometry.type === "LineString") {
      return crossesInterior(other as Feature<LineString>, shape);
    }
    const neighbour = asPolygon(other);
    if (!neighbour) return false;
    const shared = turf.intersect(
      turf.featureCollection([shape, neighbour]),
    ) as Feature<Polygon> | null;
    return shared !== null && turf.area(shared) > TOUCH_TOLERANCE_SQM;
  } catch {
    return false;
  }
}

/**
 * May the object stand here?
 *
 * @param feature - The object in its proposed position.
 * @param boundary - Room it must stay inside, or null for no limit.
 * @param neighbours - Everything else on the plan; the object itself must not
 *   be among them, or it would always collide with where it already is.
 */
export function canStand(
  feature: Feature,
  boundary: Feature | null,
  neighbours: Feature[],
): boolean {
  if (!isWithin(feature, boundary)) return false;
  return !neighbours.some((other) => overlaps(feature, other));
}
