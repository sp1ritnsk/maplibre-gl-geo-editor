/**
 * A local flat plane on the ground, in metres.
 *
 * Screen pixels are the wrong space to compute in as soon as the camera is
 * pitched: the screen is a perspective of the ground, so a right angle on
 * screen is not a right angle on the ground, and equal pixel steps are not
 * equal metres. Shapes built in pixels came out as parallelograms once the map
 * was tilted.
 *
 * Over the tens of metres of a building the curvature of the Earth does not
 * show, so a plane anchored at the shape itself is exact enough and, unlike
 * the screen, does not move when the camera does.
 */

import type { Position } from "geojson";

/** Metres per degree of latitude. The meridian barely varies. */
const METRES_PER_DEGREE_LATITUDE = 110540;
/** Metres per degree of longitude at the equator, scaled by cos(latitude). */
const METRES_PER_DEGREE_LONGITUDE = 111320;

export interface Ground {
  x: number;
  y: number;
}

export interface Frame {
  longitude: number;
  latitude: number;
  scale: number;
}

export function frameAt([longitude, latitude]: Position): Frame {
  return {
    longitude,
    latitude,
    scale: Math.cos((latitude * Math.PI) / 180),
  };
}

export function toGround([longitude, latitude]: Position, frame: Frame): Ground {
  return {
    x: (longitude - frame.longitude) * METRES_PER_DEGREE_LONGITUDE * frame.scale,
    y: (latitude - frame.latitude) * METRES_PER_DEGREE_LATITUDE,
  };
}

export function toPosition(point: Ground, frame: Frame): Position {
  return [
    frame.longitude + point.x / (METRES_PER_DEGREE_LONGITUDE * frame.scale),
    frame.latitude + point.y / METRES_PER_DEGREE_LATITUDE,
  ];
}
