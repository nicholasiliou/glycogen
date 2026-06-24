import type { LayerTypeDefinition } from "../../engine/plugins/Registry";
import type { LayerRenderer, RenderFrame } from "../../engine/render/types";

function num(v: unknown, f: number): number {
  return typeof v === "number" ? v : f;
}
function rgba(v: unknown, f = "rgba(192,252,4,1)"): string {
  if (!Array.isArray(v)) return f;
  const [r, g, b, a] = v as number[];
  return `rgba(${r ?? 0},${g ?? 0},${b ?? 0},${(a ?? 255) / 255})`;
}
/** Small fast deterministic PRNG for reproducible initial flocks. */
function mulberry32(seed: number) {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const HARD_MAX = 8000;
const MAX_CATCHUP = 2000; // cap re-simulation work on a big backward seek

interface SimParams {
  perception: number;
  perception2: number;
  sepRange2: number;
  maxSpeed: number;
  maxForce: number;
  sep: number;
  align: number;
  coh: number;
  wrap: boolean;
  mouseAttract: number;
  mx: number;
  my: number;
}

/**
 * Boids flocking (Reynolds: separation / alignment / cohesion), engineered for
 * performance:
 *   • State in flat Float32Arrays (no per-boid objects → no GC churn, cache-friendly).
 *   • Neighbour search via a uniform spatial hash grid built with a counting sort each
 *     step — O(n) instead of the naive O(n²). The grid cell size equals the perception
 *     radius so a 3×3 cell scan covers it.
 *   • Rendering batches every boid into ONE path + a single fill() call.
 *
 * It is also deterministic & seekable: one fixed step per composition frame from a
 * seeded initial state, so playback, scrubbing and frame-accurate export all line up
 * (backward seeks replay from frame 0, capped). Velocity units are px/frame.
 */
class BoidsRenderer implements LayerRenderer {
  private canvas = document.createElement("canvas");
  private ctx = this.canvas.getContext("2d")!;

  private px = new Float32Array(0);
  private py = new Float32Array(0);
  private vx = new Float32Array(0);
  private vy = new Float32Array(0);
  private capacity = 0;

  // grid scratch (reused across steps)
  private cellStart = new Int32Array(0);
  private cursor = new Int32Array(0);
  private sorted = new Int32Array(0);
  private cellOf = new Int32Array(0);

  private simFrame = 0;
  private lastCount = -1;
  private lastSeed = NaN;
  private lastKey = "";
  private forceInitial = true;

  resize(w: number, h: number): void {
    this.canvas.width = Math.max(1, Math.round(w));
    this.canvas.height = Math.max(1, Math.round(h));
  }

  private ensureCapacity(n: number): void {
    if (n <= this.capacity) return;
    this.px = new Float32Array(n);
    this.py = new Float32Array(n);
    this.vx = new Float32Array(n);
    this.vy = new Float32Array(n);
    this.sorted = new Int32Array(n);
    this.cellOf = new Int32Array(n);
    this.capacity = n;
  }

  private reinit(count: number, seed: number, w: number, h: number): void {
    this.ensureCapacity(count);
    const rnd = mulberry32((seed | 0) * 1000003 + 1);
    for (let i = 0; i < count; i++) {
      this.px[i] = rnd() * w;
      this.py[i] = rnd() * h;
      const a = rnd() * Math.PI * 2;
      const sp = 0.5 + rnd();
      this.vx[i] = Math.cos(a) * sp;
      this.vy[i] = Math.sin(a) * sp;
    }
    this.simFrame = 0;
  }

  private step(count: number, p: SimParams, w: number, h: number): void {
    const cell = Math.max(8, p.perception);
    const cols = Math.max(1, Math.ceil(w / cell));
    const rows = Math.max(1, Math.ceil(h / cell));
    const cells = cols * rows;
    if (this.cellStart.length < cells + 1) {
      this.cellStart = new Int32Array(cells + 1);
      this.cursor = new Int32Array(cells + 1);
    }
    const { px, py, vx, vy, cellStart, cursor, sorted, cellOf } = this;
    const wrap = p.wrap;

    // ---- build spatial grid via counting sort ----
    cellStart.fill(0, 0, cells + 1);
    for (let i = 0; i < count; i++) {
      let cx = Math.floor(px[i] / cell);
      let cy = Math.floor(py[i] / cell);
      if (wrap) {
        cx = ((cx % cols) + cols) % cols;
        cy = ((cy % rows) + rows) % rows;
      } else {
        cx = cx < 0 ? 0 : cx >= cols ? cols - 1 : cx;
        cy = cy < 0 ? 0 : cy >= rows ? rows - 1 : cy;
      }
      const c = cy * cols + cx;
      cellOf[i] = c;
      cellStart[c + 1]++;
    }
    for (let c = 0; c < cells; c++) cellStart[c + 1] += cellStart[c];
    cursor.set(cellStart.subarray(0, cells + 1));
    for (let i = 0; i < count; i++) sorted[cursor[cellOf[i]]++] = i;

    // ---- forces (positions stay fixed this pass so the grid stays valid) ----
    const { perception2, sepRange2, maxSpeed, maxForce } = p;
    const halfW = w * 0.5;
    const halfH = h * 0.5;

    for (let i = 0; i < count; i++) {
      const cxi = cellOf[i] % cols;
      const cyi = (cellOf[i] / cols) | 0;
      let sumVx = 0, sumVy = 0, sumDx = 0, sumDy = 0, cnt = 0;
      let sepX = 0, sepY = 0;
      const xi = px[i], yi = py[i];

      for (let oy = -1; oy <= 1; oy++) {
        let ncy = cyi + oy;
        if (wrap) ncy = ((ncy % rows) + rows) % rows;
        else if (ncy < 0 || ncy >= rows) continue;
        for (let ox = -1; ox <= 1; ox++) {
          let ncx = cxi + ox;
          if (wrap) ncx = ((ncx % cols) + cols) % cols;
          else if (ncx < 0 || ncx >= cols) continue;
          const c = ncy * cols + ncx;
          for (let k = cellStart[c]; k < cellStart[c + 1]; k++) {
            const j = sorted[k];
            if (j === i) continue;
            let dx = px[j] - xi;
            let dy = py[j] - yi;
            if (wrap) {
              if (dx > halfW) dx -= w; else if (dx < -halfW) dx += w;
              if (dy > halfH) dy -= h; else if (dy < -halfH) dy += h;
            }
            const d2 = dx * dx + dy * dy;
            if (d2 > 0 && d2 < perception2) {
              sumVx += vx[j];
              sumVy += vy[j];
              sumDx += dx;
              sumDy += dy;
              cnt++;
              if (d2 < sepRange2) {
                const inv = 1 / Math.sqrt(d2);
                sepX -= dx * inv;
                sepY -= dy * inv;
              }
            }
          }
        }
      }

      let ax = 0, ay = 0;
      if (cnt > 0) {
        // alignment
        let m = Math.hypot(sumVx, sumVy) || 1;
        let sx = (sumVx / m) * maxSpeed - vx[i];
        let sy = (sumVy / m) * maxSpeed - vy[i];
        let sm = Math.hypot(sx, sy);
        if (sm > maxForce) { sx = (sx / sm) * maxForce; sy = (sy / sm) * maxForce; }
        ax += sx * p.align;
        ay += sy * p.align;
        // cohesion (centroid is the average relative offset)
        m = Math.hypot(sumDx, sumDy) || 1;
        sx = (sumDx / m) * maxSpeed - vx[i];
        sy = (sumDy / m) * maxSpeed - vy[i];
        sm = Math.hypot(sx, sy);
        if (sm > maxForce) { sx = (sx / sm) * maxForce; sy = (sy / sm) * maxForce; }
        ax += sx * p.coh;
        ay += sy * p.coh;
      }
      if (sepX !== 0 || sepY !== 0) {
        const m = Math.hypot(sepX, sepY) || 1;
        let sx = (sepX / m) * maxSpeed - vx[i];
        let sy = (sepY / m) * maxSpeed - vy[i];
        const sm = Math.hypot(sx, sy);
        if (sm > maxForce) { sx = (sx / sm) * maxForce; sy = (sy / sm) * maxForce; }
        ax += sx * p.sep;
        ay += sy * p.sep;
      }
      if (p.mouseAttract !== 0) {
        let dx = p.mx - xi;
        let dy = p.my - yi;
        if (wrap) {
          if (dx > halfW) dx -= w; else if (dx < -halfW) dx += w;
          if (dy > halfH) dy -= h; else if (dy < -halfH) dy += h;
        }
        const m = Math.hypot(dx, dy) || 1;
        let sx = (dx / m) * maxSpeed - vx[i];
        let sy = (dy / m) * maxSpeed - vy[i];
        const sm = Math.hypot(sx, sy);
        if (sm > maxForce) { sx = (sx / sm) * maxForce; sy = (sy / sm) * maxForce; }
        ax += sx * p.mouseAttract;
        ay += sy * p.mouseAttract;
      }

      let nvx = vx[i] + ax;
      let nvy = vy[i] + ay;
      const sp = Math.hypot(nvx, nvy);
      if (sp > maxSpeed) { nvx = (nvx / sp) * maxSpeed; nvy = (nvy / sp) * maxSpeed; }
      else if (sp < maxSpeed * 0.25 && sp > 1e-4) { const t = (maxSpeed * 0.25) / sp; nvx *= t; nvy *= t; }
      vx[i] = nvx;
      vy[i] = nvy;
    }

    // ---- integrate positions ----
    for (let i = 0; i < count; i++) {
      let x = px[i] + vx[i];
      let y = py[i] + vy[i];
      if (wrap) {
        if (x < 0) x += w; else if (x >= w) x -= w;
        if (y < 0) y += h; else if (y >= h) y -= h;
      } else {
        if (x < 0) { x = 0; vx[i] = Math.abs(vx[i]); } else if (x > w) { x = w; vx[i] = -Math.abs(vx[i]); }
        if (y < 0) { y = 0; vy[i] = Math.abs(vy[i]); } else if (y > h) { y = h; vy[i] = -Math.abs(vy[i]); }
      }
      px[i] = x;
      py[i] = y;
    }
  }

  private draw(count: number, props: Record<string, unknown>, w: number, h: number): void {
    const ctx = this.ctx;
    const trail = num(props.trail, 0) / 100;
    if (trail > 0.01) {
      // Fade existing pixels' alpha (keeps the layer transparent → clean trails).
      ctx.globalCompositeOperation = "destination-out";
      ctx.fillStyle = `rgba(0,0,0,${1 - trail})`;
      ctx.fillRect(0, 0, w, h);
      ctx.globalCompositeOperation = "source-over";
    } else {
      ctx.clearRect(0, 0, w, h);
    }

    ctx.fillStyle = rgba(props.color);
    const size = num(props.size, 9);
    const { px, py, vx, vy } = this;

    ctx.beginPath();
    if (props.shape === "dot") {
      const r = size * 0.5;
      for (let i = 0; i < count; i++) ctx.rect(px[i] - r, py[i] - r, size, size);
    } else {
      for (let i = 0; i < count; i++) {
        let dx = vx[i], dy = vy[i];
        const sp = Math.hypot(dx, dy) || 1;
        dx /= sp;
        dy /= sp;
        const bcx = px[i] - dx * size * 0.6;
        const bcy = py[i] - dy * size * 0.6;
        const ox = -dy * size * 0.5;
        const oy = dx * size * 0.5;
        ctx.moveTo(px[i] + dx * size, py[i] + dy * size);
        ctx.lineTo(bcx + ox, bcy + oy);
        ctx.lineTo(bcx - ox, bcy - oy);
      }
    }
    ctx.fill();
  }

  render(frame: RenderFrame): HTMLCanvasElement {
    if (this.canvas.width !== frame.width || this.canvas.height !== frame.height) {
      this.resize(frame.width, frame.height);
    }
    const w = this.canvas.width;
    const h = this.canvas.height;
    const pr = frame.props;

    const count = Math.max(0, Math.min(HARD_MAX, Math.round(num(pr.count, 400))));
    const seed = num(pr.seed, 1);

    if (count !== this.lastCount || seed !== this.lastSeed || this.forceInitial) {
      this.lastCount = count;
      this.lastSeed = seed;
      if (count > 0) this.reinit(count, seed, w, h);
    }

    const perception = num(pr.perception, 60);
    const sepRange = num(pr.separationRange, 26);
    const p: SimParams = {
      perception,
      perception2: perception * perception,
      sepRange2: sepRange * sepRange,
      maxSpeed: num(pr.maxSpeed, 3.5),
      maxForce: num(pr.maxForce, 0.4),
      sep: num(pr.separation, 1.6),
      align: num(pr.alignment, 1),
      coh: num(pr.cohesion, 0.9),
      wrap: pr.wrap !== false,
      mouseAttract: num(pr.mouseAttract, 0),
      mx: frame.input.mouseX,
      my: frame.input.mouseY,
    };

    // Deterministic advance to the composition frame.
    let steps = 0;
    if (count > 0) {
      const target = frame.frame;
      if (target < this.simFrame) {
        this.reinit(count, seed, w, h);
        steps = Math.min(target, MAX_CATCHUP);
      } else {
        steps = Math.min(target - this.simFrame, MAX_CATCHUP);
      }
      // Mouse interaction must move every frame, so always re-step the current frame
      // while playing even if it was already simulated (keeps it lively under the cursor).
      if (steps === 0 && frame.playing && p.mouseAttract !== 0) steps = 1;
      for (let s = 0; s < steps; s++) this.step(count, p, w, h);
      this.simFrame = target;
    }

    const key = [count, JSON.stringify(pr.color), pr.size, pr.shape, pr.trail].join("|");
    const drew = steps > 0 || this.forceInitial || key !== this.lastKey;
    this.lastKey = key;
    this.forceInitial = false;
    if (count === 0) this.ctx.clearRect(0, 0, w, h);
    else if (drew) this.draw(count, pr, w, h);
    return this.canvas;
  }

  dispose(): void {
    this.canvas.width = this.canvas.height = 0;
    this.px = this.py = this.vx = this.vy = new Float32Array(0);
  }
}

export const boidsLayerType: LayerTypeDefinition = {
  type: "boids",
  label: "Boids",
  category: "Simulation",
  icon: "Bird",
  description: "Flocking simulation (separation / alignment / cohesion), spatial-grid accelerated.",
  defaultSize: (comp) => [comp.width, comp.height],
  schema: [
    { key: "count", name: "Count", type: "number", default: 500, group: "Flock", animatable: false, meta: { min: 1, max: 5000, step: 1 } },
    { key: "seed", name: "Seed", type: "number", default: 1, group: "Flock", animatable: false, meta: { min: 0, max: 99999, step: 1 } },
    { key: "maxSpeed", name: "Max Speed", type: "number", default: 3.5, group: "Flock", meta: { min: 0.2, max: 20, step: 0.1 } },
    { key: "maxForce", name: "Turn Force", type: "number", default: 0.4, group: "Flock", meta: { min: 0.01, max: 2, step: 0.01 } },
    { key: "wrap", name: "Wrap Edges", type: "boolean", default: true, group: "Flock" },
    { key: "perception", name: "Perception", type: "number", default: 60, group: "Forces", meta: { min: 8, max: 400, step: 1 } },
    { key: "separationRange", name: "Separation Range", type: "number", default: 26, group: "Forces", meta: { min: 1, max: 200, step: 1 } },
    { key: "separation", name: "Separation", type: "number", default: 1.6, group: "Forces", meta: { min: 0, max: 5, step: 0.05 } },
    { key: "alignment", name: "Alignment", type: "number", default: 1, group: "Forces", meta: { min: 0, max: 5, step: 0.05 } },
    { key: "cohesion", name: "Cohesion", type: "number", default: 0.9, group: "Forces", meta: { min: 0, max: 5, step: 0.05 } },
    { key: "mouseAttract", name: "Cursor Pull", type: "number", default: 0, group: "Forces", meta: { min: -2, max: 2, step: 0.05 } },
    { key: "color", name: "Color", type: "color", default: [192, 252, 4, 255], group: "Appearance" },
    { key: "size", name: "Boid Size", type: "number", default: 9, group: "Appearance", meta: { min: 1, max: 60, step: 0.5 } },
    { key: "shape", name: "Shape", type: "select", default: "triangle", group: "Appearance", meta: { options: [ { label: "Triangle", value: "triangle" }, { label: "Dot", value: "dot" } ] } },
    { key: "trail", name: "Trails", type: "percent", default: 0, group: "Appearance", meta: { min: 0, max: 98, step: 1 } },
  ],
  createRenderer: () => new BoidsRenderer(),
};
