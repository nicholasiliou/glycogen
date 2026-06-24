import type { LayerTypeDefinition } from "../../engine/plugins/Registry";
import type { LayerRenderer } from "../../engine/render/types";
import type { PropertyValue } from "../../engine/core/types";

function num(v: unknown, f: number): number {
  return typeof v === "number" ? v : f;
}

const GOLDEN = 137.50776405; // golden angle, degrees

/** Compute a child's slot (centre-relative px) from the layout mode. */
function layout(index: number, count: number, props: Record<string, PropertyValue>): { x: number; y: number; rotation?: number; scale?: number } {
  const mode = String(props.mode ?? "grid");
  const spacing = num(props.spacing, 240);
  const cols = Math.max(1, Math.round(num(props.columns, 4)));
  const radius = num(props.radius, 360);
  const startAngle = num(props.startAngle, -90);
  const angleStep = num(props.angleStep, 24);
  const scaleStep = num(props.scaleStep, 0);
  const faceOut = props.faceOutward === true;
  const scale = 1 + index * scaleStep;
  const d2r = Math.PI / 180;

  switch (mode) {
    case "row":
      return { x: (index - (count - 1) / 2) * spacing, y: 0, scale };
    case "column":
      return { x: 0, y: (index - (count - 1) / 2) * spacing, scale };
    case "fibonacci": {
      const a = index * GOLDEN * d2r;
      const r = spacing * 0.14 * Math.sqrt(index + 0.5);
      return { x: r * Math.cos(a), y: r * Math.sin(a), scale };
    }
    case "sundial": {
      const a = (startAngle + (index * 360) / Math.max(1, count)) * d2r;
      return { x: radius * Math.cos(a), y: radius * Math.sin(a), rotation: faceOut ? (a / d2r) + 90 : 0, scale };
    }
    case "spiral": {
      const a = (startAngle + index * angleStep) * d2r;
      const r = spacing * 0.12 * index;
      return { x: r * Math.cos(a), y: r * Math.sin(a), rotation: faceOut ? (a / d2r) + 90 : 0, scale };
    }
    default: {
      // grid
      const rows = Math.ceil(count / cols);
      const cx = index % cols;
      const cy = Math.floor(index / cols);
      return { x: (cx - (cols - 1) / 2) * spacing, y: (cy - (rows - 1) / 2) * spacing, scale };
    }
  }
}

class NoopRenderer implements LayerRenderer {
  render(): null {
    return null;
  }
  dispose(): void {}
}

/**
 * An auto-layout container (inspired by Figma auto-layout, plus generative options).
 * It composites its children into an isolated buffer like a group, but ALSO arranges
 * their positions: grid / row / column, or the creative fibonacci (phyllotaxis),
 * sundial (radial), and spiral layouts. All layout params are animatable.
 */
export const layoutLayerType: LayerTypeDefinition = {
  type: "layout",
  label: "Auto-Layout",
  category: "Organize",
  icon: "LayoutDashboard",
  kind: "layout",
  layout,
  description: "Arranges its child layers automatically (grid / row / column / fibonacci / sundial / spiral).",
  defaultSize: (comp) => [comp.width, comp.height],
  schema: [
    { key: "mode", name: "Mode", type: "select", default: "grid", group: "Layout", meta: { options: [
      { label: "Grid", value: "grid" }, { label: "Row", value: "row" }, { label: "Column", value: "column" },
      { label: "Fibonacci", value: "fibonacci" }, { label: "Sundial", value: "sundial" }, { label: "Spiral", value: "spiral" } ] } },
    { key: "spacing", name: "Spacing", type: "number", default: 240, group: "Layout", meta: { min: 0, max: 2000, step: 1 } },
    { key: "columns", name: "Columns", type: "number", default: 4, group: "Grid", meta: { min: 1, max: 40, step: 1 } },
    { key: "radius", name: "Radius", type: "number", default: 360, group: "Radial", meta: { min: 0, max: 2000, step: 1 } },
    { key: "startAngle", name: "Start Angle", type: "angle", default: -90, group: "Radial", meta: { step: 1, unit: "°" } },
    { key: "angleStep", name: "Angle Step", type: "angle", default: 24, group: "Radial", meta: { step: 1, unit: "°" } },
    { key: "faceOutward", name: "Rotate to Face", type: "boolean", default: false, group: "Radial" },
    { key: "scaleStep", name: "Scale Step", type: "number", default: 0, group: "Layout", meta: { min: -0.2, max: 0.5, step: 0.005 } },
  ],
  createRenderer: () => new NoopRenderer(),
};
