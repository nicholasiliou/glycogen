import type { LayerTypeDefinition } from "../../engine/plugins/Registry";
import type { LayerRenderer, RenderFrame } from "../../engine/render/types";
import { fieldToMask, rdSeedAlongMask, rdConfine, rdAttract, textModeOf, type TextMode } from "../_shared/textField";

function num(v: unknown, f: number): number {
  return typeof v === "number" ? v : f;
}
function arr(v: unknown, f: number[]): number[] {
  return Array.isArray(v) ? (v as number[]) : f;
}
function mulberry32(seed: number) {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const MAX_CELLS = 90000;
const MAX_CATCHUP = 1400;
// Standard diffusion rates for the classic Gray–Scott regimes.
const DIFF_U = 1.0;
const DIFF_V = 0.5;

// Well-known feed/kill (f, k) regimes — the parameter space is famously finicky, so
// these named presets make the layer approachable. "Custom" falls back to the sliders.
const PRESETS: Record<string, [number, number]> = {
  coral: [0.0545, 0.062],
  mitosis: [0.0367, 0.0649],
  maze: [0.029, 0.057],
  solitons: [0.03, 0.062],
  worms: [0.054, 0.063],
  spots: [0.025, 0.06],
};

/**
 * Gray–Scott reaction–diffusion — a model of morphogenesis (how Turing's chemistry
 * grows animal-coat spots, coral, mazes…). Two virtual chemicals U and V diffuse on a
 * downsampled grid; V catalyses its own production by consuming U, so localised seeds
 * bloom into self-organising patterns. Like the other sims here it's deterministic &
 * seekable: a seeded initial state advances a fixed number of iterations per frame, and
 * backward seeks replay from iteration 0 (capped). The grid is rendered into a small
 * buffer and upscaled, the usual way to keep a full-frame field affordable.
 */
class ReactionDiffusionRenderer implements LayerRenderer {
  private canvas = document.createElement("canvas");
  private ctx = this.canvas.getContext("2d")!;
  private buf = document.createElement("canvas");
  private bctx = this.buf.getContext("2d")!;
  private image?: ImageData;

  private u = new Float32Array(0);
  private v = new Float32Array(0);
  private u2 = new Float32Array(0);
  private v2 = new Float32Array(0);
  private cols = 0;
  private rows = 0;

  private simStep = 0;
  private lastSeed = NaN;
  private forceInitial = true;
  private mask = new Float32Array(0);
  private maskKey = "";
  private maskActive = false;
  private textMode: TextMode = "off";

  resize(w: number, h: number): void {
    this.canvas.width = Math.max(1, Math.round(w));
    this.canvas.height = Math.max(1, Math.round(h));
  }

  /** Grid dims from a resolution fraction, clamped so cells stay affordable. */
  private gridSize(resolution: number): [number, number] {
    let cols = Math.max(16, Math.round(this.canvas.width * resolution));
    let rows = Math.max(16, Math.round(this.canvas.height * resolution));
    if (cols * rows > MAX_CELLS) {
      const s = Math.sqrt(MAX_CELLS / (cols * rows));
      cols = Math.max(16, Math.floor(cols * s));
      rows = Math.max(16, Math.floor(rows * s));
    }
    return [cols, rows];
  }

  private reinit(seed: number): void {
    const n = this.cols * this.rows;
    if (this.u.length !== n) {
      this.u = new Float32Array(n);
      this.v = new Float32Array(n);
      this.u2 = new Float32Array(n);
      this.v2 = new Float32Array(n);
    }
    this.u.fill(1);
    this.v.fill(0);
    if ((this.textMode === "grow" || this.textMode === "fill") && this.maskActive) {
      // Pattern nucleates on the letters instead of random spots.
      rdSeedAlongMask(this.u, this.v, this.mask, n);
    } else {
      // Stamp a handful of V-rich blobs; everything else grows out from these.
      const rnd = mulberry32((seed | 0) * 9176 + 13);
      const spots = Math.max(6, Math.round(n / 1600));
      for (let s = 0; s < spots; s++) {
        const cx = Math.floor(rnd() * this.cols);
        const cy = Math.floor(rnd() * this.rows);
        const r = 2 + Math.floor(rnd() * 3);
        for (let dy = -r; dy <= r; dy++) {
          const y = cy + dy;
          if (y < 0 || y >= this.rows) continue;
          for (let dx = -r; dx <= r; dx++) {
            const x = cx + dx;
            if (x < 0 || x >= this.cols) continue;
            const i = y * this.cols + x;
            this.u[i] = 0.5;
            this.v[i] = 0.25;
          }
        }
      }
    }
    this.simStep = 0;
  }

  private step(feed: number, kill: number): void {
    const { cols, rows, u, v, u2, v2 } = this;
    for (let y = 0; y < rows; y++) {
      const yc = y * cols;
      const yu = (y === 0 ? rows - 1 : y - 1) * cols;
      const yd = (y === rows - 1 ? 0 : y + 1) * cols;
      for (let x = 0; x < cols; x++) {
        const xl = x === 0 ? cols - 1 : x - 1;
        const xr = x === cols - 1 ? 0 : x + 1;
        const c = yc + x;
        const a = u[c];
        const b = v[c];
        // Laplacian, 9-point kernel (orthogonal 0.2, diagonal 0.05, centre −1).
        const lapU =
          (u[yc + xl] + u[yc + xr] + u[yu + x] + u[yd + x]) * 0.2 +
          (u[yu + xl] + u[yu + xr] + u[yd + xl] + u[yd + xr]) * 0.05 -
          a;
        const lapV =
          (v[yc + xl] + v[yc + xr] + v[yu + x] + v[yd + x]) * 0.2 +
          (v[yu + xl] + v[yu + xr] + v[yd + xl] + v[yd + xr]) * 0.05 -
          b;
        const reaction = a * b * b;
        let na = a + (DIFF_U * lapU - reaction + feed * (1 - a));
        let nb = b + (DIFF_V * lapV + reaction - (kill + feed) * b);
        u2[c] = na < 0 ? 0 : na > 1 ? 1 : na;
        v2[c] = nb < 0 ? 0 : nb > 1 ? 1 : nb;
      }
    }
    this.u = u2;
    this.v = v2;
    this.u2 = u;
    this.v2 = v;
    this.simStep++;
  }

  private draw(props: Record<string, unknown>): void {
    const { cols, rows, v } = this;
    if (!this.image || this.buf.width !== cols || this.buf.height !== rows) {
      this.buf.width = cols;
      this.buf.height = rows;
      this.image = this.bctx.createImageData(cols, rows);
    }
    const gain = num(props.gain, 2.4);
    const [loR, loG, loB, loA] = arr(props.colorLow, [8, 10, 14, 255]);
    const [hiR, hiG, hiB, hiA] = arr(props.colorHigh, [192, 252, 4, 255]);
    const data = this.image.data;
    let idx = 0;
    for (let i = 0; i < cols * rows; i++) {
      let t = v[i] * gain;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      data[idx++] = loR + (hiR - loR) * t;
      data[idx++] = loG + (hiG - loG) * t;
      data[idx++] = loB + (hiB - loB) * t;
      data[idx++] = loA + (hiA - loA) * t;
    }
    this.bctx.putImageData(this.image, 0, 0);
    const w = this.canvas.width;
    const h = this.canvas.height;
    this.ctx.clearRect(0, 0, w, h);
    this.ctx.imageSmoothingEnabled = props.smooth !== false;
    this.ctx.drawImage(this.buf, 0, 0, cols, rows, 0, 0, w, h);
  }

  render(frame: RenderFrame): HTMLCanvasElement {
    if (this.canvas.width !== frame.width || this.canvas.height !== frame.height) {
      this.resize(frame.width, frame.height);
    }
    const pr = frame.props;
    const resolution = Math.max(0.08, Math.min(0.6, num(pr.resolution, 0.26)));
    const [cols, rows] = this.gridSize(resolution);
    const seed = Math.round(num(pr.seed, 1));

    // ── text-field influence (consumed from the layer directly below) ──
    const mode = textModeOf(pr.textInfluence);
    const strength = Math.max(0, Math.min(1, num(pr.textStrength, 0.8)));
    const field = mode !== "off" ? frame.below?.field : undefined;
    const needReinit = cols !== this.cols || rows !== this.rows || seed !== this.lastSeed || this.forceInitial;
    this.cols = cols;
    this.rows = rows;
    this.lastSeed = seed;
    this.textMode = mode;
    if (field) {
      const key = `${frame.below?.key ?? ""}|${cols}x${rows}`;
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

    if (needReinit) this.reinit(seed);

    const pattern = String(pr.pattern ?? "coral");
    const preset = PRESETS[pattern];
    const feed = preset ? preset[0] : num(pr.feed, 0.055);
    const kill = preset ? preset[1] : num(pr.kill, 0.062);
    const iters = Math.max(1, Math.round(num(pr.iterations, 10)));
    const n = cols * rows;

    const target = frame.frame * iters;
    let steps = 0;
    if (target < this.simStep) {
      this.reinit(seed);
      steps = Math.min(target, MAX_CATCHUP);
    } else {
      steps = Math.min(target - this.simStep, MAX_CATCHUP);
    }
    for (let s = 0; s < steps; s++) {
      this.step(feed, kill);
      if (this.maskActive) {
        if (mode === "fill") rdConfine(this.u, this.v, this.mask, n, strength);
        else if (mode === "attract") rdAttract(this.v, this.mask, n, strength);
      }
    }
    this.simStep = target;

    this.forceInitial = false;
    this.draw(pr);
    return this.canvas;
  }

  dispose(): void {
    this.canvas.width = this.canvas.height = 0;
    this.buf.width = this.buf.height = 0;
    this.u = this.v = this.u2 = this.v2 = new Float32Array(0);
    this.image = undefined;
  }
}

export const reactionDiffusionLayerType: LayerTypeDefinition = {
  type: "reactionDiffusion",
  label: "Reaction–Diffusion",
  category: "Simulation",
  icon: "Droplets",
  description: "Gray–Scott reaction–diffusion — Turing morphogenesis (coral, mazes, mitosis). Deterministic & seekable.",
  defaultSize: (comp) => [comp.width, comp.height],
  schema: [
    { key: "pattern", name: "Pattern", type: "select", default: "coral", group: "Chemistry", animatable: false, meta: { options: [
      { label: "Coral", value: "coral" }, { label: "Mitosis", value: "mitosis" }, { label: "Maze", value: "maze" },
      { label: "Solitons", value: "solitons" }, { label: "Worms", value: "worms" }, { label: "Spots", value: "spots" },
      { label: "Custom", value: "custom" } ] } },
    { key: "feed", name: "Feed (Custom)", type: "number", default: 0.055, group: "Chemistry", meta: { min: 0.01, max: 0.1, step: 0.001 } },
    { key: "kill", name: "Kill (Custom)", type: "number", default: 0.062, group: "Chemistry", meta: { min: 0.04, max: 0.075, step: 0.001 } },
    { key: "iterations", name: "Iterations / Frame", type: "number", default: 10, group: "Chemistry", meta: { min: 1, max: 40, step: 1 } },
    { key: "seed", name: "Seed", type: "number", default: 1, group: "Chemistry", animatable: false, meta: { min: 0, max: 99999, step: 1 } },
    { key: "gain", name: "Gain", type: "number", default: 2.4, group: "Look", meta: { min: 0.5, max: 6, step: 0.1 } },
    { key: "colorLow", name: "Low Color", type: "color", default: [8, 10, 14, 255], group: "Look" },
    { key: "colorHigh", name: "High Color", type: "color", default: [192, 252, 4, 255], group: "Look" },
    { key: "smooth", name: "Smooth Upscale", type: "boolean", default: true, group: "Look" },
    { key: "resolution", name: "Resolution (perf)", type: "percent", default: 0.26, group: "Look", animatable: false, meta: { min: 0.08, max: 0.6, step: 0.02 } },
    { key: "textInfluence", name: "Text Influence", type: "select", default: "off", group: "Text", animatable: false, meta: { options: [
      { label: "Off", value: "off" }, { label: "Fill text", value: "fill" }, { label: "Grow from text", value: "grow" }, { label: "Attract to text", value: "attract" } ] } },
    { key: "textStrength", name: "Text Strength", type: "percent", default: 0.8, group: "Text", meta: { min: 0, max: 1, step: 0.01 } },
  ],
  createRenderer: () => new ReactionDiffusionRenderer(),
};
