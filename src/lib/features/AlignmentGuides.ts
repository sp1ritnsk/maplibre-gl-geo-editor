import type { Feature, Position } from "geojson";
import type { GeoJSONSource, Map as MapLibreMap, MapMouseEvent } from "maplibre-gl";

import {
  distance,
  extend,
  footOnLine,
  lineIntersection,
  midpoint,
  type Pixel,
  type Segment,
} from "../utils/guideGeometry";
import { alignShape } from "../utils/alignment";
import { frameAt, type Frame, type Ground, toGround, toPosition } from "../utils/groundPlane";
import { directionOf } from "../utils/rotationSnapping";

/** A shift smaller than this, in metres, is float noise and not a move. */
const NEGLIGIBLE_SHIFT_METRES = 0.0005;

/** Geoman's record of a shape, as far as this helper needs it. */
interface DraggedShape {
  getGeoJson?: () => Feature;
  geoJson?: Feature;
}

export interface AlignmentGuidesOptions {
  /** How close in pixels counts as aligned. Default: 8 */
  tolerance?: number;
  /** Key of the geoman custom snapping section this helper owns. */
  sectionKey?: string;
  /** Colour of the guide lines. */
  color?: string;
}

const SOURCE_ID = "geo-editor-alignment-guides";
const LAYER_ID = "geo-editor-alignment-guides-line";

/**
 * Alignment guides.
 *
 * Geoman lists `snap_guides` among its helper modes but the free build ships
 * it as `null` — enabling it fails with "not available". These guides are
 * therefore drawn here.
 *
 * A guide appears when the cursor lines up with a vertex of another shape
 * along a screen axis: that is the moment a shelf is about to stand in one row
 * with its neighbour, and the moment worth showing. The aligned position is
 * published as a custom snapping coordinate, so geoman pulls the cursor onto
 * the guide instead of near it — the line and the result agree.
 */
export class AlignmentGuides {
  private map: MapLibreMap | null = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private geoman: any = null;
  private enabled = false;
  private readonly tolerance: number;
  /** Пересечение продолжений ловится шире: попасть в точку труднее, чем в линию. */
  private readonly crossingTolerance: number;
  private readonly sectionKey: string;
  private readonly color: string;
  private handleMouseMove: ((e: MapMouseEvent) => void) | null = null;
  private referenceEdges: Array<[Position, Position]> = [];
  private suspended = false;
  /** The shape being dragged, when guides follow its corners, not the cursor. */
  private dragged: { shape: DraggedShape; excludeId: string | null } | null = null;

  constructor(options: AlignmentGuidesOptions = {}) {
    this.tolerance = options.tolerance ?? 8;
    this.crossingTolerance = (options.tolerance ?? 8) * 2;
    this.sectionKey = options.sectionKey ?? "geo-editor-guides";
    this.color = options.color ?? "#e11d48";
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
    this.ensureLayer();
    this.handleMouseMove = (e: MapMouseEvent) => this.update(e);
    this.map.on("mousemove", this.handleMouseMove);
  }

  disable(): void {
    if (this.map && this.handleMouseMove) {
      this.map.off("mousemove", this.handleMouseMove);
    }
    this.handleMouseMove = null;
    this.enabled = false;
    this.draw([]);
    this.clearSnapping();
  }

  destroy(): void {
    this.disable();
    this.removeLayer();
    this.map = null;
    this.geoman = null;
  }

  /**
   * Что показать и куда притянуть под курсором.
   *
   * Разбор идёт от точного к приблизительному: пересечение двух продолжений
   * точнее середины ребра, середина точнее самого продолжения. Экранные
   * горизонталь и вертикаль сюда не входят намеренно — через какую-нибудь
   * вершину они проходят почти всегда, и направляющая, которая горит
   * постоянно, не говорит ничего.
   *
   * Сама геометрия считается на земле, а допуск — по экрану: направление
   * продолжения задаёт план, а «достаточно близко» задаёт рука с мышью, и под
   * наклонённой камерой это разные плоскости.
   */
  private update(event: MapMouseEvent): void {
    if (!this.map || this.suspended) return;
    if (this.dragged) {
      this.updateDragged(event);
      return;
    }
    const cursorPixel: Pixel = { x: event.point.x, y: event.point.y };
    const frame = frameAt([event.lngLat.lng, event.lngLat.lat]);
    const cursor = toGround([event.lngLat.lng, event.lngLat.lat], frame);
    const edges = this.edges().map(
      (edge): Segment => [toGround(edge[0], frame), toGround(edge[1], frame)],
    );

    // Рёбра, продолжение которых проходит под курсором.
    const engaged = edges
      .map((edge) => ({ edge, foot: footOnLine(cursor, edge) }))
      .filter((item): item is { edge: Segment; foot: Ground } => item.foot !== null)
      .map((item) => ({
        ...item,
        gap: this.screenGap(cursorPixel, item.foot, frame),
      }))
      .filter((item) => item.gap <= this.tolerance)
      .sort((left, right) => left.gap - right.gap)
      .slice(0, 2);

    if (engaged.length >= 2) {
      const crossing = lineIntersection(engaged[0].edge, engaged[1].edge);
      if (
        crossing &&
        this.screenGap(cursorPixel, crossing, frame) <= this.crossingTolerance
      ) {
        this.show([engaged[0].edge, engaged[1].edge], crossing, frame);
        return;
      }
    }

    const middle = this.nearestMidpoint(cursorPixel, edges, frame);
    if (middle) {
      this.show([middle.edge], middle.point, frame);
      return;
    }

    if (engaged.length >= 1) {
      this.show([engaged[0].edge], engaged[0].foot, frame);
      return;
    }

    this.draw([]);
    this.clearSnapping();
  }

  /** Насколько точка на земле далека от курсора в пикселях экрана. */
  private screenGap(cursor: Pixel, point: Ground, frame: Frame): number {
    const position = toPosition(point, frame);
    const projected = this.map!.project([position[0], position[1]]);
    return distance(cursor, { x: projected.x, y: projected.y });
  }

  /**
   * Guides for the shape under the hand, not for the hand itself.
   *
   * The shape's corners are tested against every edge around it; the best
   * match yields a shift that would make it exact. The shift is published as
   * a snapping target for the cursor: geoman moves the shape by exactly what
   * the cursor moves, so pulling the cursor by the shift pulls the shape into
   * line. Tolerance is a screen distance — how close the hand has to come —
   * converted to metres at the cursor, where the geometry lives.
   */
  private updateDragged(event: MapMouseEvent): void {
    if (!this.map || !this.dragged) return;
    const feature = shapeOf(this.dragged.shape);
    const corners = feature ? verticesOf(feature) : [];
    if (corners.length === 0) {
      this.draw([]);
      this.clearSnapping();
      return;
    }
    const cursorPosition: Position = [event.lngLat.lng, event.lngLat.lat];
    const frame = frameAt(cursorPosition);
    const cursor = toGround(cursorPosition, frame);
    const result = alignShape(
      corners.map((corner) => toGround(corner, frame)),
      this.groundEdges(frame, this.dragged.excludeId),
      this.groundTolerance(event.point, frame),
    );
    if (!result) {
      this.draw([]);
      this.clearSnapping();
      return;
    }
    this.show(
      result.guides,
      { x: cursor.x + result.shift.x, y: cursor.y + result.shift.y },
      frame,
    );
  }

  /**
   * The shape moved so that it lines up with its neighbours, or null when it
   * already does — or when nothing is within reach.
   *
   * The end of a drag: the live snapping above pulls the shape into place
   * while the hand moves, and this settles whatever the last frame left over.
   */
  alignedGeometry(feature: Feature, excludeId: string | null): Feature["geometry"] | null {
    if (!this.map) return null;
    const corners = verticesOf(feature);
    if (corners.length === 0) return null;
    const frame = frameAt(corners[0]);
    const anchor = this.map.project([corners[0][0], corners[0][1]]);
    const result = alignShape(
      corners.map((corner) => toGround(corner, frame)),
      this.groundEdges(frame, excludeId),
      this.groundTolerance({ x: anchor.x, y: anchor.y }, frame),
    );
    if (!result) return null;
    if (Math.hypot(result.shift.x, result.shift.y) < NEGLIGIBLE_SHIFT_METRES) {
      return null;
    }
    return translateGeometry(feature.geometry, result.shift, frame);
  }

  /** Edges to align to, in the ground frame. */
  private groundEdges(frame: Frame, excludeId: string | null): Segment[] {
    return this.edges(excludeId ?? undefined).map(
      (edge): Segment => [toGround(edge[0], frame), toGround(edge[1], frame)],
    );
  }

  /** The screen tolerance measured on the ground at this screen point. */
  private groundTolerance(point: Pixel, frame: Frame): number {
    const here = this.map!.unproject([point.x, point.y]);
    const there = this.map!.unproject([point.x + this.tolerance, point.y]);
    const from = toGround([here.lng, here.lat], frame);
    const to = toGround([there.lng, there.lat], frame);
    return Math.hypot(to.x - from.x, to.y - from.y);
  }

  /** Середина ребра — по ней ставят стеллаж по центру прохода. */
  private nearestMidpoint(
    cursor: Pixel,
    edges: Segment[],
    frame: Frame,
  ): { edge: Segment; point: Ground } | null {
    let best: { edge: Segment; point: Ground } | null = null;
    let bestGap = this.tolerance;
    for (const edge of edges) {
      const point = midpoint(edge);
      const gap = this.screenGap(cursor, point, frame);
      if (gap <= bestGap) {
        bestGap = gap;
        best = { edge, point };
      }
    }
    return best;
  }

  private show(edges: Segment[], target: Ground, frame: Frame): void {
    const span = this.guideLength(frame);
    const lines: Position[][] = [];
    for (const edge of edges) {
      const stretched = extend(edge, span);
      if (stretched) {
        lines.push([
          toPosition(stretched[0], frame),
          toPosition(stretched[1], frame),
        ]);
      }
    }
    this.draw(lines);
    this.publishSnapping(toPosition(target, frame));
  }

  /** Длина направляющей в метрах: она обязана дотянуться до краёв окна. */
  private guideLength(frame: Frame): number {
    const canvas = this.map!.getCanvas();
    const corner = this.map!.unproject([canvas.clientWidth, canvas.clientHeight]);
    const far = toGround([corner.lng, corner.lat], frame);
    return Math.hypot(far.x, far.y) * 2;
  }

  /** Рёбра уже нарисованных объектов — то, что продолжают направляющие. */
  /**
   * Directions of every edge on the plan, in degrees folded into [0, 180).
   *
   * Walls and the hall outline are ordinary features in the editor's store, so
   * they come along with the rest — which is the point: a cabinet is usually
   * placed parallel to a wall, not to another cabinet.
   */
  edgeDirections(excludeId?: string): number[] {
    return this.edges(excludeId).map(([from, to]) => directionOf(from, to));
  }

  /**
   * Geometry to align to that the editor itself does not hold.
   *
   * A host may keep part of the plan outside the editor — the hall outline is
   * drawn but not edited most of the time — and still want shelves to line up
   * with it. Those edges are handed over here instead of being made editable
   * just so that they can be snapped to.
   */
  setReferenceGeometry(features: Feature[]): void {
    const list: Array<[Position, Position]> = [];
    for (const feature of features) {
      const geometry = feature?.geometry;
      if (!geometry) continue;
      const rings =
        geometry.type === "Polygon"
          ? geometry.coordinates
          : geometry.type === "LineString"
            ? [geometry.coordinates]
            : [];
      for (const ring of rings) {
        for (let index = 0; index < ring.length - 1; index += 1) {
          list.push([ring[index], ring[index + 1]]);
        }
      }
    }
    this.referenceEdges = list;
  }

  /**
   * Hand the guide layer over to someone else for a while.
   *
   * Both this helper and the rotation snapping draw on mousemove; whichever
   * runs last wins, and the cursor-alignment guides are meaningless anyway
   * while the cursor is swinging an object around its pivot.
   */
  setSuspended(suspended: boolean): void {
    this.suspended = suspended;
    if (suspended) this.draw([]);
  }

  /**
   * Follow a shape that is being dragged instead of the bare cursor.
   *
   * `excludeId` is the shape's own id in geoman's store: its edges are not
   * something to line up with. Pass null to go back to cursor guides.
   */
  setDragged(shape: DraggedShape | null, excludeId: string | null = null): void {
    this.dragged = shape ? { shape, excludeId } : null;
    if (!shape) {
      this.draw([]);
      this.clearSnapping();
    }
  }

  /** Draw guide lines chosen by someone else — the rotation snapping does. */
  showLines(lines: Position[][]): void {
    this.ensureLayer();
    this.draw(lines);
  }

  private edges(excludeId?: string): Array<[Position, Position]> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const features = this.geoman?.features;
    if (!features || typeof features.getAll !== "function") return [];
    const collection = features.getAll();
    const list: Array<[Position, Position]> = [];
    // A closed ring repeats its first point last, so walking consecutive
    // pairs covers a ring and an open line alike.
    const addPath = (path: Position[]): void => {
      for (let index = 0; index < path.length - 1; index += 1) {
        list.push([path[index], path[index + 1]]);
      }
    };
    for (const feature of collection?.features ?? []) {
      const geometry = feature?.geometry;
      if (!geometry) continue;
      if (excludeId !== undefined && String(feature.id) === excludeId) continue;
      if (geometry.type === "Polygon") {
        for (const ring of geometry.coordinates) addPath(ring);
      } else if (geometry.type === "LineString") {
        addPath(geometry.coordinates);
      }
    }
    return [...list, ...this.referenceEdges];
  }

  private ensureLayer(): void {
    const map = this.map;
    if (!map || map.getSource(SOURCE_ID)) return;
    map.addSource(SOURCE_ID, {
      type: "geojson",
      data: { type: "FeatureCollection", features: [] },
    });
    map.addLayer({
      id: LAYER_ID,
      type: "line",
      source: SOURCE_ID,
      paint: {
        "line-color": this.color,
        "line-width": 1,
        "line-dasharray": [2, 3],
      },
    });
  }

  private removeLayer(): void {
    const map = this.map;
    if (!map) return;
    if (map.getLayer(LAYER_ID)) map.removeLayer(LAYER_ID);
    if (map.getSource(SOURCE_ID)) map.removeSource(SOURCE_ID);
  }

  private draw(lines: Position[][]): void {
    const map = this.map;
    if (!map) return;
    const source = map.getSource(SOURCE_ID) as GeoJSONSource | undefined;
    if (!source) return;
    source.setData({
      type: "FeatureCollection",
      features: lines.map((coordinates) => ({
        type: "Feature",
        geometry: { type: "LineString", coordinates },
        properties: {},
      })),
    });
  }

  private publishSnapping(position: Position): void {
    const helper = this.snappingHelper();
    if (!helper) return;
    helper.setCustomSnappingCoordinates(this.sectionKey, [
      [position[0], position[1]],
    ]);
  }

  private clearSnapping(): void {
    const helper = this.snappingHelper();
    if (!helper) return;
    helper.clearCustomSnappingCoordinates(this.sectionKey);
  }

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

function shapeOf(shape: DraggedShape): Feature | null {
  if (typeof shape.getGeoJson === "function") {
    try {
      return shape.getGeoJson();
    } catch {
      return null;
    }
  }
  return shape.geoJson ?? null;
}

/** Distinct corners of a polygon's outer ring, or the points of a line. */
function verticesOf(feature: Feature): Position[] {
  const geometry = feature.geometry;
  if (geometry.type === "Polygon") {
    const ring = geometry.coordinates[0] ?? [];
    return ring.slice(0, Math.max(0, ring.length - 1));
  }
  if (geometry.type === "LineString") return geometry.coordinates;
  return [];
}

/** Every coordinate moved by the same ground shift. */
function translateGeometry(
  geometry: Feature["geometry"],
  shift: Ground,
  frame: Frame,
): Feature["geometry"] {
  const move = (position: Position): Position => {
    const ground = toGround(position, frame);
    return toPosition({ x: ground.x + shift.x, y: ground.y + shift.y }, frame);
  };
  if (geometry.type === "Polygon") {
    return {
      type: "Polygon",
      coordinates: geometry.coordinates.map((ring) => ring.map(move)),
    };
  }
  if (geometry.type === "LineString") {
    return { type: "LineString", coordinates: geometry.coordinates.map(move) };
  }
  return geometry;
}
