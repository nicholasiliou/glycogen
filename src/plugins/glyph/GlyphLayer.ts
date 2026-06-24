import type { LayerTypeDefinition } from "../../engine/plugins/Registry";
import type { LayerRenderer, RenderFrame } from "../../engine/render/types";
import { addGlyphRects, BUILTIN_GLYPHS, cloneGlyph, emptyGlyph, type GlyphData } from "./glyphData";

function num(v: unknown, f: number): number {
  return typeof v === "number" ? v : f;
}
function rgba(v: unknown, fallback: string): string {
  if (!Array.isArray(v)) return fallback;
  const [r, g, b, a] = v as number[];
  return `rgba(${r ?? 0},${g ?? 0},${b ?? 0},${(a ?? 255) / 255})`;
}

/** Draws a single pixel glyph (from layer.data.glyph) scaled to fill the layer. */
class GlyphRenderer implements LayerRenderer {
  private canvas = document.createElement("canvas");
  private ctx = this.canvas.getContext("2d")!;
  private lastData?: GlyphData;
  private lastKey = "";

  render(frame: RenderFrame): HTMLCanvasElement {
    const [w, h] = frame.layer.size;
    const cw = Math.max(1, Math.round(w));
    const ch = Math.max(1, Math.round(h));
    const g = (frame.layer.data.glyph as GlyphData) || emptyGlyph();
    const key = `${cw}x${ch}|${JSON.stringify(frame.props)}`;
    if (this.canvas.width === cw && this.canvas.height === ch && g === this.lastData && key === this.lastKey) {
      return this.canvas;
    }
    this.canvas.width = cw;
    this.canvas.height = ch;
    this.lastData = g;
    this.lastKey = key;

    const ctx = this.ctx;
    ctx.clearRect(0, 0, cw, ch);

    const bg = frame.props.background;
    if (Array.isArray(bg) && (bg[3] ?? 0) > 0) {
      ctx.fillStyle = rgba(bg, "rgba(0,0,0,0)");
      ctx.fillRect(0, 0, cw, ch);
    }

    const pad = num(frame.props.padding, 0.08);
    const availW = cw * (1 - 2 * pad);
    const availH = ch * (1 - 2 * pad);
    const cell = Math.min(availW / g.w, availH / g.h);
    const ox = (cw - cell * g.w) / 2;
    const oy = (ch - cell * g.h) / 2;
    const gap = cell * Math.max(0, Math.min(0.9, num(frame.props.gap, 0.08)));

    ctx.fillStyle = rgba(frame.props.color, "rgba(192,252,4,1)");
    ctx.beginPath();
    addGlyphRects(ctx, g, ox, oy, cell, gap);
    ctx.fill();
    return this.canvas;
  }

  dispose(): void {
    this.canvas.width = this.canvas.height = 0;
  }
}

export const glyphLayerType: LayerTypeDefinition = {
  type: "glyph",
  label: "Glyph",
  category: "Glyphs",
  icon: "Grid2x2",
  description: "A pixel glyph you can paint and save as a preset.",
  defaultSize: (comp) => [Math.round(Math.min(comp.width, comp.height) * 0.4), Math.round(Math.min(comp.width, comp.height) * 0.4)],
  defaultData: () => ({ glyph: cloneGlyph(BUILTIN_GLYPHS[Math.floor(Math.random() * BUILTIN_GLYPHS.length)].glyph) }),
  schema: [
    { key: "color", name: "Color", type: "color", default: [192, 252, 4, 255], group: "Glyph" },
    { key: "background", name: "Background", type: "color", default: [0, 0, 0, 0], group: "Glyph" },
    { key: "padding", name: "Padding", type: "percent", default: 0.08, group: "Glyph", meta: { min: 0, max: 0.45, step: 0.01 } },
    { key: "gap", name: "Pixel Gap", type: "percent", default: 0.08, group: "Glyph", meta: { min: 0, max: 0.9, step: 0.01 } },
  ],
  createRenderer: () => new GlyphRenderer(),
};
