import { Plugin, type Frame } from "../Plugin";
import { addGlyphRects, BUILTIN_GLYPHS, type GlyphData } from "./glyphData";
import { sampleGrid } from "../_shared/textField";

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

const GLYPHS: GlyphData[] = BUILTIN_GLYPHS.map((b) => b.glyph);

/**
 * Scatters pixel glyphs across a grid driven by a noise field: a cell gets a glyph when the noise
 * there exceeds a threshold, and a second noise channel picks which glyph. Deterministic over time.
 */
export class GlyphScatterLayer extends Plugin {
  cell = this.number({ min: 8, max: 160, default: 56 });
  threshold = this.number({ min: 0, max: 1, default: 0.5 });
  scale = this.number({ min: 0.1, max: 1, default: 0.8 });
  noiseScale = this.number({ min: 0.02, max: 0.5, default: 0.12 });
  speed = this.number({ min: 0, max: 1.5, default: 0.2 });
  jitter = this.number({ min: 0, max: 1, default: 0 });
  seed = this.number({ min: 0, max: 64, step: 1, default: 0 });
  textStrength = this.number({ min: 0, max: 1, default: 0.8 });

  private ctx = this.canvas.getContext("2d")!;
  // Cached flattened grid for textField sampling (gw×gh).
  private tfData: Float32Array | null = null;
  private tfGw = 0;
  private tfGh = 0;
  private tfKey = "";

  render(f: Frame): HTMLCanvasElement {
    const ctx = this.ctx;
    const w = this.canvas.width, h = this.canvas.height;
    ctx.clearRect(0, 0, w, h);

    const cellPx = Math.max(8, this.cell.value);
    const cols = Math.ceil(w / cellPx);
    const rows = Math.ceil(h / cellPx);
    const threshold = this.threshold.value;
    const scale = Math.max(0.1, Math.min(1, this.scale.value));
    const ns = this.noiseScale.value;
    const z = f.time * this.speed.value + this.seed.value * 13.1;
    const jitter = Math.max(0, Math.min(1, this.jitter.value));
    const strength = this.textStrength.value;

    // Cache a low-res raster of the textField for fast per-cell lookup.
    if (f.textField && strength > 0) {
      const gw = Math.max(2, cols), gh = Math.max(2, rows);
      const key = (f.textField.key ?? String(f.time)) + gw + "x" + gh;
      if (key !== this.tfKey || !this.tfData) {
        this.tfData = new Float32Array(gw * gh);
        for (let j2 = 0; j2 < gh; j2++)
          for (let i2 = 0; i2 < gw; i2++)
            this.tfData[j2 * gw + i2] = f.textField((i2 + 0.5) / gw, (j2 + 0.5) / gh, 0);
        this.tfGw = gw; this.tfGh = gh; this.tfKey = key;
      }
    } else {
      this.tfData = null;
    }

    ctx.fillStyle = "rgba(192,252,4,1)";
    ctx.beginPath();
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        const n = vnoise(i * ns, j * ns, z);
        // Lower threshold where text coverage is high.
        const tfBoost = this.tfData
          ? sampleGrid(this.tfData, this.tfGw, this.tfGh, i / cols, j / rows) * strength * 0.5
          : 0;
        if (n < threshold - tfBoost) continue;
        const sel = vnoise(i * ns + 91.7, j * ns + 47.3, z * 0.5);
        const g = GLYPHS[Math.min(GLYPHS.length - 1, Math.floor(sel * GLYPHS.length))];
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
    return this.canvas;
  }
}
