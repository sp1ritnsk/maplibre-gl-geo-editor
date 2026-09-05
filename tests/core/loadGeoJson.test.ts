import type { Feature } from "geojson";
import { describe, expect, it, vi } from "vitest";

import { GeoEditor } from "../../src/lib/core/GeoEditor";

/**
 * loadGeoJson has to wait for geoman — for its readiness, its clear and its
 * import — without any timer standing in for the wait, and to leave the undo
 * history empty: a load is a new baseline, not an edit.
 */

function point(id: string): Feature {
  return {
    type: "Feature",
    id,
    properties: {},
    geometry: { type: "Point", coordinates: [0, 0] },
  };
}

function makeEditor(loaded: boolean) {
  const order: string[] = [];
  const editor = new GeoEditor({ fitBoundsOnLoad: false });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const anyEditor = editor as any;
  anyEditor.geoman = {
    loaded,
    waitForGeomanLoaded: vi.fn(async () => {
      order.push("ready");
    }),
    features: {
      deleteAll: vi.fn(async () => {
        order.push("clear");
      }),
      importGeoJson: vi.fn(async () => {
        order.push("import");
        return { stats: { success: 1 } };
      }),
      forEach: () => {},
    },
  };
  anyEditor.clearSelection = () => {};
  anyEditor.emitEvent = () => {};
  return { editor, order, anyEditor };
}

describe("loadGeoJson", () => {
  it("waits for readiness, then clears, then imports", async () => {
    const { editor, order } = makeEditor(false);

    const result = await editor.loadGeoJson(point("a"));

    expect(order).toEqual(["ready", "clear", "import"]);
    expect(result.count).toBe(1);
  });

  it("does not ask an already loaded geoman to wait", async () => {
    const { editor, order, anyEditor } = makeEditor(true);

    await editor.loadGeoJson(point("a"));

    expect(anyEditor.geoman.waitForGeomanLoaded).not.toHaveBeenCalled();
    expect(order).toEqual(["clear", "import"]);
  });

  it("uses no timers", async () => {
    vi.useFakeTimers();
    try {
      const { editor } = makeEditor(false);
      // With a timer in the way this would never resolve under fake timers.
      await expect(editor.loadGeoJson(point("a"))).resolves.toBeDefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it("clears the undo history: a load is a new baseline", async () => {
    const { editor, anyEditor } = makeEditor(true);
    anyEditor.historyManager.record({
      description: "old edit",
      type: "edit",
      execute: () => {},
      undo: () => {},
    });
    expect(editor.canUndo()).toBe(true);

    await editor.loadGeoJson(point("a"));

    expect(editor.canUndo()).toBe(false);
  });

  it("surfaces a failed import instead of swallowing it", async () => {
    const { editor, anyEditor } = makeEditor(true);
    anyEditor.geoman.features.importGeoJson = vi.fn(async () => {
      throw new Error("Missing source for feature creation");
    });

    await expect(editor.loadGeoJson(point("a"))).rejects.toThrow("Missing source");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((editor as any).loadingGeoJson).toBe(false);
  });
});
