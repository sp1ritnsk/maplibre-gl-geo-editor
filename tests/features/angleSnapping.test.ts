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

/** Пикселей на метр в поддельной карте: масштаб плана зала. */
const SCALE = 10;

function harness() {
  const handlers = new Map<string, (event: unknown) => void>();
  const toScreen = (position: number[]) => {
    const { east, north } = metres(position);
    return { x: 400 + east * SCALE, y: 300 - north * SCALE };
  };
  const map = {
    on: (name: string, handler: (event: unknown) => void) => handlers.set(name, handler),
    off: (name: string) => handlers.delete(name),
    project: (position: number[]) => toScreen(position),
    unproject: ([x, y]: number[]) => {
      const east = (x - 400) / SCALE;
      const north = (300 - y) / SCALE;
      const [lng, lat] = at(east, north);
      return { lng, lat };
    },
    getCanvas: () => ({ clientWidth: 800, clientHeight: 600 }),
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
      point: toScreen(position),
    });
  const click = (position: number[]) =>
    handlers.get("click")?.({
      lngLat: { lng: position[0], lat: position[1] },
      point: toScreen(position),
    });

  const drawn: number[][][] = [];
  snapping.setGuideRenderer((lines) => drawn.push(lines));

  return { snapping, move, click, published, cleared, drawn };
}

describe("угловой замок при правке вершины", () => {
  it("у самого угла предлагает угол, а не его стороны", () => {
    const { snapping, move, published } = harness();
    const shape = room();
    // Курсор берёт угол (10, 10) и уводит его на 40 см наружу и вниз.
    move(at(10, 10));
    snapping.beginVertexEdit({ getGeoJson: () => shape });
    move(at(10.4, 9.6));

    // Пересечение линий всегда дальше от курсора, чем каждая из них, и по
    // правилу «кто ближе» проиграло бы. У угла предлагается только оно —
    // иначе вершина садилась бы на одну сторону, а вторая оставалась кривой.
    const last = published[published.length - 1].map(metres);
    expect(last).toHaveLength(1);
    expect(last[0].east).toBeCloseTo(10, 2);
    expect(last[0].north).toBeCloseTo(10, 2);
  });

  it("поодаль от угла предлагает его стороны", () => {
    const { snapping, move, published } = harness();
    const shape = room();
    move(at(10, 10));
    snapping.beginVertexEdit({ getGeoJson: () => shape });
    // Вдоль восточной стены, в пяти метрах от угла: сам угол уже далеко.
    move(at(10.1, 5));

    const last = published[published.length - 1].map(metres);
    expect(last).toHaveLength(2);
    expect(last.some((p) => Math.abs(p.east - 10) < 0.01 && Math.abs(p.north - 5) < 0.01)).toBe(
      true,
    );
  });

  it("считает стороны у взятой вершины, а не у той, к которой подъехал курсор", () => {
    const { snapping, move, published } = harness();
    const shape = room();
    move(at(0, 0));
    snapping.beginVertexEdit({ getGeoJson: () => shape });
    // Тащим угол (0, 0) вдоль южной стены: ближайшая к курсору вершина здесь
    // уже соседняя, (10, 0).
    move(at(6, -0.35));

    const last = published[published.length - 1].map(metres);
    // Продолжение западной стены под 45° — сторона при взятой вершине.
    expect(last.some((p) => Math.abs(p.east - 8.18) < 0.05 && Math.abs(p.north - 1.82) < 0.05)).toBe(
      true,
    );
    // От сторон соседней вершины замок дал бы точку на восточной стене.
    expect(last.some((p) => Math.abs(p.east - 10) < 0.05)).toBe(false);
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

describe("линии замка", () => {
  it("показывает линию, к которой притянет, когда рука подходит близко", () => {
    const { snapping, move, drawn } = harness();
    move(at(10, 10));
    snapping.beginVertexEdit({ getGeoJson: () => room() });
    // 0.4 м мимо прямого угла — по экрану 4 px при 10 px на метр.
    move(at(10.4, 9.6));

    const last = drawn[drawn.length - 1];
    expect(last.length).toBeGreaterThan(0);
    // Линия идёт по направлению стороны: перпендикуляр к южной стене — вертикаль.
    const vertical = last.find((line) => {
      const [from, to] = line.map(metres);
      return Math.abs(from.east - to.east) < 0.01;
    });
    expect(vertical).toBeDefined();
  });

  it("не рисует линий, до которых рука ещё далеко", () => {
    const { snapping, move, drawn } = harness();
    move(at(10, 10));
    snapping.beginVertexEdit({ getGeoJson: () => room() });
    // 12 м мимо: замок такой длины не подсказка, а помеха.
    move(at(22, 22));

    expect(drawn[drawn.length - 1]).toEqual([]);
  });

  it("убирает линии, когда вершину отпустили", () => {
    const { snapping, move, drawn } = harness();
    move(at(10, 10));
    snapping.beginVertexEdit({ getGeoJson: () => room() });
    move(at(10.4, 9.6));

    snapping.endVertexEdit();

    expect(drawn[drawn.length - 1]).toEqual([]);
  });
});
