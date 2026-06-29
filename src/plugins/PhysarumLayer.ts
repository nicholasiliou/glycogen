import { Plugin, type Frame } from "./Plugin";
import { fieldToMask, physarumAttract, physarumConfineTrail, physarumSeedAgentsOnMask, type TextMode } from "./_shared/textField";

function mulberry32(seed: number) {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const HARD_MAX = 40000;
const MAX_CELLS = 160000;
const DEG = Math.PI / 180;
const LOW = [8, 10, 14, 0];
const HIGH = [192, 252, 4, 255];

interface AgentParams {
  sensorDist: number;
  sensorAngle: number;
  turnAngle: number;
  stepSize: number;
  deposit: number;
  decay: number;
}

/**
 * Physarum polycephalum (slime mould) transport-network sim. Thousands of agents crawl over a
 * chemo-attractant trail map, steering toward the strongest scent and depositing their own trail,
 * which diffuses and decays — self-organising into branching vein networks.
 */
export class PhysarumLayer extends Plugin {
  count = this.knob(0, { min: 200, max: HARD_MAX, step: 100, default: 5000 });
  sensorDist = this.knob(1, { min: 1, max: 30, default: 9 });
  sensorAngle = this.knob(2, { min: 1, max: 90, default: 22 });
  turnAngle = this.knob(3, { min: 1, max: 90, default: 30 });
  stepSize = this.knob(4, { min: 0.2, max: 4, default: 1 });
  deposit = this.knob(5, { min: 0.1, max: 3, default: 1 });
  decay = this.knob(6, { min: 0, max: 0.95, default: 0.1 });
  gain = this.knob(7, { min: 0.1, max: 3, default: 0.6 });
  seed = this.knob(8, { min: 1, max: 64, step: 1, default: 1 });
  speed = this.fader(0, { min: 1, max: 6, step: 1, default: 1 });
  textStrength = this.fader(1, { min: 0, max: 1, default: 0.8 });
  /** Cycle through off → fill → attract with a pad press. */
  textMode = this.pad(4);
  reseed = this.pad(5);

  private ctx = this.canvas.getContext("2d")!;
  private buf = document.createElement("canvas");
  private bctx = this.buf.getContext("2d")!;
  private image?: ImageData;

  private ax = new Float32Array(0);
  private ay = new Float32Array(0);
  private ah = new Float32Array(0);
  private capacity = 0;
  private trail = new Float32Array(0);
  private trail2 = new Float32Array(0);
  private cols = 0;
  private rows = 0;
  private simStep = 0;
  private nAgents = 0;
  private mask = new Float32Array(0);
  private maskKey = "";
  private maskActive = false;
  private lastTextMode: TextMode = "off";
  private lastSeed = NaN;
  private lastCount = -1;
  private lastReseed = 0;

  private gridSize(): [number, number] {
    let cols = Math.max(16, this.canvas.width);
    let rows = Math.max(16, this.canvas.height);
    if (cols * rows > MAX_CELLS) {
      const s = Math.sqrt(MAX_CELLS / (cols * rows));
      cols = Math.max(16, Math.floor(cols * s));
      rows = Math.max(16, Math.floor(rows * s));
    }
    return [cols, rows];
  }

  private reinit(count: number, seed: number, mask: Float32Array | null): void {
    if (count > this.capacity) {
      this.ax = new Float32Array(count);
      this.ay = new Float32Array(count);
      this.ah = new Float32Array(count);
      this.capacity = count;
    }
    const n = this.cols * this.rows;
    if (this.trail.length !== n) {
      this.trail = new Float32Array(n);
      this.trail2 = new Float32Array(n);
    } else {
      this.trail.fill(0);
    }
    const rnd = mulberry32((seed | 0) * 2654435761 + 31);
    if (mask && this.maskActive) {
      physarumSeedAgentsOnMask(this.ax, this.ay, this.ah, count, mask, this.cols, this.rows, rnd);
    } else {
      for (let i = 0; i < count; i++) {
        this.ax[i] = rnd() * this.cols;
        this.ay[i] = rnd() * this.rows;
        this.ah[i] = rnd() * Math.PI * 2;
      }
    }
    this.nAgents = count;
    this.simStep = 0;
  }

  private sense(fx: number, fy: number): number {
    const { cols, rows, trail } = this;
    let x = Math.floor(fx) % cols;
    if (x < 0) x += cols;
    let y = Math.floor(fy) % rows;
    if (y < 0) y += rows;
    return trail[y * cols + x];
  }

  private step(p: AgentParams): void {
    const { cols, rows, ax, ay, ah, trail } = this;
    const count = this.nAgents;
    const sa = p.sensorAngle;
    const sd = p.sensorDist;

    for (let i = 0; i < count; i++) {
      const h = ah[i], x = ax[i], y = ay[i];
      const fc = this.sense(x + Math.cos(h) * sd, y + Math.sin(h) * sd);
      const fl = this.sense(x + Math.cos(h - sa) * sd, y + Math.sin(h - sa) * sd);
      const fr = this.sense(x + Math.cos(h + sa) * sd, y + Math.sin(h + sa) * sd);

      let nh = h;
      if (fc > fl && fc > fr) {
        // hold heading
      } else if (fc < fl && fc < fr) {
        const r = (Math.imul(i + 1, 0x9e3779b1) ^ Math.imul(this.simStep + 1, 0x85ebca6b)) >>> 0;
        nh += r < 0x80000000 ? -p.turnAngle : p.turnAngle;
      } else if (fr > fl) {
        nh += p.turnAngle;
      } else if (fl > fr) {
        nh -= p.turnAngle;
      }

      let nx = x + Math.cos(nh) * p.stepSize;
      let ny = y + Math.sin(nh) * p.stepSize;
      if (nx < 0) nx += cols; else if (nx >= cols) nx -= cols;
      if (ny < 0) ny += rows; else if (ny >= rows) ny -= rows;
      ax[i] = nx; ay[i] = ny; ah[i] = nh;

      const xi = nx < 0 ? 0 : nx >= cols ? cols - 1 : nx | 0;
      const yi = ny < 0 ? 0 : ny >= rows ? rows - 1 : ny | 0;
      trail[yi * cols + xi] += p.deposit;
    }

    const keep = 1 - p.decay;
    const t = this.trail, t2 = this.trail2;
    for (let y = 0; y < rows; y++) {
      const yc = y * cols;
      const yu = (y === 0 ? rows - 1 : y - 1) * cols;
      const yd = (y === rows - 1 ? 0 : y + 1) * cols;
      for (let x = 0; x < cols; x++) {
        const xl = x === 0 ? cols - 1 : x - 1;
        const xr = x === cols - 1 ? 0 : x + 1;
        const mean = (t[yu + xl] + t[yu + x] + t[yu + xr] + t[yc + xl] + t[yc + x] + t[yc + xr] + t[yd + xl] + t[yd + x] + t[yd + xr]) / 9;
        t2[yc + x] = mean * keep;
      }
    }
    this.trail = t2; this.trail2 = t;
    this.simStep++;
  }

  render(f: Frame): HTMLCanvasElement {
    const [cols, rows] = this.gridSize();
    const count = Math.max(1, Math.min(HARD_MAX, Math.round(this.count.value)));
    const seed = Math.round(this.seed.value);

    // Resolve text mode (cycles off → fill → attract).
    const textModes: TextMode[] = ["off", "fill", "attract"];
    const mode: TextMode = f.textField ? textModes[this.textMode.count % 3] : "off";
    const strength = this.textStrength.value;

    // Update mask whenever field or grid size changes.
    if (f.textField) {
      const fieldKey = (f.textField.key ?? String(f.time)) + cols + "x" + rows;
      if (fieldKey !== this.maskKey || this.mask.length !== cols * rows) {
        if (this.mask.length !== cols * rows) this.mask = new Float32Array(cols * rows);
        fieldToMask(f.textField, cols, rows, this.mask);
        this.maskKey = fieldKey;
        this.maskActive = true;
      }
    } else {
      this.maskActive = false;
    }

    const needsReinit =
      cols !== this.cols ||
      rows !== this.rows ||
      count !== this.lastCount ||
      seed !== this.lastSeed ||
      this.reseed.count !== this.lastReseed ||
      (mode === "fill" && this.lastTextMode !== "fill" && this.maskActive);

    if (needsReinit) {
      this.cols = cols;
      this.rows = rows;
      this.lastCount = count;
      this.lastSeed = seed;
      this.lastReseed = this.reseed.count;
      this.reinit(count, seed, this.maskActive ? this.mask : null);
    }
    this.lastTextMode = mode;

    const p: AgentParams = {
      sensorDist: this.sensorDist.value,
      sensorAngle: this.sensorAngle.value * DEG,
      turnAngle: this.turnAngle.value * DEG,
      stepSize: this.stepSize.value,
      deposit: this.deposit.value,
      decay: Math.max(0, Math.min(0.95, this.decay.value)),
    };
    const speed = Math.max(1, Math.round(this.speed.value));
    for (let s = 0; s < speed; s++) {
      this.step(p);
      // Apply mask influence after each sim step.
      if (this.maskActive && mode !== "off" && strength > 0) {
        const n = cols * rows;
        if (mode === "fill") {
          physarumConfineTrail(this.trail, this.mask, n, strength);
        } else {
          physarumAttract(this.trail, this.mask, n, strength);
        }
      }
    }

    this.draw();
    return this.canvas;
  }

  private draw(): void {
    const { cols, rows, trail } = this;
    if (!this.image || this.buf.width !== cols || this.buf.height !== rows) {
      this.buf.width = cols;
      this.buf.height = rows;
      this.image = this.bctx.createImageData(cols, rows);
    }
    const gain = this.gain.value;
    const data = this.image.data;
    let idx = 0;
    for (let i = 0; i < cols * rows; i++) {
      let v = trail[i] * gain;
      v = v < 0 ? 0 : v > 1 ? 1 : v;
      data[idx++] = LOW[0] + (HIGH[0] - LOW[0]) * v;
      data[idx++] = LOW[1] + (HIGH[1] - LOW[1]) * v;
      data[idx++] = LOW[2] + (HIGH[2] - LOW[2]) * v;
      data[idx++] = LOW[3] + (HIGH[3] - LOW[3]) * v;
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
    this.ax = this.ay = this.ah = new Float32Array(0);
    this.trail = this.trail2 = new Float32Array(0);
    this.image = undefined;
  }
}
