import type { Feature } from "geojson";
import { describe, expect, it, vi } from "vitest";

import { GeoEditor } from "../../src/lib/core/GeoEditor";

/**
 * Geoman hands its global listener every event twice — the internal system
 * form and the converted one — and this control must act on exactly one of
 * them. These tests drive the listener with both forms, the way geoman does.
 */

type Listener = (event: Record<string, unknown>) => void;

function square(id: string, size = 0.001): Feature {
  return {
    type: "Feature",
    id,
    properties: {},
    geometry: {
      type: "Polygon",
      coordinates: [
        [
          [0, 0],
          [size, 0],
          [size, size],
          [0, size],
          [0, 0],
        ],
      ],
    },
  };
}

/** Geoman's record of a shape, as far as the control touches it. */
function record(feature: Feature) {
  let current = feature;
  return {
    id: String(feature.id),
    shape: "polygon",
    getGeoJson: () => current,
    updateGeometry: (geometry: Feature["geometry"]) => {
      current = { ...current, geometry };
    },
    delete: () => {},
  };
}

function makeEditor(records: ReturnType<typeof record>[]) {
  const onFeatureEdit = vi.fn();
  const onFeatureDelete = vi.fn();
  const onSelectionChange = vi.fn();
  const editor = new GeoEditor({
    onFeatureEdit,
    onFeatureDelete,
    onSelectionChange,
    enableHistory: false,
  });
  let listener: Listener | null = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const anyEditor = editor as any;
  anyEditor.geoman = {
    setGlobalEventsListener: (callback: Listener) => {
      listener = callback;
    },
    features: {
      forEach: (visit: (item: unknown) => void) => records.forEach(visit),
      getAll: () => ({
        type: "FeatureCollection",
        features: records.map((item) => item.getGeoJson()),
      }),
    },
  };
  // Map-bound side effects are not under test.
  anyEditor.updateSelectionHighlight = () => {};
  anyEditor.logSelectedFeatureCollection = () => {};
  anyEditor.beginDragGuides = () => {};
  anyEditor.endDragGuides = () => {};
  anyEditor.alignOnRelease = (feature: Feature) => feature;
  anyEditor.setupGeomanEvents();
  const fire = (event: Record<string, unknown>) => listener?.(event);
  return { editor, fire, onFeatureEdit, onFeatureDelete, onSelectionChange };
}

describe("geoman events reach the host once", () => {
  it("reports a finished drag through onFeatureEdit exactly once", () => {
    const shape = record(square("a"));
    const { fire, onFeatureEdit } = makeEditor([shape]);

    for (const name of ["_gm:edit", "gm:dragstart"]) {
      fire({ name, action: "feature_edit_start", feature: shape });
    }
    shape.updateGeometry(square("a", 0.002).geometry);
    for (const name of ["_gm:edit", "gm:dragend"]) {
      fire({ name, action: "feature_edit_end", feature: shape });
    }

    expect(onFeatureEdit).toHaveBeenCalledTimes(1);
    const [edited, original] = onFeatureEdit.mock.calls[0] as [Feature, Feature];
    expect(edited.geometry).toEqual(square("a", 0.002).geometry);
    expect(original.geometry).toEqual(square("a").geometry);
  });

  it("selects the shape that is taken hold of", () => {
    const shape = record(square("a"));
    const { editor, fire, onSelectionChange } = makeEditor([shape]);

    fire({ name: "gm:dragstart", action: "feature_edit_start", feature: shape });

    expect(editor.getSelectedFeatures().map((f) => f.id)).toEqual(["a"]);
    expect(onSelectionChange).toHaveBeenCalledTimes(1);
  });

  it("reports geoman's own removal tool through onFeatureDelete", () => {
    const shape = record(square("a"));
    const { fire, onFeatureDelete } = makeEditor([shape]);

    for (const name of ["_gm:edit", "gm:remove"]) {
      fire({ name, action: "feature_removed", feature: shape });
    }

    expect(onFeatureDelete).toHaveBeenCalledTimes(1);
    expect(onFeatureDelete).toHaveBeenCalledWith("a");
  });

  it("stays quiet about removals caused by loading a plan", () => {
    const shape = record(square("a"));
    const { editor, fire, onFeatureDelete } = makeEditor([shape]);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (editor as any).loadingGeoJson = true;
    fire({ name: "gm:remove", action: "feature_removed", feature: shape });

    expect(onFeatureDelete).not.toHaveBeenCalled();
  });
});
