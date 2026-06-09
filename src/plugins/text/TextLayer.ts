import type { LayerTypeDefinition } from "../../engine/plugins/Registry";
import type { LayerRenderer, RenderFrame } from "../../engine/render/types";

function rgba(v: unknown, fallback = "rgba(255,255,255,1)"): string {
  if (!Array.isArray(v)) return fallback;
  const [r, g, b, a] = v as number[];
  return `rgba(${r ?? 255},${g ?? 255},${b ?? 255},${(a ?? 255) / 255})`;
}

/** Renders a single line/paragraph of text centred in a comp-sized buffer. */
class TextRenderer implements LayerRenderer {
  private canvas = document.createElement("canvas");
  private ctx = this.canvas.getContext("2d")!;

  resize(w: number, h: number): void {
    this.canvas.width = Math.max(1, w);
    this.canvas.height = Math.max(1, h);
  }

  render(frame: RenderFrame): HTMLCanvasElement {
    if (this.canvas.width !== frame.width) this.resize(frame.width, frame.height);
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    const text = String(frame.props.text ?? "");
    const size = Number(frame.props.fontSize) || 120;
    const weight = frame.props.bold ? "700" : "400";
    const family = String(frame.props.fontFamily || "sans-serif");
    ctx.fillStyle = rgba(frame.props.color);
    ctx.font = `${weight} ${size}px ${family}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const tracking = Number(frame.props.tracking) || 0;
    if ("letterSpacing" in ctx) (ctx as any).letterSpacing = `${tracking}px`;

    const lines = text.split("\n");
    const lh = size * 1.2;
    const startY = this.canvas.height / 2 - ((lines.length - 1) * lh) / 2;
    lines.forEach((line, i) => ctx.fillText(line, this.canvas.width / 2, startY + i * lh));
    return this.canvas;
  }

  dispose(): void {
    this.canvas.width = this.canvas.height = 0;
  }
}

export const textLayerType: LayerTypeDefinition = {
  type: "text",
  label: "Text",
  category: "Text",
  icon: "Type",
  description: "A text block.",
  defaultSize: (comp) => [comp.width, comp.height],
  schema: [
    { key: "text", name: "Text", type: "string", default: "Marathon", group: "Text" },
    { key: "fontSize", name: "Font Size", type: "number", default: 160, group: "Text", meta: { min: 4, max: 2000, step: 1 } },
    { key: "tracking", name: "Tracking", type: "number", default: 0, group: "Text", meta: { min: -50, max: 200, step: 1 } },
    { key: "bold", name: "Bold", type: "boolean", default: false, group: "Text" },
    { key: "color", name: "Color", type: "color", default: [255, 255, 255, 255], group: "Text" },
  ],
  defaultData: () => ({ fontFamily: "sans-serif" }),
  createRenderer: () => new TextRenderer(),
};
