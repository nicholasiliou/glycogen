import type { LayerTypeDefinition } from "../../engine/plugins/Registry";
import type { LayerRenderer } from "../../engine/render/types";

/**
 * A null/group layer. Draws nothing itself — it exists purely as a transform parent
 * (for grouping/organising) and as a handy expression source (e.g. drive several
 * layers' rotation from this one "controller"). Its `userValue` property is a free
 * control knob other layers can pickwhip to.
 */
class GroupRenderer implements LayerRenderer {
  render(): null {
    return null;
  }
  dispose(): void {}
}

export const groupLayerType: LayerTypeDefinition = {
  type: "group",
  label: "Group / Null",
  category: "Organize",
  icon: "Folder",
  description: "An empty transform parent and control source.",
  defaultSize: () => [100, 100],
  schema: [
    { key: "userValue", name: "Control Value", type: "number", default: 0, group: "Control", meta: { min: -1000, max: 1000, step: 1 } },
  ],
  createRenderer: () => new GroupRenderer(),
};
