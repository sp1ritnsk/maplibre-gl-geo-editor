import type { Position } from "geojson";
import type { GeoJSONSource, Map as MapLibreMap, MapMouseEvent } from "maplibre-gl";

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

interface Pixel {
  x: number;
  y: number;
}

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
  private readonly sectionKey: string;
  private readonly color: string;
  private handleMouseMove: ((e: MapMouseEvent) => void) | null = null;

  constructor(options: AlignmentGuidesOptions = {}) {
    this.tolerance = options.tolerance ?? 8;
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

  private update(event: MapMouseEvent): void {
    if (!this.map) return;
    const cursor: Pixel = { x: event.point.x, y: event.point.y };

    let alignedX: { vertex: Position; pixel: Pixel } | null = null;
    let alignedY: { vertex: Position; pixel: Pixel } | null = null;
    let bestX = this.tolerance;
    let bestY = this.tolerance;

    for (const vertex of this.vertices()) {
      const pixel = this.toPixel(vertex);
      const dx = Math.abs(pixel.x - cursor.x);
      const dy = Math.abs(pixel.y - cursor.y);
      if (dx <= bestX) {
        bestX = dx;
        alignedX = { vertex, pixel };
      }
      if (dy <= bestY) {
        bestY = dy;
        alignedY = { vertex, pixel };
      }
    }

    if (!alignedX && !alignedY) {
      this.draw([]);
      this.clearSnapping();
      return;
    }

    // Совпало по обеим осям — цель стоит на пересечении направляющих.
    const locked: Pixel = {
      x: alignedX ? alignedX.pixel.x : cursor.x,
      y: alignedY ? alignedY.pixel.y : cursor.y,
    };
    const lines: Position[][] = [];
    if (alignedX) {
      lines.push(this.verticalGuide(alignedX.pixel.x));
    }
    if (alignedY) {
      lines.push(this.horizontalGuide(alignedY.pixel.y));
    }
    this.draw(lines);

    const lngLat = this.map.unproject([locked.x, locked.y]);
    this.publishSnapping([lngLat.lng, lngLat.lat]);
  }

  /** Вершины уже нарисованных объектов — то, с чем выравниваются. */
  private vertices(): Position[] {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const features = this.geoman?.features;
    if (!features || typeof features.getAll !== "function") return [];
    const collection = features.getAll();
    const list: Position[] = [];
    for (const feature of collection?.features ?? []) {
      const geometry = feature?.geometry;
      if (!geometry) continue;
      if (geometry.type === "Polygon") {
        for (const ring of geometry.coordinates) list.push(...ring);
      } else if (geometry.type === "LineString") {
        list.push(...geometry.coordinates);
      } else if (geometry.type === "Point") {
        list.push(geometry.coordinates);
      }
    }
    return list;
  }

  private verticalGuide(x: number): Position[] {
    const height = this.map!.getCanvas().clientHeight;
    return [this.toLngLat({ x, y: 0 }), this.toLngLat({ x, y: height })];
  }

  private horizontalGuide(y: number): Position[] {
    const width = this.map!.getCanvas().clientWidth;
    return [this.toLngLat({ x: 0, y }), this.toLngLat({ x: width, y })];
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
