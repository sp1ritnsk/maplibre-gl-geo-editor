import type { Feature } from "geojson";
import { describe, expect, it, vi } from "vitest";

import { AngleSnapping } from "../../src/lib/features/AngleSnapping";

/**
 * The angle lock does not move the cursor itself: it publishes candidate
 * positions and geoman's snapping pulls the cursor onto the nearest one. So
 * what these tests read is what was published.
 */

const LATITUDE = 43.2567;
const LONGITUDE = 76.9286;

/** A position offset from the origin by metres east and north. */
function at(east: number, north: number): [number, number] {
  return [
    LONGITUDE + east / (111320 * Math.cos((LATITUDE * Math.PI) / 180)),
    LATITUDE + north / 110540,
  ];
}

/** Metres east and north of the origin, for reading a published position. */
function metres([lng, lat]: number[]): { east: number; north: number } {
  return {
    east: (lng - LONGITUDE) * 111320 * Math.cos((LATITUDE * Math.PI) / 180),
    north: (lat - LATITUDE) * 110540,
  };
}

/** A 10 × 10 m room, corners anticlockwise from the south-west. */
function room(): Feature {
  return {
    type: "Feature",
    id: "room",
    properties: {},
    geometry: {
      type: "Polygon",
      coordinates: [[at(0, 0), at(10, 0), at(10, 10), at(0, 10), at(0, 0)]],
    },
  };
}

function harness() {
  const handlers = new Map<string, (event: unknown) => void>();
  const map = {
    on: (name: string, handler: (event: unknown) => void) => handlers.set(name, handler),
    off: (name: string) => handlers.delete(name),
  };
  const published: number[][][] = [];
  const cleared: string[] = [];
  const geoman = {
    actionInstances: {
      helper__snapping: {
        setCustomSnappingCoordinates: (_key: string, lngLats: number[][]) => {
          published.push(lngLats);
        },
        clearCustomSnappingCoordinates: (key: string) => cleared.push(key),
      },
    },
  };
  const snapping = new AngleSnapping();
  snapping.init(map as never, geoman);
  snapping.enable();

  const move = (position: number[]) =>
    handlers.get("mousemove")?.({
      lngLat: { lng: position[0], lat: position[1] },
      point: { x: 0, y: 0 },
    });
  const click = (position: number[]) =>
    handlers.get("click")?.({
      lngLat: { lng: position[0], lat: position[1] },
      point: { x: 0, y: 0 },
    });

  return { snapping, move, click, published, cleared };
}

describe("угловой замок при правке вершины", () => {
  it("предлагает прямой угол по обеим сторонам и их пересечение", () => {
    const { snapping, move, published } = harness();
    const shape = room();
    // Курсор берёт угол (10, 10) и уводит его на 40 см наружу и вниз.
    move(at(10, 10));
    snapping.beginVertexEdit({ getGeoJson: () => shape });
    move(at(10.4, 9.6));

    const last = published[published.length - 1].map(metres);
    // Перпендикуляр к южной стене — линия x = 10.
    expect(last.some((p) => Math.abs(p.east - 10) < 0.01 && Math.abs(p.north - 9.6) < 0.01)).toBe(
      true,
    );
    // Перпендикуляр к западной стене — линия y = 10.
    expect(last.some((p) => Math.abs(p.east - 10.4) < 0.01 && Math.abs(p.north - 10) < 0.01)).toBe(
      true,
    );
    // И сам угол, где обе стороны прямые.
    expect(last.some((p) => Math.abs(p.east - 10) < 0.01 && Math.abs(p.north - 10) < 0.01)).toBe(
      true,
    );
  });

  it("считает стороны у взятой вершины, а не у той, к которой подъехал курсор", () => {
    const { snapping, move, published } = harness();
    const shape = room();
    move(at(0, 0));
    snapping.beginVertexEdit({ getGeoJson: () => shape });
    // Тащим угол (0, 0) через весь зал — вплотную к соседнему углу (10, 0).
    move(at(9.6, -0.4));

    const last = published[published.length - 1].map(metres);
    // Стороны при взятой вершине дают диагональ от (10, 0) — курсор уже на ней.
    expect(last.some((p) => Math.abs(p.east - 9.6) < 0.01 && Math.abs(p.north + 0.4) < 0.01)).toBe(
      true,
    );
    // Если бы вершину переопределили по близости курсора, замок считался бы от
    // сторон угла (10, 0) и предложил бы точку на южной стене.
    expect(last.some((p) => Math.abs(p.east - 9.6) < 0.01 && Math.abs(p.north) < 0.01)).toBe(false);
  });

  it("отпускает вершину и перестаёт что-либо навязывать", () => {
    const { snapping, move, published, cleared } = harness();
    snapping.beginVertexEdit({ getGeoJson: () => room() });
    move(at(10.4, 9.6));
    const before = published.length;

    snapping.endVertexEdit();
    move(at(11, 9));

    expect(published.length).toBe(before);
    expect(cleared.length).toBeGreaterThan(0);
  });

  it("клик вне рисования не становится углом будущей фигуры", () => {
    const { move, click, published } = harness();
    // Инструмент не взят: два клика по карте — это выделение, а не стороны.
    click(at(0, 0));
    click(at(10, 0));
    move(at(10, 5));

    expect(published).toHaveLength(0);
  });

  it("при взятом инструменте угол отсчитывается от предыдущей стороны", () => {
    const { snapping, move, click, published } = harness();
    snapping.setDrawing(true);
    click(at(0, 0));
    click(at(10, 0));
    // Ведём третью точку почти перпендикулярно первой стороне.
    move(at(10.3, 6));

    const last = published[published.length - 1].map(metres);
    expect(last).toHaveLength(1);
    expect(last[0].east).toBeCloseTo(10, 1);
    expect(last[0].north).toBeCloseTo(6, 1);
  });
});
