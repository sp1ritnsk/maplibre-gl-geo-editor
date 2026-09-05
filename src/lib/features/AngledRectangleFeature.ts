import type { Feature, Polygon, Position } from "geojson";
import type { GeoJSONSource, Map as MapLibreMap, MapMouseEvent } from "maplibre-gl";

import type { Segment } from "../utils/guideGeometry";
import { frameAt, toGround, toPosition } from "../utils/groundPlane";
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

  /**
   * Corners on the ground, not on the screen.
   *
   * Building the shape in pixels made it a rectangle in the picture and a
   * parallelogram on the map as soon as the camera was pitched. The plane is
   * anchored at the base edge, so it does not move when the camera does.
   */
  private cornersFor(position: Position): Position[] | null {
    if (this.base.length < 2) return null;
    const frame = frameAt(this.base[0]);
    const edge: Segment = [
      toGround(this.base[0], frame),
      toGround(this.base[1], frame),
    ];
    const corners = angledRectangleCorners(edge, toGround(position, frame));
    return corners ? corners.map((corner) => toPosition(corner, frame)) : null;
  }

  /**
   * Cursor position with geoman's snapping applied.
   *
   * The tool draws outside geoman, so nothing snaps it for free. Asking the
   * snapping helper for its full answer keeps this tool obeying the same
   * targets as every other tool: vertices and edges of what is drawn, and the
   * positions published by the guides and the angle lock.
   */
  private snapped(event: MapMouseEvent): Position {
    const raw: Position = [event.lngLat.lng, event.lngLat.lat];
    const helper = this.geoman?.actionInstances?.helper__snapping;
    if (!helper || typeof helper.getSnappedLngLat !== "function") return raw;
    const snapped = helper.getSnappedLngLat(raw, [event.point.x, event.point.y]);
    return snapped ? [snapped[0], snapped[1]] : raw;
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
