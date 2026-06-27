import type { LayerTypeDefinition } from "../../engine/plugins/Registry";
import type { LayerRenderer, RenderFrame } from "../../engine/render/types";
import { fieldToMask, resolveTextMode, textSettingOf, type TextMode } from "../_shared/textField";

function num(v: unknown, f: number): number {
  return typeof v === "number" ? v : f;
}
function arr(v: unknown, f: number[]): number[] {
  return Array.isArray(v) ? (v as number[]) : f;
}

// ── deterministic hash + 3D value-noise ──────────────────────────────────────
// The third axis is the animation axis: instead of sliding the field in X/Y (which
// looks like a panned texture), we evolve through Z. Contours then morph *in place* —
// splitting, merging, drifting — like ripples on water.
function hash3(ix: number, iy: number, iz: number, seed: number): number {
  let h = (ix * 374761393 + iy * 668265263 + iz * 1610612741 + seed * 2246822519) | 0;
  h = (h ^ (h >>> 13)) | 0;
  h = Math.imul(h, 1274126177) | 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}
function valueNoise3(x: number, y: number, z: number, seed: number): number {
  const x0 = Math.floor(x), y0 = Math.floor(y), z0 = Math.floor(z);
  const fx = smooth(x - x0), fy = smooth(y - y0), fz = smooth(z - z0);
  // 8 lattice corners, trilinear blend
  const c000 = hash3(x0,     y0,     z0,     seed);
  const c100 = hash3(x0 + 1, y0,     z0,     seed);
  const c010 = hash3(x0,     y0 + 1, z0,     seed);
  const c110 = hash3(x0 + 1, y0 + 1, z0,     seed);
  const c001 = hash3(x0,     y0,     z0 + 1, seed);
  const c101 = hash3(x0 + 1, y0,     z0 + 1, seed);
  const c011 = hash3(x0,     y0 + 1, z0 + 1, seed);
  const c111 = hash3(x0 + 1, y0 + 1, z0 + 1, seed);
  const x00 = c000 + (c100 - c000) * fx;
  const x10 = c010 + (c110 - c010) * fx;
  const x01 = c001 + (c101 - c001) * fx;
  const x11 = c011 + (c111 - c011) * fx;
  const y0v = x00 + (x10 - x00) * fy;
  const y1v = x01 + (x11 - x01) * fy;
  return y0v + (y1v - y0v) * fz; // 0..1
}
/** Fractal Brownian motion in 3D — z is the time/evolution axis. */
function fbm3(x: number, y: number, z: number, seed: number, octaves: number): number {
  let amp = 0.5, freq = 1, sum = 0, norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += amp * valueNoise3(x * freq, y * freq, z * freq, seed + o * 1013);
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return sum / norm; // 0..1
}

const MAX_CELLS = 200000;

/**
 * Contour / topographic lines — iso-lines from a 3D fBm field via marching squares.
 *
 * Animation works by walking the field's third axis (z) over time rather than
 * translating it, so individual contours mutate in place: loops pinch off, merge, and
 * swim around like a liquid surface. A second, independently-animated domain warp adds
 * the swirling "floating on water" motion. Both motions derive purely from frame.frame,
 * so every frame is reproducible without replaying history — fully seekable.
 */
class ContourFieldRenderer implements LayerRenderer {
  private canvas = document.createElement("canvas");
  private ctx = this.canvas.getContext("2d")!;

  private cols = 0;
  private rows = 0;
  private grid = new Float32Array(0);
  private mask = new Float32Array(0);
  private maskKey = "";
  private maskActive = false;
  private textMode: TextMode = "off";

  resize(w: number, h: number): void {
    this.canvas.width = Math.max(1, Math.round(w));
    this.canvas.height = Math.max(1, Math.round(h));
  }

  private gridSize(resolution: number): [number, number] {
    let cols = Math.max(8, Math.round(this.canvas.width * resolution));
    let rows = Math.max(8, Math.round(this.canvas.height * resolution));
    if (cols * rows > MAX_CELLS) {
      const s = Math.sqrt(MAX_CELLS / (cols * rows));
      cols = Math.max(8, Math.floor(cols * s));
      rows = Math.max(8, Math.floor(rows * s));
    }
    return [cols, rows];
  }

  /**
   * Sample the 3D fBm field into the grid.
   *  zEvo  – evolution depth (animates the surface morphing in place)
   *  zWarp – separate depth for the warp field (animates the swirl independently)
   */
  private sampleField(
    scale: number, octaves: number, seed: number,
    zEvo: number, warp: number, zWarp: number,
  ): void {
    const { cols, rows } = this;
    const n = cols * rows;
    if (this.grid.length !== n) this.grid = new Float32Array(n);
    const g = this.grid;
    const fx = scale / cols;
    const fy = scale / rows;
    let i = 0;
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        let sx = x * fx;
        let sy = y * fy;
        if (warp > 0) {
          // domain warp reads its own evolving slice (zWarp) so the swirl drifts
          // on a different rhythm than the elevation — that decoupling is what reads
          // as fluid rather than mechanical.
          const wx = fbm3(sx + 11.3, sy + 4.7, zWarp, seed + 7777, 2) - 0.5;
          const wy = fbm3(sx + 2.1, sy + 19.4, zWarp + 5.0, seed + 3333, 2) - 0.5;
          sx += wx * warp;
          sy += wy * warp;
        }
        let val = fbm3(sx, sy, zEvo, seed, octaves);
        if (this.maskActive) val += this.mask[i] * 0.6;
        g[i++] = val;
      }
    }
  }

  private static lerp(a: number, b: number, level: number): number {
    const d = b - a;
    if (Math.abs(d) < 1e-6) return 0.5;
    return (level - a) / d;
  }

  private marchLevel(level: number, sx: number, sy: number): void {
    const { cols, rows, grid, ctx } = this;
    const L = ContourFieldRenderer.lerp;
    for (let y = 0; y < rows - 1; y++) {
      for (let x = 0; x < cols - 1; x++) {
        const tl = grid[y * cols + x];
        const tr = grid[y * cols + x + 1];
        const br = grid[(y + 1) * cols + x + 1];
        const bl = grid[(y + 1) * cols + x];
        let code = 0;
        if (tl > level) code |= 8;
        if (tr > level) code |= 4;
        if (br > level) code |= 2;
        if (bl > level) code |= 1;
        if (code === 0 || code === 15) continue;

        const top = () => [(x + L(tl, tr, level)) * sx, y * sy] as const;
        const right = () => [(x + 1) * sx, (y + L(tr, br, level)) * sy] as const;
        const bottom = () => [(x + L(bl, br, level)) * sx, (y + 1) * sy] as const;
        const left = () => [x * sx, (y + L(tl, bl, level)) * sy] as const;

        const seg = (a: readonly [number, number], b: readonly [number, number]) => {
          ctx.moveTo(a[0], a[1]);
          ctx.lineTo(b[0], b[1]);
        };

        switch (code) {
          case 1: case 14: seg(left(), bottom()); break;
          case 2: case 13: seg(bottom(), right()); break;
          case 3: case 12: seg(left(), right()); break;
          case 4: case 11: seg(top(), right()); break;
          case 6: case 9:  seg(top(), bottom()); break;
          case 7: case 8:  seg(top(), left()); break;
          case 5: case 10: {
            const center = (tl + tr + br + bl) * 0.25;
            if ((code === 5) === (center > level)) {
              seg(top(), left()); seg(bottom(), right());
            } else {
              seg(top(), right()); seg(bottom(), left());
            }
            break;
          }
        }
      }
    }
  }

  render(frame: RenderFrame): HTMLCanvasElement {
    if (this.canvas.width !== frame.width || this.canvas.height !== frame.height) {
      this.resize(frame.width, frame.height);
    }
    const pr = frame.props;
    const resolution = Math.max(0.05, Math.min(0.5, num(pr.resolution, 0.22)));
    const [cols, rows] = this.gridSize(resolution);
    this.cols = cols;
    this.rows = rows;

    const seed = Math.round(num(pr.seed, 1));
    const scale = Math.max(1, num(pr.scale, 6));
    const octaves = Math.max(1, Math.min(8, Math.round(num(pr.octaves, 4))));
    const warp = Math.max(0, num(pr.warp, 0.4));
    const levels = Math.max(2, Math.min(60, Math.round(num(pr.levels, 18))));

    // ── animation: walk through the noise's z-axis instead of translating XY ──
    const evolveSpeed = num(pr.evolveSpeed, 1.0); // how fast contours morph in place
    const swirlSpeed = num(pr.swirlSpeed, 0.6);   // how fast the warp swims around
    const zEvo = frame.frame * evolveSpeed * 0.01;
    const zWarp = frame.frame * swirlSpeed * 0.01;

    // ── text-field influence (same wiring as the sim layers) ──
    const textSrc = frame.textField ?? frame.below;
    const mode = resolveTextMode(textSettingOf(textSrc?.props?.textInfluence), !!textSrc?.field);
    const field = mode !== "off" ? textSrc?.field : undefined;
    this.textMode = mode;
    if (field) {
      const key = `${textSrc?.key ?? ""}|${cols}x${rows}`;
      if (this.mask.length !== cols * rows) this.mask = new Float32Array(cols * rows);
      if (key !== this.maskKey) {
        fieldToMask(field, cols, rows, this.mask);
        this.maskKey = key;
      }
      this.maskActive = true;
    } else {
      this.maskActive = false;
      this.maskKey = "";
    }

    this.sampleField(scale, octaves, seed, zEvo, warp, zWarp);

    // ── draw ──
    const w = this.canvas.width;
    const h = this.canvas.height;
    const sx = w / (cols - 1);
    const sy = h / (rows - 1);
    const ctx = this.ctx;
    ctx.clearRect(0, 0, w, h);

    const [bgR, bgG, bgB, bgA] = arr(pr.background, [0, 0, 0, 0]);
    if (bgA > 0) {
      ctx.fillStyle = `rgba(${bgR},${bgG},${bgB},${bgA / 255})`;
      ctx.fillRect(0, 0, w, h);
    }

    const [lr, lg, lb, la] = arr(pr.lineColor, [40, 40, 255, 255]);
    const lineWidth = Math.max(0.25, num(pr.lineWidth, 1));
    const emphasizeEvery = Math.max(0, Math.round(num(pr.emphasizeEvery, 5)));
    const emphasisMul = Math.max(1, num(pr.emphasisMul, 2.2));

    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = `rgba(${lr},${lg},${lb},${la / 255})`;

    for (let k = 1; k <= levels; k++) {
      const level = k / (levels + 1);
      const emphasised = emphasizeEvery > 0 && k % emphasizeEvery === 0;
      ctx.lineWidth = emphasised ? lineWidth * emphasisMul : lineWidth;
      ctx.beginPath();
      this.marchLevel(level, sx, sy);
      ctx.stroke();
    }

    return this.canvas;
  }

  dispose(): void {
    this.canvas.width = this.canvas.height = 0;
    this.grid = this.mask = new Float32Array(0);
  }
}

export const contourFieldLayerType: LayerTypeDefinition = {
  type: "contourField",
  label: "Contour Field",
  category: "Generative",
  icon: "Waves",
  description: "Topographic iso-lines from a 3D fBm field via marching squares. Contours morph in place like a liquid surface. Deterministic & seekable.",
  defaultSize: (comp) => [comp.width, comp.height],
  schema: [
    { key: "scale", name: "Feature Scale", type: "number", default: 6, group: "Field", meta: { min: 1, max: 40, step: 0.5 } },
    { key: "octaves", name: "Octaves", type: "number", default: 4, group: "Field", meta: { min: 1, max: 8, step: 1 } },
    { key: "warp", name: "Domain Warp", type: "number", default: 0.4, group: "Field", meta: { min: 0, max: 2, step: 0.05 } },
    { key: "seed", name: "Seed", type: "number", default: 1, group: "Field", animatable: false, meta: { min: 0, max: 99999, step: 1 } },
    { key: "evolveSpeed", name: "Evolve Speed", type: "number", default: 1.0, group: "Motion", meta: { min: 0, max: 5, step: 0.1 } },
    { key: "swirlSpeed", name: "Swirl Speed", type: "number", default: 0.6, group: "Motion", meta: { min: 0, max: 5, step: 0.1 } },
    { key: "levels", name: "Contour Levels", type: "number", default: 18, group: "Lines", meta: { min: 2, max: 60, step: 1 } },
    { key: "lineColor", name: "Line Color", type: "color", default: [40, 40, 255, 255], group: "Lines" },
    { key: "lineWidth", name: "Line Width", type: "number", default: 1, group: "Lines", meta: { min: 0.25, max: 6, step: 0.25 } },
    { key: "emphasizeEvery", name: "Index Line Every", type: "number", default: 5, group: "Lines", meta: { min: 0, max: 12, step: 1 } },
    { key: "emphasisMul", name: "Index Line Weight", type: "number", default: 2.2, group: "Lines", meta: { min: 1, max: 5, step: 0.1 } },
    { key: "background", name: "Background", type: "color", default: [0, 0, 0, 0], group: "Look" },
    { key: "resolution", name: "Resolution (perf)", type: "percent", default: 0.22, group: "Look", animatable: false, meta: { min: 0.05, max: 0.5, step: 0.01 } },
  ],
  createRenderer: () => new ContourFieldRenderer(),
};