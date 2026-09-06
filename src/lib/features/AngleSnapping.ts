import type { Feature, Position } from "geojson";
import type { Map as MapLibreMap, MapMouseEvent } from "maplibre-gl";

import { cornerAt, lockedCrossing, type Lock, lockedVertexSides } from "../utils/angleLock";
import { type Frame, frameAt, type Ground, toGround, toPosition } from "../utils/groundPlane";

/** Geoman's record of a shape, as far as this helper reaches into it. */
interface EditedShape {
  getGeoJson?: () => Feature;
  geoJson?: Feature;
}

/** The path a vertex belongs to: a ring is closed, a line is not. */
interface VertexPath {
  points: Position[];
  closed: boolean;
}

function shapeOf(shape: EditedShape): Feature | null {
  if (typeof shape.getGeoJson === "function") {
    try {
      return shape.getGeoJson();
    } catch {
      return null;
    }
  }
  return shape.geoJson ?? null;
}

/** Distinct vertices of a shape: a ring without its repeated last point. */
function pathOf(feature: Feature): VertexPath | null {
  const geometry = feature.geometry;
  if (geometry.type === "Polygon") {
    const ring = geometry.coordinates[0] ?? [];
    return ring.length < 2
      ? null
      : { points: ring.slice(0, ring.length - 1), closed: true };
  }
  if (geometry.type === "LineString") {
    return geometry.coordinates.length < 2
      ? null
      : { points: geometry.coordinates, closed: false };
  }
  return null;
}

export interface AngleSnappingOptions {
  /** Angle step in degrees. Default: 45 */
  stepDegrees?: number;
  /** Key of the geoman custom snapping section this helper owns. */
  sectionKey?: string;
}

/** Draws the lines a lock offers, so the person can aim at them. */
export type GuideRenderer = (lines: Position[][]) => void;

/**
 * How far from a lock, in multiples of the snapping tolerance, its line
 * starts being drawn. It appears a little before the lock takes hold, so the
 * line is something to aim at rather than a report of what already happened;
 * further out the map would fill with lines that lead nowhere.
 */
const SHOW_WITHIN_TOLERANCES = 2;

/** Fallback for geoman's own snapping tolerance, in pixels. */
const DEFAULT_SNAP_PIXELS = 18;

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
 * The same lock applies to a shape that already exists. Dragging one of its
 * vertices measures each of the two sides meeting there from the side beyond
 * it, so a room traced roughly square can be squared up afterwards — by hand
 * a corner never lands on the right angle exactly. See `utils/angleLock`.
 *
 * Implementation note: geoman owns the cursor, so this helper does not move it.
 * It publishes the angle-locked positions as custom snapping coordinates and
 * lets geoman's own snapping pull the cursor onto the nearest one when it is
 * within tolerance. That keeps one snapping pipeline instead of two fighting
 * each other — and it is the same pipeline that moves a vertex under the hand,
 * so the lock reaches editing without a second mechanism.
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
  /** True while a draw tool is armed: only then do clicks lay down vertices. */
  private drawing = false;
  /** The shape whose vertex is being dragged, while that is happening. */
  private edited: EditedShape | null = null;
  /** Which vertex of it — fixed for the length of the drag. */
  private editIndex: number | null = null;
  private lastCursor: Position | null = null;
  private renderGuides: GuideRenderer | null = null;

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

  /**
   * Where to draw the lines this helper locks onto.
   *
   * The lock is a line on the ground; without seeing it a person can only
   * guess where the perpendicular is and, missing it by more than the
   * snapping tolerance, concludes that nothing snaps at all.
   */
  setGuideRenderer(render: GuideRenderer | null): void {
    this.renderGuides = render;
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

  /**
   * Forget the shape being drawn and take the lock lines off the map. Call
   * when a drawing mode starts or ends.
   */
  reset(): void {
    this.vertices = [];
    this.lockedPosition = null;
    this.clearSnapping();
    this.draw([]);
  }

  /**
   * Whether a draw tool is armed.
   *
   * Vertices are only laid down while one is: a click anywhere on the map
   * used to count as a corner of the shape being drawn, even when nothing was
   * being drawn, and the lock published from those stray points pulled at
   * everything else the cursor did afterwards.
   */
  setDrawing(drawing: boolean): void {
    this.drawing = drawing;
    if (!drawing) this.reset();
  }

  /**
   * Follow a vertex that is being dragged instead of a shape being drawn.
   *
   * @param shape - Geoman's record of the shape the vertex belongs to; its
   *   geometry is read again on every move, since that is what changes.
   */
  beginVertexEdit(shape: EditedShape): void {
    this.edited = shape;
    this.editIndex = this.vertexUnderCursor(shape, this.lastCursor);
  }

  /** Let go of the vertex: no lock, no lines. */
  endVertexEdit(): void {
    this.edited = null;
    this.editIndex = null;
    this.clearSnapping();
    this.draw([]);
  }

  destroy(): void {
    this.disable();
    this.endVertexEdit();
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
    if (!this.drawing) return;
    const raw: Position = [event.lngLat.lng, event.lngLat.lat];
    this.vertices.push(this.lockedPosition ?? raw);
    this.lockedPosition = null;
  }

  /**
   * Which vertex of the shape the hand has hold of.
   *
   * Geoman does say which marker it captured, but only through internals; the
   * dragged vertex is also simply the one under the cursor when the drag
   * begins, and that holds for every geoman build.
   */
  private vertexUnderCursor(shape: EditedShape, cursor: Position | null): number | null {
    const feature = shapeOf(shape);
    const path = feature === null ? null : pathOf(feature);
    if (path === null || cursor === null) return null;
    const frame = frameAt(cursor);
    const target = toGround(cursor, frame);
    let best: number | null = null;
    let nearest = Number.POSITIVE_INFINITY;
    path.points.forEach((point, index) => {
      const ground = toGround(point, frame);
      const gap = Math.hypot(ground.x - target.x, ground.y - target.y);
      if (gap < nearest) {
        nearest = gap;
        best = index;
      }
    });
    return best;
  }

  /** Where the dragged vertex may land with its sides on whole steps. */
  private publishVertexLock(event: MapMouseEvent): void {
    const shape = this.edited;
    if (shape === null) return;
    const cursorPosition: Position = [event.lngLat.lng, event.lngLat.lat];
    this.editIndex ??= this.vertexUnderCursor(shape, cursorPosition);
    const feature = shapeOf(shape);
    const path = feature === null ? null : pathOf(feature);
    if (path === null || this.editIndex === null || this.editIndex >= path.points.length) {
      this.clearSnapping();
      return;
    }
    const frame = frameAt(cursorPosition);
    const cursor = toGround(cursorPosition, frame);
    const locks = lockedVertexSides(
      cornerAt(
        path.points.map((point) => toGround(point, frame)),
        this.editIndex,
        path.closed,
      ),
      cursor,
      this.step,
    );
    if (locks.length === 0) {
      this.clearSnapping();
      this.draw([]);
      return;
    }
    const crossing = lockedCrossing(locks);
    const positions = locks.map((lock) => lock.position);
    this.publishSnapping(
      (crossing === null ? positions : [...positions, crossing]).map((position) =>
        toPosition(position, frame),
      ),
    );
    this.drawLocks(locks, event, frame);
  }

  /**
   * Draws the locks the hand is close to.
   *
   * Only those: a line for every step at every corner would cover the plan
   * and say nothing about where this vertex is actually going.
   */
  private drawLocks(locks: Lock[], event: MapMouseEvent, frame: Frame): void {
    if (this.renderGuides === null || this.map === null) return;
    const reach = this.snapPixels() * SHOW_WITHIN_TOLERANCES;
    const near = locks.filter((lock) => this.screenGap(event, lock.position, frame) <= reach);
    this.renderGuides(near.map((lock) => this.lineAlong(lock, frame)));
  }

  private draw(lines: Position[][]): void {
    this.renderGuides?.(lines);
  }

  /** How far a point on the ground is from the cursor, in screen pixels. */
  private screenGap(event: MapMouseEvent, point: Ground, frame: Frame): number {
    const projected = this.map!.project(toPosition(point, frame) as [number, number]);
    return Math.hypot(projected.x - event.point.x, projected.y - event.point.y);
  }

  /** Geoman's snapping tolerance in pixels, as it is actually configured. */
  private snapPixels(): number {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const distance = (this.geoman as any)?.options?.settings?.snapDistance;
    return typeof distance === "number" && distance > 0 ? distance : DEFAULT_SNAP_PIXELS;
  }

  /** The lock drawn as a line long enough to cross the window. */
  private lineAlong(lock: Lock, frame: Frame): Position[] {
    const canvas = this.map!.getCanvas();
    const corner = this.map!.unproject([canvas.clientWidth, canvas.clientHeight]);
    const far = toGround([corner.lng, corner.lat], frame);
    const span = Math.max(Math.hypot(far.x, far.y) * 2, 50);
    const dx = Math.cos(lock.direction) * span;
    const dy = Math.sin(lock.direction) * span;
    return [
      toPosition({ x: lock.origin.x - dx, y: lock.origin.y - dy }, frame),
      toPosition({ x: lock.origin.x + dx, y: lock.origin.y + dy }, frame),
    ];
  }

  private previousSide(): [Position, Position] | null {
    const count = this.vertices.length;
    return count >= 2
      ? [this.vertices[count - 2], this.vertices[count - 1]]
      : null;
  }

  private publishLock(event: MapMouseEvent): void {
    this.lastCursor = [event.lngLat.lng, event.lngLat.lat];
    if (this.edited !== null) {
      this.publishVertexLock(event);
      return;
    }
    const side = this.previousSide();
    if (!side || !this.drawing || !this.map) {
      this.lockedPosition = null;
      this.clearSnapping();
      return;
    }

    // Углы меряются на земле, а не на экране: под наклонённой камерой экран —
    // перспектива, и 45° в картинке не 45° на плане.
    const frame = frameAt(side[0]);
    const anchor = toGround(side[1], frame);
    const locked = this.lockAngle(
      toGround(side[0], frame),
      anchor,
      toGround([event.lngLat.lng, event.lngLat.lat], frame),
    );
    if (!locked) {
      this.lockedPosition = null;
      this.clearSnapping();
      this.draw([]);
      return;
    }

    this.lockedPosition = toPosition(locked.position, frame);
    this.publishSnapping([this.lockedPosition]);
    this.drawLocks([{ ...locked, origin: anchor }], event, frame);
  }

  /**
   * Cursor turned to the nearest multiple of the step, measured from the
   * previous side. The length of the new side is preserved: only its direction
   * changes. A degenerate previous side sets no direction, and guessing one is
   * worse than leaving the cursor alone.
   */
  private lockAngle(from: Ground, anchor: Ground, cursor: Ground): Lock | null {
    const length = Math.hypot(cursor.x - anchor.x, cursor.y - anchor.y);
    const reference = Math.hypot(anchor.x - from.x, anchor.y - from.y);
    if (length === 0 || reference === 0) return null;

    const step = (this.step * Math.PI) / 180;
    const base = Math.atan2(anchor.y - from.y, anchor.x - from.x);
    const relative = Math.atan2(cursor.y - anchor.y, cursor.x - anchor.x) - base;
    const direction = base + Math.round(relative / step) * step;
    return {
      origin: anchor,
      direction,
      position: {
        x: anchor.x + length * Math.cos(direction),
        y: anchor.y + length * Math.sin(direction),
      },
    };
  }

  private publishSnapping(positions: Position[]): void {
    const helper = this.snappingHelper();
    if (!helper) return;
    try {
      // More than one candidate is normal while a vertex is dragged: geoman
      // pulls the cursor onto whichever of them is nearest on screen.
      helper.setCustomSnappingCoordinates(
        this.sectionKey,
        positions.map((position) => [position[0], position[1]]),
      );
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

  /**
   * Geoman keeps helper instances in `actionInstances` under a
   * `<type>__<mode>` key, not in a `helpers` map. Reading the wrong place
   * returned nothing and the publish silently did nothing at all.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private snappingHelper(): any {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const gm = this.geoman as any;
    const instance = gm?.actionInstances?.helper__snapping;
    return instance &&
      typeof instance.setCustomSnappingCoordinates === "function"
      ? instance
      : null;
  }
}
