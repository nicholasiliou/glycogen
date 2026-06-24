import type { LayerTypeDefinition } from "../../engine/plugins/Registry";
import type { LayerRenderer } from "../../engine/render/types";

class NoopRenderer implements LayerRenderer {
  render(): null {
    return null;
  }
  dispose(): void {}
}

/**
 * A Group is a real compositing container (kind: "group"). The compositor renders its
 * child layers into an isolated buffer, so blend modes and effect layers placed
 * between children stay scoped to the group, then composites that buffer with the
 * group's own opacity/blend. This is how you nest blending between a subset of layers.
 */
export const groupLayerType: LayerTypeDefinition = {
  type: "group",
  label: "Group",
  category: "Organize",
  icon: "Folder",
  kind: "group",
  description: "A compositing container — nests blending & effects across its child layers.",
  defaultSize: (comp) => [comp.width, comp.height],
  schema: [],
  createRenderer: () => new NoopRenderer(),
};

/**
 * A Null is transform/control only — it draws nothing. Parent layers to it to drive
 * their transforms, or pickwhip to its `userValue` knob as a shared controller.
 */
export const nullLayerType: LayerTypeDefinition = {
  type: "null",
  label: "Null / Control",
  category: "Organize",
  icon: "Crosshair",
  kind: "content",
  description: "An empty transform parent and expression control source.",
  defaultSize: () => [100, 100],
  schema: [
    { key: "userValue", name: "Control Value", type: "number", default: 0, group: "Control", meta: { min: -1000, max: 1000, step: 1 } },
  ],
  createRenderer: () => new NoopRenderer(),
};
