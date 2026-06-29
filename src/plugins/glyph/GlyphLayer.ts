import { Plugin, type Frame } from "../Plugin";
import { addGlyphRects, BUILTIN_GLYPHS, type GlyphData } from "./glyphData";

/** Draws a single pixel glyph scaled to fill the layer. Cycle through the built-in glyphs with the pad. */
export class GlyphLayer extends Plugin {
  glyph = this.pad(4); // cycles the built-in glyph set
  padding = this.knob(0, { min: 0, max: 0.4, default: 0.08 });
  gap = this.knob(1, { min: 0, max: 0.9, default: 0.08 });

  private ctx = this.canvas.getContext("2d")!;

  render(_f: Frame): HTMLCanvasElement {
    const cw = this.canvas.width, ch = this.canvas.height;
    const ctx = this.ctx;
    ctx.clearRect(0, 0, cw, ch);

    const g: GlyphData = this.glyph.pick(BUILTIN_GLYPHS).glyph;
    const pad = this.padding.value;
    const availW = cw * (1 - 2 * pad);
    const availH = ch * (1 - 2 * pad);
    const cell = Math.min(availW / g.w, availH / g.h);
    const ox = (cw - cell * g.w) / 2;
    const oy = (ch - cell * g.h) / 2;
    const gap = cell * Math.max(0, Math.min(0.9, this.gap.value));

    ctx.fillStyle = "rgba(192,252,4,1)";
    ctx.beginPath();
    addGlyphRects(ctx, g, ox, oy, cell, gap);
    ctx.fill();
    return this.canvas;
  }
}
