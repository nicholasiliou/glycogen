import type { LayerTypeDefinition } from "../../engine/plugins/Registry";
import type { LayerRenderer, RenderFrame } from "../../engine/render/types";

function rgba(v: unknown, fallback = "rgba(128,128,128,1)"): string {
  if (!Array.isArray(v)) return fallback;
  const [r, g, b, a] = v as number[];
  return `rgba(${r ?? 0},${g ?? 0},${b ?? 0},${(a ?? 255) / 255})`;
}

/** A flat colour rectangle of the layer's intrinsic size. The simplest possible
 * visual system — its only job is to prove the architecture isn't plant-specific. */
class SolidRenderer implements LayerRenderer {
  private canvas = document.createElement("canvas");
  private ctx = this.canvas.getContext("2d")!;

  render(frame: RenderFrame): HTMLCanvasElement {
    const [w, h] = frame.layer.size;
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = Math.max(1, Math.round(w));
      this.canvas.height = Math.max(1, Math.round(h));
    }
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.ctx.fillStyle = rgba(frame.props.color);
    const radius = Math.max(0, Number(frame.props.cornerRadius) || 0);
    if (radius > 0 && "roundRect" in this.ctx) {
      this.ctx.beginPath();
      (this.ctx as any).roundRect(0, 0, this.canvas.width, this.canvas.height, radius);
      this.ctx.fill();
    } else {
      this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    }
    return this.canvas;
  }

  dispose(): void {
    this.canvas.width = this.canvas.height = 0;
  }
}

export const solidLayerType: LayerTypeDefinition = {
  type: "solid",
  label: "Solid",
  category: "Solids",
  icon: "Square",
  description: "A flat colour rectangle.",
  defaultSize: (comp) => [Math.round(comp.width / 2), Math.round(comp.height / 2)],
  schema: [
    { key: "color", name: "Color", type: "color", default: [192, 252, 4, 255], group: "Solid" },
    { key: "cornerRadius", name: "Corner Radius", type: "number", default: 0, group: "Solid", meta: { min: 0, max: 2000, step: 1 } },
  ],
  createRenderer: () => new SolidRenderer(),
};
