import type { LayerTypeDefinition } from "../../engine/plugins/Registry";
import type { LayerRenderer, RenderFrame } from "../../engine/render/types";
import { fieldToMask, physarumConfineTrail, physarumAttract, physarumSeedAgentsOnMask, resolveTextMode, textSettingOf, type TextMode } from "../_shared/textField";

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

const HARD_MAX = 40000;
const MAX_CELLS = 160000;
const MAX_CATCHUP = 500;
const DEG = Math.PI / 180;

interface AgentParams {
  sensorDist: number;
  sensorAngle: number;
  turnAngle: number;
  stepSize: number;
  deposit: number;
  decay: number;
}

/**
 * Physarum polycephalum (slime mould) transport-network simulation. Thousands of
 * agents crawl over a chemo-attractant trail map: each smells the trail ahead-left,
 * ahead and ahead-right, steers toward the strongest, moves, and deposits its own
 * trail; the map then diffuses and decays. With no central control the colony
 * self-organises into the branching, reinforcing vein networks real slime mould uses
 * to solve mazes and approximate transport graphs.
 *
 * Engineered like the other sims here: agent state in flat Float32Arrays (no GC churn),
 * a downsampled trail grid rendered upscaled, and full determinism — a seeded initial
 * state advances a fixed number of steps per frame (steering ties are broken by a hash
 * of agent+step, not Math.random), so scrubbing and export are reproducible; backward
 * seeks replay from step 0 (capped).
 */
class PhysarumRenderer implements LayerRenderer {
  private canvas = document.createElement("canvas");
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
  private count = 0;
  private lastSeed = NaN;
  private lastCount = -1;
  private forceInitial = true;
  private mask = new Float32Array(0);
  private maskKey = "";
  private maskActive = false;
  private textMode: TextMode = "off";

  resize(w: number, h: number): void {
    this.canvas.width = Math.max(1, Math.round(w));
    this.canvas.height = Math.max(1, Math.round(h));
  }

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

  private reinit(count: number, seed: number): void {
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
    if ((this.textMode === "grow" || this.textMode === "fill") && this.maskActive) {
      physarumSeedAgentsOnMask(this.ax, this.ay, this.ah, count, this.mask, this.cols, this.rows, rnd);
    } else {
      for (let i = 0; i < count; i++) {
        this.ax[i] = rnd() * this.cols;
        this.ay[i] = rnd() * this.rows;
        this.ah[i] = rnd() * Math.PI * 2;
      }
    }
    this.count = count;
    this.simStep = 0;
  }

  /** Nearest-sample the trail at grid coords, wrapping toroidally. */
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
    const count = this.count;
    const sa = p.sensorAngle;
    const sd = p.sensorDist;

    // --- sense, steer, move, deposit ---
    for (let i = 0; i < count; i++) {
      const h = ah[i];
      const x = ax[i];
      const y = ay[i];
      const fc = this.sense(x + Math.cos(h) * sd, y + Math.sin(h) * sd);
      const fl = this.sense(x + Math.cos(h - sa) * sd, y + Math.sin(h - sa) * sd);
      const fr = this.sense(x + Math.cos(h + sa) * sd, y + Math.sin(h + sa) * sd);

      let nh = h;
      if (fc > fl && fc > fr) {
        // straight ahead is best — hold heading
      } else if (fc < fl && fc < fr) {
        // boxed in — break the tie deterministically (hash of agent + step)
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
      ax[i] = nx;
      ay[i] = ny;
      ah[i] = nh;

      const xi = nx < 0 ? 0 : nx >= cols ? cols - 1 : nx | 0;
      const yi = ny < 0 ? 0 : ny >= rows ? rows - 1 : ny | 0;
      trail[yi * cols + xi] += p.deposit;
    }

    // --- diffuse (3×3 mean, wrapped) + decay ---
    const keep = 1 - p.decay;
    const t = this.trail;
    const t2 = this.trail2;
    for (let y = 0; y < rows; y++) {
      const yc = y * cols;
      const yu = (y === 0 ? rows - 1 : y - 1) * cols;
      const yd = (y === rows - 1 ? 0 : y + 1) * cols;
      for (let x = 0; x < cols; x++) {
        const xl = x === 0 ? cols - 1 : x - 1;
        const xr = x === cols - 1 ? 0 : x + 1;
        const mean =
          (t[yu + xl] + t[yu + x] + t[yu + xr] +
            t[yc + xl] + t[yc + x] + t[yc + xr] +
            t[yd + xl] + t[yd + x] + t[yd + xr]) / 9;
        t2[yc + x] = mean * keep;
      }
    }
    this.trail = t2;
    this.trail2 = t;
    this.simStep++;
  }

  private draw(props: Record<string, unknown>): void {
    const { cols, rows, trail } = this;
    if (!this.image || this.buf.width !== cols || this.buf.height !== rows) {
      this.buf.width = cols;
      this.buf.height = rows;
      this.image = this.bctx.createImageData(cols, rows);
    }
    const gain = num(props.gain, 0.6);
    const [loR, loG, loB, loA] = arr(props.colorLow, [8, 10, 14, 255]);
    const [hiR, hiG, hiB, hiA] = arr(props.colorHigh, [192, 252, 4, 255]);
    const data = this.image.data;
    let idx = 0;
    for (let i = 0; i < cols * rows; i++) {
      let v = trail[i] * gain;
      v = v < 0 ? 0 : v > 1 ? 1 : v;
      data[idx++] = loR + (hiR - loR) * v;
      data[idx++] = loG + (hiG - loG) * v;
      data[idx++] = loB + (hiB - loB) * v;
      data[idx++] = loA + (hiA - loA) * v;
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
    const resolution = 1;
    const [cols, rows] = this.gridSize(resolution);
    const count = Math.max(1, Math.min(HARD_MAX, Math.round(num(pr.count, 5000))));
    const seed = Math.round(num(pr.seed, 1));

    // ── text-field influence: mode owned by the text layer's textInfluence prop ──
    const textSrc = frame.textField ?? frame.below;
    const mode = resolveTextMode(textSettingOf(textSrc?.props?.textInfluence), !!textSrc?.field);
    const strength = Math.max(0, Math.min(1, num(pr.textStrength, 0.8)));
    const field = mode !== "off" ? textSrc?.field : undefined;
    const needReinit =
      cols !== this.cols || rows !== this.rows || count !== this.lastCount || seed !== this.lastSeed || this.forceInitial || mode !== this.textMode;
    this.cols = cols;
    this.rows = rows;
    this.lastCount = count;
    this.lastSeed = seed;
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

    if (needReinit) this.reinit(count, seed);

    const p: AgentParams = {
      sensorDist: num(pr.sensorDist, 9),
      sensorAngle: num(pr.sensorAngle, 22) * DEG,
      turnAngle: num(pr.turnAngle, 30) * DEG,
      stepSize: num(pr.stepSize, 1),
      deposit: num(pr.deposit, 1),
      decay: Math.max(0, Math.min(0.95, num(pr.decay, 0.1))),
    };
    const speed = Math.max(1, Math.round(num(pr.speed, 1)));
    const n = cols * rows;

    const target = frame.frame * speed;
    let steps = 0;
    if (target < this.simStep) {
      this.reinit(count, seed);
      steps = Math.min(target, MAX_CATCHUP);
    } else {
      steps = Math.min(target - this.simStep, MAX_CATCHUP);
    }
    for (let s = 0; s < steps; s++) {
      this.step(p);
      if (this.maskActive) {
        if (mode === "fill") physarumConfineTrail(this.trail, this.mask, n, strength);
        else if (mode === "attract") physarumAttract(this.trail, this.mask, n, strength * 2);
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
    this.ax = this.ay = this.ah = new Float32Array(0);
    this.trail = this.trail2 = new Float32Array(0);
    this.image = undefined;
  }
}

export const physarumLayerType: LayerTypeDefinition = {
  type: "physarum",
  label: "Slime Mold",
  category: "Simulation",
  icon: "Waypoints",
  description: "Physarum slime-mould agents that self-organise into branching transport networks. Deterministic & seekable.",
  defaultSize: (comp) => [comp.width, comp.height],
  schema: [
    { key: "count", name: "Agents", type: "number", default: 5000, group: "Colony", animatable: false, meta: { min: 1, max: 40000, step: 1 } },
    { key: "seed", name: "Seed", type: "number", default: 1, group: "Colony", animatable: false, meta: { min: 0, max: 99999, step: 1 } },
    { key: "speed", name: "Steps / Frame", type: "number", default: 1, group: "Colony", meta: { min: 1, max: 4, step: 1 } },
    { key: "sensorDist", name: "Sensor Distance", type: "number", default: 9, group: "Behaviour", meta: { min: 1, max: 40, step: 0.5 } },
    { key: "sensorAngle", name: "Sensor Angle", type: "angle", default: 22, group: "Behaviour", meta: { min: 1, max: 90, step: 1, unit: "°" } },
    { key: "turnAngle", name: "Turn Angle", type: "angle", default: 30, group: "Behaviour", meta: { min: 1, max: 90, step: 1, unit: "°" } },
    { key: "stepSize", name: "Step Size", type: "number", default: 1, group: "Behaviour", meta: { min: 0.2, max: 4, step: 0.1 } },
    { key: "deposit", name: "Deposit", type: "number", default: 1, group: "Trail", meta: { min: 0.1, max: 5, step: 0.1 } },
    { key: "decay", name: "Decay", type: "percent", default: 0.1, group: "Trail", meta: { min: 0.01, max: 0.5, step: 0.01 } },
    { key: "gain", name: "Gain", type: "number", default: 0.6, group: "Look", meta: { min: 0.1, max: 4, step: 0.05 } },
    { key: "colorLow", name: "Low Color", type: "color", default: [8, 10, 14, 0], group: "Look" },
    { key: "colorHigh", name: "High Color", type: "color", default: [192, 252, 4, 255], group: "Look" },
    { key: "smooth", name: "Smooth Upscale", type: "boolean", default: true, group: "Look" },
    { key: "resolution", name: "Resolution (perf)", type: "percent", default: 0.4, group: "Look", animatable: false, meta: { min: 0.1, max: 0.6, step: 0.02 } },
    { key: "textStrength", name: "Text Strength", type: "percent", default: 0.8, group: "Text", meta: { min: 0, max: 1, step: 0.01 } },
  ],
  createRenderer: () => new PhysarumRenderer(),
};
