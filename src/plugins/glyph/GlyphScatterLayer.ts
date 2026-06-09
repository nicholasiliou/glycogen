import type { LayerTypeDefinition } from "../../engine/plugins/Registry";
import type { LayerRenderer, RenderFrame } from "../../engine/render/types";
import { addGlyphRects, BUILTIN_GLYPHS, type GlyphData } from "./glyphData";

function num(v: unknown, f: number): number {
  return typeof v === "number" ? v : f;
}
function rgba(v: unknown, f = "rgba(192,252,4,1)"): string {
  if (!Array.isArray(v)) return f;
  const [r, g, b, a] = v as number[];
  return `rgba(${r ?? 0},${g ?? 0},${b ?? 0},${(a ?? 255) / 255})`;
}

// compact smooth value noise (3D)
function hash3(x: number, y: number, z: number): number {
  let n = (x * 374761393 + y * 668265263 + z * 1274126177) | 0;
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}
function vnoise(x: number, y: number, z: number): number {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const xf = x - xi, yf = y - yi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf), w = zf * zf * (3 - 2 * zf);
  const L = (a: number, b: number, t: number) => a + (b - a) * t;
  const c = (a: number, b: number, d: number) => hash3(xi + a, yi + b, zi + d);
  const x00 = L(c(0, 0, 0), c(1, 0, 0), u), x10 = L(c(0, 1, 0), c(1, 1, 0), u);
  const x01 = L(c(0, 0, 1), c(1, 0, 1), u), x11 = L(c(0, 1, 1), c(1, 1, 1), u);
  return L(L(x00, x10, v), L(x01, x11, v), w);
}

/**
 * Scatters pixel glyphs across a grid, driven by a noise field: a cell gets a glyph
 * when the noise there exceeds a threshold, and a second noise channel picks WHICH
 * glyph. Uses the glyph set stored in layer.data.glyphs (populate it from the library
 * via the inspector), or the built-ins. Deterministic over time; one batched fill.
 */
class GlyphScatterRenderer implements LayerRenderer {
  private canvas = document.createElement("canvas");
  private ctx = this.canvas.getContext("2d")!;
  private lastFrame = -1;
  private lastKey = "";
  private forceInitial = true;

  resize(w: number, h: number): void {
    this.canvas.width = Math.max(1, Math.round(w));
    this.canvas.height = Math.max(1, Math.round(h));
  }

  render(frame: RenderFrame): HTMLCanvasElement {
    if (this.canvas.width !== frame.width || this.canvas.height !== frame.height) {
      this.resize(frame.width, frame.height);
    }
    const glyphs = this.glyphSet(frame);
    const key = JSON.stringify(frame.props) + "|" + glyphs.length + "|" + (frame.below?.key ?? "");
    const drew = this.forceInitial || frame.frame !== this.lastFrame || key !== this.lastKey;
    this.lastFrame = frame.frame;
    this.lastKey = key;
    this.forceInitial = false;
    if (drew) this.draw(frame, glyphs);
    return this.canvas;
  }

  private glyphSet(frame: RenderFrame): GlyphData[] {
    const stored = frame.layer.data.glyphs as GlyphData[] | undefined;
    if (stored && stored.length) return stored;
    return BUILTIN_GLYPHS.map((b) => b.glyph);
  }

  private draw(frame: RenderFrame, glyphs: GlyphData[]): void {
    const ctx = this.ctx;
    const w = this.canvas.width;
    const h = this.canvas.height;
    ctx.clearRect(0, 0, w, h);

    const pr = frame.props;
    const cellPx = Math.max(8, num(pr.cell, 56));
    const cols = Math.ceil(w / cellPx);
    const rows = Math.ceil(h / cellPx);
    const threshold = num(pr.threshold, 0.5);
    const scale = Math.max(0.1, Math.min(1, num(pr.scale, 0.8)));
    const ns = num(pr.noiseScale, 0.12);
    const z = frame.time * num(pr.speed, 0.2) + num(pr.seed, 0) * 13.1;
    const jitter = Math.max(0, Math.min(1, num(pr.jitter, 0)));
    // Feed off a Noise layer below, if present, instead of the internal noise.
    const field = frame.below?.field;

    ctx.fillStyle = rgba(pr.color);
    ctx.beginPath();
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        const n = field ? field(i / cols, j / rows, z) * 0.5 + 0.5 : vnoise(i * ns, j * ns, z);
        if (n < threshold) continue;
        const sel = field ? field(i / cols + 0.37, j / rows + 0.19, z * 0.5) * 0.5 + 0.5 : vnoise(i * ns + 91.7, j * ns + 47.3, z * 0.5);
        const g = glyphs[Math.min(glyphs.length - 1, Math.floor(sel * glyphs.length))];
        if (!g) continue;
        const size = cellPx * scale;
        const cell = size / Math.max(g.w, g.h);
        const jx = jitter ? (vnoise(i * ns + 5, j * ns + 5, z + 10) - 0.5) * cellPx * jitter : 0;
        const jy = jitter ? (vnoise(i * ns + 9, j * ns + 9, z + 20) - 0.5) * cellPx * jitter : 0;
        const x = i * cellPx + (cellPx - cell * g.w) / 2 + jx;
        const y = j * cellPx + (cellPx - cell * g.h) / 2 + jy;
        addGlyphRects(ctx, g, x, y, cell, cell * 0.12);
      }
    }
    ctx.fill();
  }

  dispose(): void {
    this.canvas.width = this.canvas.height = 0;
  }
}

export const glyphScatterLayerType: LayerTypeDefinition = {
  type: "glyphScatter",
  label: "Glyph Scatter",
  category: "Glyphs",
  icon: "LayoutGrid",
  description: "Scatters glyphs across a grid driven by a noise field.",
  defaultSize: (comp) => [comp.width, comp.height],
  defaultData: () => ({ glyphs: BUILTIN_GLYPHS.map((b) => b.glyph) }),
  schema: [
    { key: "cell", name: "Cell Size", type: "number", default: 56, group: "Scatter", meta: { min: 8, max: 300, step: 1 } },
    { key: "threshold", name: "Threshold", type: "number", default: 0.5, group: "Scatter", meta: { min: 0, max: 1, step: 0.01 } },
    { key: "scale", name: "Glyph Scale", type: "number", default: 0.8, group: "Scatter", meta: { min: 0.1, max: 1, step: 0.01 } },
    { key: "jitter", name: "Jitter", type: "percent", default: 0, group: "Scatter", meta: { min: 0, max: 1, step: 0.01 } },
    { key: "noiseScale", name: "Noise Scale", type: "number", default: 0.12, group: "Noise", meta: { min: 0.01, max: 1, step: 0.01 } },
    { key: "speed", name: "Evolve Speed", type: "number", default: 0.2, group: "Noise", meta: { min: -3, max: 3, step: 0.05 } },
    { key: "seed", name: "Seed", type: "number", default: 1, group: "Noise", animatable: false, meta: { min: 0, max: 9999, step: 1 } },
    { key: "color", name: "Color", type: "color", default: [192, 252, 4, 255], group: "Look" },
  ],
  createRenderer: () => new GlyphScatterRenderer(),
};
