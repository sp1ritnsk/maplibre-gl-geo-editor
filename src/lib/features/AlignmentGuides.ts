import type { Position } from "geojson";
import type { GeoJSONSource, Map as MapLibreMap, MapMouseEvent } from "maplibre-gl";

import {
  distance,
  distanceToLine,
  extend,
  footOnLine,
  lineIntersection,
  midpoint,
  type Pixel,
  type Segment,
} from "../utils/guideGeometry";

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
   */
  private update(event: MapMouseEvent): void {
    if (!this.map) return;
    const cursor: Pixel = { x: event.point.x, y: event.point.y };
    const edges = this.edges().map(
      (edge): Segment => [this.toPixel(edge[0]), this.toPixel(edge[1])],
    );

    // Рёбра, продолжение которых проходит под курсором.
    const engaged = edges
      .map((edge) => ({ edge, gap: distanceToLine(cursor, edge) }))
      .filter(
        (item): item is { edge: Segment; gap: number } =>
          item.gap !== null && item.gap <= this.tolerance,
      )
      .sort((left, right) => left.gap - right.gap)
      .slice(0, 2);

    if (engaged.length >= 2) {
      const crossing = lineIntersection(engaged[0].edge, engaged[1].edge);
      if (crossing && distance(crossing, cursor) <= this.crossingTolerance) {
        this.show([engaged[0].edge, engaged[1].edge], crossing);
        return;
      }
    }

    const middle = this.nearestMidpoint(cursor, edges);
    if (middle) {
      this.show([middle.edge], middle.point);
      return;
    }

    if (engaged.length >= 1) {
      const foot = footOnLine(cursor, engaged[0].edge);
      if (foot) {
        this.show([engaged[0].edge], foot);
        return;
      }
    }

    this.draw([]);
    this.clearSnapping();
  }

  /** Середина ребра — по ней ставят стеллаж по центру прохода. */
  private nearestMidpoint(
    cursor: Pixel,
    edges: Segment[],
  ): { edge: Segment; point: Pixel } | null {
    let best: { edge: Segment; point: Pixel } | null = null;
    let bestGap = this.tolerance;
    for (const edge of edges) {
      const point = midpoint(edge);
      const gap = distance(cursor, point);
      if (gap <= bestGap) {
        bestGap = gap;
        best = { edge, point };
      }
    }
    return best;
  }

  private show(edges: Segment[], target: Pixel): void {
    const span = this.guideLength();
    const lines: Position[][] = [];
    for (const edge of edges) {
      const stretched = extend(edge, span);
      if (stretched) {
        lines.push([this.toLngLat(stretched[0]), this.toLngLat(stretched[1])]);
      }
    }
    this.draw(lines);
    this.publishSnapping(this.toLngLat(target));
  }

  /** Половина диагонали окна: направляющая обязана дотянуться до краёв. */
  private guideLength(): number {
    const canvas = this.map!.getCanvas();
    return Math.hypot(canvas.clientWidth, canvas.clientHeight);
  }

  /** Рёбра уже нарисованных объектов — то, что продолжают направляющие. */
  private edges(): Array<[Position, Position]> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const features = this.geoman?.features;
    if (!features || typeof features.getAll !== "function") return [];
    const collection = features.getAll();
    const list: Array<[Position, Position]> = [];
    const addRing = (ring: Position[], closed: boolean): void => {
      const count = closed ? ring.length - 1 : ring.length - 1;
      for (let index = 0; index < count; index += 1) {
        list.push([ring[index], ring[index + 1]]);
      }
    };
    for (const feature of collection?.features ?? []) {
      const geometry = feature?.geometry;
      if (!geometry) continue;
      if (geometry.type === "Polygon") {
        for (const ring of geometry.coordinates) addRing(ring, true);
      } else if (geometry.type === "LineString") {
        addRing(geometry.coordinates, false);
      }
    }
    return list;
  }

  private toPixel(position: Position): Pixel {
    const point = this.map!.project([position[0], position[1]]);
    return { x: point.x, y: point.y };
  }

  private toLngLat(pixel: Pixel): Position {
    const lngLat = this.map!.unproject([pixel.x, pixel.y]);
    return [lngLat.lng, lngLat.lat];
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
