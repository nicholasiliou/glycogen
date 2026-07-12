import { Plugin, type Frame } from "./Plugin";
import { fieldToMask, rdAttract, rdConfine, rdSeedAlongMask, type TextMode } from "./_shared/textField";

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
const DIFF_U = 1.0;
const DIFF_V = 0.5;

// Named feed/kill (f, k) regimes — the parameter space is finicky, so presets make it approachable.
const PRESETS: [string, number, number][] = [
  ["coral", 0.0545, 0.062],
  ["mitosis", 0.0367, 0.0649],
  ["maze", 0.029, 0.057],
  ["solitons", 0.03, 0.062],
  ["worms", 0.054, 0.063],
  ["spots", 0.025, 0.06],
  ["drip", 0.032, 0.0615],
];

// "drip" only: gravity flux for V. Below DRIP_HOLD surface tension wins and the film sticks;
// above it slime flows down quadratically, so blobs sag, necks thin out and the kill term
// severs them into falling drops. Vertical wrap re-seeds fallen drips at the top.
const DRIP_G = 0.35;
const DRIP_HOLD = 0.2;

const LOW = [8, 10, 14, 0];
const HIGH = [192, 252, 4, 255];

/**
 * Gray–Scott reaction–diffusion. Two virtual chemicals U and V diffuse on a downsampled grid; V
 * catalyses its own production by consuming U, so seeds bloom into self-organising patterns. The
 * pad cycles named regimes; `iterations` steps advance per frame.
 */
export class ReactionDiffusionLayer extends Plugin {
  pattern = this.cycle(PRESETS.map(([name]) => name));
  reseed = this.trigger();
  /** Cycle through off → fill → attract with a pad press. */
  textMode = this.cycle(["off", "fill", "attract"]);
  resolution = this.number({ min: 0.08, max: 0.6, default: 0.26 });
  iterations = this.number({ min: 1, max: 30, step: 1, default: 10 });
  gain = this.number({ min: 0.5, max: 5, default: 2.4 });
  seed = this.number({ min: 1, max: 64, step: 1, default: 1 });
  textStrength = this.number({ min: 0, max: 1, default: 0.8 });

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
  private lastSeed = NaN;
  private lastReseed = 0;
  private mask = new Float32Array(0);
  private maskKey = "";

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
        const lapU = (u[yc + xl] + u[yc + xr] + u[yu + x] + u[yd + x]) * 0.2 + (u[yu + xl] + u[yu + xr] + u[yd + xl] + u[yd + xr]) * 0.05 - a;
        const lapV = (v[yc + xl] + v[yc + xr] + v[yu + x] + v[yd + x]) * 0.2 + (v[yu + xl] + v[yu + xr] + v[yd + xl] + v[yd + xr]) * 0.05 - b;
        const reaction = a * b * b;
        const na = a + (DIFF_U * lapU - reaction + feed * (1 - a));
        const nb = b + (DIFF_V * lapV + reaction - (kill + feed) * b);
        u2[c] = na < 0 ? 0 : na > 1 ? 1 : na;
        v2[c] = nb < 0 ? 0 : nb > 1 ? 1 : nb;
      }
    }
    this.u = u2; this.v = v2; this.u2 = u; this.v2 = v;
  }

  /** Downward mass-conserving flux of V: what leaves a cell arrives in the one below. */
  private dripFlow(): void {
    const { cols, rows, v, v2 } = this;
    for (let y = 0; y < rows; y++) {
      const yc = y * cols;
      const yu = (y === 0 ? rows - 1 : y - 1) * cols;
      for (let x = 0; x < cols; x++) {
        const c = yc + x;
        const b = v[c];
        const above = v[yu + x];
        const inflow = above > DRIP_HOLD ? DRIP_G * (above - DRIP_HOLD) * (above - DRIP_HOLD) : 0;
        const outflow = b > DRIP_HOLD ? DRIP_G * (b - DRIP_HOLD) * (b - DRIP_HOLD) : 0;
        const nb = b + inflow - outflow;
        v2[c] = nb < 0 ? 0 : nb > 1 ? 1 : nb;
      }
    }
    this.v = v2;
    this.v2 = v;
  }

  render(f: Frame): HTMLCanvasElement {
    const resolution = Math.max(0.08, Math.min(0.6, this.resolution.value));
    const [cols, rows] = this.gridSize(resolution);
    const seed = Math.round(this.seed.value);
    const n = cols * rows;

    // Resolve text mode (cycles off → fill → attract).
    const textModes: TextMode[] = ["off", "fill", "attract"];
    const mode: TextMode = f.textField ? textModes[this.textMode.count % 3] : "off";
    const strength = this.textStrength.value;

    // Update mask whenever field or grid size changes.
    if (f.textField) {
      const fieldKey = (f.textField.key ?? String(f.time)) + cols + "x" + rows;
      if (fieldKey !== this.maskKey || this.mask.length !== n) {
        if (this.mask.length !== n) this.mask = new Float32Array(n);
        fieldToMask(f.textField, cols, rows, this.mask);
        this.maskKey = fieldKey;
      }
    }

    const needsReinit = cols !== this.cols || rows !== this.rows || seed !== this.lastSeed || this.reseed.count !== this.lastReseed;
    if (needsReinit) {
      this.cols = cols;
      this.rows = rows;
      this.lastSeed = seed;
      this.lastReseed = this.reseed.count;
      this.reinit(seed);
      // Seed along mask immediately after init if in fill mode.
      if (mode === "fill" && f.textField && this.mask.length === n) {
        rdSeedAlongMask(this.u, this.v, this.mask, n);
      }
    }

    const [name, feed, kill] = PRESETS[this.pattern.count % PRESETS.length];
    const iters = Math.max(1, Math.round(this.iterations.value));
    for (let s = 0; s < iters; s++) {
      this.step(feed, kill);
      if (name === "drip") this.dripFlow();
      if (mode !== "off" && f.textField && this.mask.length === n && strength > 0) {
        if (mode === "fill") rdConfine(this.u, this.v, this.mask, n, strength * 0.05);
        else rdAttract(this.v, this.mask, n, strength);
      }
    }

    this.draw();
    return this.canvas;
  }

  private draw(): void {
    const { cols, rows, v } = this;
    if (!this.image || this.buf.width !== cols || this.buf.height !== rows) {
      this.buf.width = cols;
      this.buf.height = rows;
      this.image = this.bctx.createImageData(cols, rows);
    }
    const gain = this.gain.value;
    const data = this.image.data;
    let idx = 0;
    for (let i = 0; i < cols * rows; i++) {
      let t = v[i] * gain;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      data[idx++] = LOW[0] + (HIGH[0] - LOW[0]) * t;
      data[idx++] = LOW[1] + (HIGH[1] - LOW[1]) * t;
      data[idx++] = LOW[2] + (HIGH[2] - LOW[2]) * t;
      data[idx++] = LOW[3] + (HIGH[3] - LOW[3]) * t;
    }
    this.bctx.putImageData(this.image, 0, 0);
    const w = this.canvas.width, h = this.canvas.height;
    this.ctx.clearRect(0, 0, w, h);
    this.ctx.imageSmoothingEnabled = true;
    this.ctx.drawImage(this.buf, 0, 0, cols, rows, 0, 0, w, h);
  }

  dispose(): void {
    super.dispose();
    this.buf.width = this.buf.height = 0;
    this.u = this.v = this.u2 = this.v2 = new Float32Array(0);
    this.image = undefined;
  }
}
