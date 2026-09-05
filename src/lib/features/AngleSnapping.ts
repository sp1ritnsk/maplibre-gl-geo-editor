import type { Position } from "geojson";
import type { Map as MapLibreMap, MapMouseEvent } from "maplibre-gl";

export interface AngleSnappingOptions {
  /** Angle step in degrees. Default: 45 */
  stepDegrees?: number;
  /** Key of the geoman custom snapping section this helper owns. */
  sectionKey?: string;
}

interface Pixel {
  x: number;
  y: number;
}

/**
 * Angle snapping for drawing.
 *
 * Geoman snaps to vertices and lines but not to angles, so a rectangular room
 * cannot be traced accurately: the closing edge never meets the first one.
 *
 * The angle is measured from the previous side of the shape rather than from
 * the screen axes. Buildings sit at their own bearing to north, and locking to
 * global axes breaks the outline at the first corner instead of keeping its
 * corners square. The first side is drawn freely — it sets the orientation,
 * and every following side is measured against it.
 *
 * Implementation note: geoman owns the cursor, so this helper does not move it.
 * It publishes the angle-locked position as a custom snapping coordinate and
 * lets geoman's own snapping pull the cursor there when it is within tolerance.
 * That keeps one snapping pipeline instead of two fighting each other.
 */
export class AngleSnapping {
  private map: MapLibreMap | null = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private geoman: any = null;
  private enabled = false;
  private readonly step: number;
  private readonly sectionKey: string;
  private vertices: Position[] = [];
  private lockedPosition: Position | null = null;

  private handleClick: ((e: MapMouseEvent) => void) | null = null;
  private handleMouseMove: ((e: MapMouseEvent) => void) | null = null;

  constructor(options: AngleSnappingOptions = {}) {
    this.step = options.stepDegrees ?? 45;
    this.sectionKey = options.sectionKey ?? "geo-editor-angles";
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  init(map: MapLibreMap, geoman: any): void {
    this.map = map;
    this.geoman = geoman;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  setGeoman(geoman: any): void {
    this.geoman = geoman;
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  enable(): void {
    if (!this.map || this.enabled) return;
    this.enabled = true;
    this.reset();

    this.handleClick = (e: MapMouseEvent) => this.recordVertex(e);
    this.handleMouseMove = (e: MapMouseEvent) => this.publishLock(e);
    this.map.on("click", this.handleClick);
    this.map.on("mousemove", this.handleMouseMove);
  }

  disable(): void {
    if (this.map) {
      if (this.handleClick) this.map.off("click", this.handleClick);
      if (this.handleMouseMove) this.map.off("mousemove", this.handleMouseMove);
    }
    this.handleClick = null;
    this.handleMouseMove = null;
    this.enabled = false;
    this.reset();
  }

  /** Forget the shape being drawn. Call when a drawing mode starts or ends. */
  reset(): void {
    this.vertices = [];
    this.lockedPosition = null;
    this.clearSnapping();
  }

  destroy(): void {
    this.disable();
    this.map = null;
    this.geoman = null;
  }

  /**
   * Remember where a vertex was placed.
   *
   * When the click landed on the published lock, the vertex geoman actually
   * stored is that lock and not the raw cursor. Recording the raw position
   * would tilt the reference side by the snapping tolerance, and every
   * following angle would inherit the error.
   */
  private recordVertex(event: MapMouseEvent): void {
    const raw: Position = [event.lngLat.lng, event.lngLat.lat];
    this.vertices.push(this.lockedPosition ?? raw);
    this.lockedPosition = null;
  }

  private previousSide(): [Position, Position] | null {
    const count = this.vertices.length;
    return count >= 2
      ? [this.vertices[count - 2], this.vertices[count - 1]]
      : null;
  }

  private publishLock(event: MapMouseEvent): void {
    const side = this.previousSide();
    if (!side || !this.map) {
      this.lockedPosition = null;
      this.clearSnapping();
      return;
    }

    const from = this.toPixel(side[0]);
    const anchor = this.toPixel(side[1]);
    const cursor = { x: event.point.x, y: event.point.y };
    const locked = this.lockAngle(from, anchor, cursor);
    if (!locked) {
      this.lockedPosition = null;
      this.clearSnapping();
      return;
    }

    const lngLat = this.map.unproject([locked.x, locked.y]);
    this.lockedPosition = [lngLat.lng, lngLat.lat];
    this.publishSnapping(this.lockedPosition);
  }

  /**
   * Cursor turned to the nearest multiple of the step, measured from the
   * previous side. The length of the new side is preserved: only its direction
   * changes. A degenerate previous side sets no direction, and guessing one is
   * worse than leaving the cursor alone.
   */
  private lockAngle(from: Pixel, anchor: Pixel, cursor: Pixel): Pixel | null {
    const length = Math.hypot(cursor.x - anchor.x, cursor.y - anchor.y);
    const reference = Math.hypot(anchor.x - from.x, anchor.y - from.y);
    if (length === 0 || reference === 0) return null;

    const step = (this.step * Math.PI) / 180;
    const base = Math.atan2(anchor.y - from.y, anchor.x - from.x);
    const relative = Math.atan2(cursor.y - anchor.y, cursor.x - anchor.x) - base;
    const snapped = base + Math.round(relative / step) * step;
    return {
      x: anchor.x + length * Math.cos(snapped),
      y: anchor.y + length * Math.sin(snapped),
    };
  }

  private toPixel(position: Position): Pixel {
    const point = this.map!.project([position[0], position[1]]);
    return { x: point.x, y: point.y };
  }

  private publishSnapping(position: Position): void {
    const helper = this.snappingHelper();
    if (!helper) return;
    try {
      helper.setCustomSnappingCoordinates(this.sectionKey, [
        [position[0], position[1]],
      ]);
    } catch {
      // Older geoman builds have no custom snapping section.
    }
  }

  private clearSnapping(): void {
    const helper = this.snappingHelper();
    if (!helper) return;
    try {
      helper.clearCustomSnappingCoordinates(this.sectionKey);
    } catch {
      // Nothing published yet — nothing to clear.
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private snappingHelper(): any {
    const helpers = this.geoman?.helpers;
    if (!helpers) return null;
    return (
      helpers.snapping ??
      (typeof helpers.get === "function" ? helpers.get("snapping") : null)
    );
  }
}
