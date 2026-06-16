import type { LayerTypeDefinition } from "../../engine/plugins/Registry";
import type { LayerRenderer, RenderFrame } from "../../engine/render/types";
import type { PropertyValue } from "../../engine/core/types";
import { sampleGrid } from "../_shared/textField";

function rgba(v: unknown, fallback = "rgba(255,255,255,1)"): string {
  if (!Array.isArray(v)) return fallback;
  const [r, g, b, a] = v as number[];
  return `rgba(${r ?? 255},${g ?? 255},${b ?? 255},${(a ?? 255) / 255})`;
}

/** Renders a single line/paragraph of text centred in a comp-sized buffer. */
class TextRenderer implements LayerRenderer {
  private canvas = document.createElement("canvas");
  private ctx = this.canvas.getContext("2d")!;
  private lastW = 1920;
  private lastH = 1080;

  resize(w: number, h: number): void {
    this.canvas.width = Math.max(1, w);
    this.canvas.height = Math.max(1, h);
  }

  render(frame: RenderFrame): HTMLCanvasElement {
    if (this.canvas.width !== frame.width) this.resize(frame.width, frame.height);
    this.lastW = frame.width;
    this.lastH = frame.height;
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

  fieldSource(props: Record<string, PropertyValue>): (x: number, y: number, z: number) => number {
    const grid = rasterTextGrid(props, this.lastW, this.lastH);
    if (!grid) return () => 0;
    const { data, gw, gh } = grid;
    return (x: number, y: number) => sampleGrid(data, gw, gh, x, y);
  }

  sourceKey(props: Record<string, PropertyValue>, _time: number): string {
    return [props.text, props.fontSize, props.tracking, props.bold, this.lastW, this.lastH].join("|");
  }

  dispose(): void {
    this.canvas.width = this.canvas.height = 0;
  }
}

/**
 * Rasterise the text into a small coverage grid (alpha channel → [0,1]). Mirrors
 * TextRenderer.render's font/layout so the mask matches what's drawn. Returns null when
 * no 2D context is available (e.g. jsdom in tests) so callers fall back to a zero field.
 */
function rasterTextGrid(
  props: Record<string, PropertyValue>,
  w: number,
  h: number,
): { data: Float32Array; gw: number; gh: number } | null {
  const maxDim = 256;
  const scale = maxDim / Math.max(1, Math.max(w, h));
  const gw = Math.max(1, Math.round(w * scale));
  const gh = Math.max(1, Math.round(h * scale));
  const c = document.createElement("canvas");
  c.width = gw;
  c.height = gh;
  const ctx = c.getContext("2d");
  if (!ctx) return null;
  const data = new Float32Array(gw * gh);
  const text = String(props.text ?? "");
  if (!text) return { data, gw, gh };
  const size = (Number(props.fontSize) || 120) * scale;
  const weight = props.bold ? "700" : "400";
  const family = String(props.fontFamily || "sans-serif");
  ctx.fillStyle = "#fff";
  ctx.font = `${weight} ${size}px ${family}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const tracking = (Number(props.tracking) || 0) * scale;
  if ("letterSpacing" in ctx) (ctx as unknown as { letterSpacing: string }).letterSpacing = `${tracking}px`;
  const lines = text.split("\n");
  const lh = size * 1.2;
  const startY = gh / 2 - ((lines.length - 1) * lh) / 2;
  lines.forEach((line, i) => ctx.fillText(line, gw / 2, startY + i * lh));
  const img = ctx.getImageData(0, 0, gw, gh).data;
  for (let i = 0; i < gw * gh; i++) data[i] = img[i * 4 + 3] / 255;
  return { data, gw, gh };
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
