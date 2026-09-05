import type { Feature, Polygon, Position } from "geojson";
import type { GeoJSONSource, Map as MapLibreMap, MapMouseEvent } from "maplibre-gl";

import type { Pixel, Segment } from "../utils/guideGeometry";
import { angledRectangleCorners } from "../utils/rectangleGeometry";

export interface AngledRectangleResult {
  feature: Feature<Polygon> | null;
  success: boolean;
  error?: string;
}

const SOURCE_ID = "geo-editor-angled-rectangle";
const FILL_LAYER_ID = "geo-editor-angled-rectangle-fill";
const LINE_LAYER_ID = "geo-editor-angled-rectangle-line";

/**
 * Rectangle drawn in three clicks.
 *
 * The plain rectangle tool is axis aligned, and nothing in a building is: a
 * shelving unit stands along a wall, and the wall stands at whatever angle the
 * building does. Here the first two clicks set the base edge — its direction
 * and its length — and the third sets how far the shape reaches away from it.
 *
 * Escape cancels; the mode stays on afterwards, because units are placed one
 * after another.
 */
export class AngledRectangleFeature {
  private map: MapLibreMap | null = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private geoman: any = null;
  private base: Position[] = [];
  private onComplete: ((result: AngledRectangleResult) => void) | null = null;

  private handleClick: ((e: MapMouseEvent) => void) | null = null;
  private handleMouseMove: ((e: MapMouseEvent) => void) | null = null;
  private handleKeyDown: ((e: KeyboardEvent) => void) | null = null;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  init(map: MapLibreMap, geoman?: any): void {
    this.map = map;
    this.geoman = geoman ?? null;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  setGeoman(geoman: any): void {
    this.geoman = geoman;
  }

  enable(onComplete?: (result: AngledRectangleResult) => void): void {
    if (!this.map) return;
    this.onComplete = onComplete ?? null;
    this.base = [];
    this.ensureLayers();

    this.handleClick = (e: MapMouseEvent) => this.place(e);
    this.handleMouseMove = (e: MapMouseEvent) => this.preview(e);
    this.handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") this.cancel();
    };
    this.map.on("click", this.handleClick);
    this.map.on("mousemove", this.handleMouseMove);
    document.addEventListener("keydown", this.handleKeyDown);
    this.map.getCanvas().style.cursor = "crosshair";
  }

  disable(): void {
    if (this.map) {
      if (this.handleClick) this.map.off("click", this.handleClick);
      if (this.handleMouseMove) this.map.off("mousemove", this.handleMouseMove);
      this.map.getCanvas().style.cursor = "";
    }
    if (this.handleKeyDown) {
      document.removeEventListener("keydown", this.handleKeyDown);
    }
    this.handleClick = null;
    this.handleMouseMove = null;
    this.handleKeyDown = null;
    this.cancel();
    this.onComplete = null;
  }

  destroy(): void {
    this.disable();
    this.removeLayers();
    this.map = null;
    this.geoman = null;
  }

  private cancel(): void {
    this.base = [];
    this.draw(null);
  }

  private place(event: MapMouseEvent): void {
    const position = this.snapped(event);
    if (this.base.length < 2) {
      this.base.push(position);
      return;
    }
    this.finish(position);
  }

  private preview(event: MapMouseEvent): void {
    if (this.base.length === 0) return;
    const position = this.snapped(event);
    if (this.base.length === 1) {
      this.draw([this.base[0], position, position, this.base[0]]);
      return;
    }
    const corners = this.cornersFor(position);
    if (corners) this.draw([...corners, corners[0]]);
  }

  private finish(position: Position): void {
    const corners = this.cornersFor(position);
    this.base = [];
    this.draw(null);
    if (!corners) {
      this.onComplete?.({
        feature: null,
        success: false,
        error: "Base edge has no length",
      });
      return;
    }
    this.onComplete?.({
      feature: {
        type: "Feature",
        geometry: { type: "Polygon", coordinates: [[...corners, corners[0]]] },
        properties: {},
      },
      success: true,
    });
  }

  private cornersFor(position: Position): Position[] | null {
    if (!this.map || this.base.length < 2) return null;
    const edge: Segment = [this.toPixel(this.base[0]), this.toPixel(this.base[1])];
    const corners = angledRectangleCorners(edge, this.toPixel(position));
    return corners ? corners.map((corner) => this.toLngLat(corner)) : null;
  }

  /**
   * Cursor position with geoman's snapping applied.
   *
   * The tool draws outside geoman, so nothing snaps it for free; asking the
   * snapping helper directly keeps this tool obeying the same targets — walls,
   * vertices, guides — as everything else on the map.
   */
  private snapped(event: MapMouseEvent): Position {
    const raw: Position = [event.lngLat.lng, event.lngLat.lat];
    const helper = this.geoman?.actionInstances?.helper__snapping;
    const features = this.featureData();
    if (!helper || features.length === 0) return raw;

    const point = { x: event.point.x, y: event.point.y };
    const byPoint = helper.getFeaturePointsSnapping?.(features, raw, point);
    if (byPoint) return [byPoint[0], byPoint[1]];
    const byLine = helper.getFeatureLinesSnapping?.(features, raw, point);
    if (byLine) return [byLine[0], byLine[1]];
    return raw;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private featureData(): any[] {
    const store = this.geoman?.features;
    if (!store || typeof store.forEach !== "function") return [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const list: any[] = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    store.forEach((item: any) => list.push(item));
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

  private ensureLayers(): void {
    const map = this.map;
    if (!map || map.getSource(SOURCE_ID)) return;
    map.addSource(SOURCE_ID, {
      type: "geojson",
      data: { type: "FeatureCollection", features: [] },
    });
    map.addLayer({
      id: FILL_LAYER_ID,
      type: "fill",
      source: SOURCE_ID,
      paint: { "fill-color": "#3f97e0", "fill-opacity": 0.25 },
    });
    map.addLayer({
      id: LINE_LAYER_ID,
      type: "line",
      source: SOURCE_ID,
      paint: { "line-color": "#3f97e0", "line-width": 2 },
    });
  }

  private removeLayers(): void {
    const map = this.map;
    if (!map) return;
    for (const layer of [FILL_LAYER_ID, LINE_LAYER_ID]) {
      if (map.getLayer(layer)) map.removeLayer(layer);
    }
    if (map.getSource(SOURCE_ID)) map.removeSource(SOURCE_ID);
  }

  private draw(ring: Position[] | null): void {
    const source = this.map?.getSource(SOURCE_ID) as GeoJSONSource | undefined;
    if (!source) return;
    source.setData({
      type: "FeatureCollection",
      features:
        ring === null
          ? []
          : [
              {
                type: "Feature",
                geometry: { type: "Polygon", coordinates: [ring] },
                properties: {},
              },
            ],
    });
  }
}
