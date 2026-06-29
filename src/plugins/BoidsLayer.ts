import { Plugin, type Frame } from "./Plugin";

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
}

/**
 * Boids flocking (Reynolds: separation / alignment / cohesion). Flat Float32Array state, an O(n)
 * uniform-grid neighbour search, and one batched fill per frame. Velocity units are px/frame.
 */
export class BoidsLayer extends Plugin {
  count = this.knob(0, { min: 0, max: HARD_MAX, step: 50, default: 400 });
  perception = this.knob(1, { min: 10, max: 160, default: 60 });
  separationRange = this.knob(2, { min: 4, max: 80, default: 26 });
  maxSpeed = this.knob(3, { min: 0.5, max: 10, default: 3.5 });
  maxForce = this.knob(4, { min: 0.05, max: 2, default: 0.4 });
  separation = this.knob(5, { min: 0, max: 4, default: 1.6 });
  alignment = this.knob(6, { min: 0, max: 4, default: 1 });
  cohesion = this.knob(7, { min: 0, max: 4, default: 0.9 });
  size = this.knob(8, { min: 2, max: 30, default: 9 });
  trail = this.fader(0, { min: 0, max: 100, default: 0 });
  seed = this.fader(1, { min: 1, max: 64, step: 1, default: 1 });
  wrap = this.pad(4);
  dot = this.pad(5);
  reseed = this.pad(6);

  private ctx = this.canvas.getContext("2d")!;
  private px = new Float32Array(0);
  private py = new Float32Array(0);
  private pz = new Float32Array(0);
  private vx = new Float32Array(0);
  private vy = new Float32Array(0);
  private vz = new Float32Array(0);
  private capacity = 0;
  private drawOrder = new Int32Array(0);
  private cellStart = new Int32Array(0);
  private cursor = new Int32Array(0);
  private sorted = new Int32Array(0);
  private cellOf = new Int32Array(0);
  private lastCount = -1;
  private lastSeed = NaN;
  private lastReseed = 0;

  constructor() {
    super();
    this.wrap.on = true;
  }

  private ensureCapacity(n: number): void {
    if (n <= this.capacity) return;
    this.px = new Float32Array(n);
    this.py = new Float32Array(n);
    this.pz = new Float32Array(n);
    this.vx = new Float32Array(n);
    this.vy = new Float32Array(n);
    this.vz = new Float32Array(n);
    this.sorted = new Int32Array(n);
    this.cellOf = new Int32Array(n);
    this.drawOrder = new Int32Array(n);
    this.capacity = n;
  }

  private reinit(count: number, seed: number, w: number, h: number): void {
    this.ensureCapacity(count);
    const rnd = mulberry32((seed | 0) * 1000003 + 1);
    for (let i = 0; i < count; i++) {
      this.px[i] = rnd() * w;
      this.py[i] = rnd() * h;
      this.pz[i] = rnd() * 2 - 1;
      const a = rnd() * Math.PI * 2;
      const sp = 0.5 + rnd();
      this.vx[i] = Math.cos(a) * sp;
      this.vy[i] = Math.sin(a) * sp;
      this.vz[i] = (rnd() - 0.5) * 0.08;
    }
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
    const { px, py, pz, vx, vy, vz, cellStart, cursor, sorted, cellOf } = this;
    const wrap = p.wrap;

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
        let m = Math.hypot(sumVx, sumVy) || 1;
        let sx = (sumVx / m) * maxSpeed - vx[i];
        let sy = (sumVy / m) * maxSpeed - vy[i];
        let sm = Math.hypot(sx, sy);
        if (sm > maxForce) { sx = (sx / sm) * maxForce; sy = (sy / sm) * maxForce; }
        ax += sx * p.align;
        ay += sy * p.align;
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

      let nvx = vx[i] + ax;
      let nvy = vy[i] + ay;
      const sp = Math.hypot(nvx, nvy);
      if (sp > maxSpeed) { nvx = (nvx / sp) * maxSpeed; nvy = (nvy / sp) * maxSpeed; }
      else if (sp < maxSpeed * 0.25 && sp > 1e-4) { const t = (maxSpeed * 0.25) / sp; nvx *= t; nvy *= t; }
      vx[i] = nvx;
      vy[i] = nvy;
    }

    for (let i = 0; i < count; i++) {
      let x = px[i] + vx[i];
      let y = py[i] + vy[i];
      let z = pz[i] + vz[i] * 0.3;
      vz[i] *= 0.95;
      if (wrap) {
        if (x < 0) x += w; else if (x >= w) x -= w;
        if (y < 0) y += h; else if (y >= h) y -= h;
        if (z < -1) z += 2; else if (z > 1) z -= 2;
      } else {
        if (x < 0) { x = 0; vx[i] = Math.abs(vx[i]); } else if (x > w) { x = w; vx[i] = -Math.abs(vx[i]); }
        if (y < 0) { y = 0; vy[i] = Math.abs(vy[i]); } else if (y > h) { y = h; vy[i] = -Math.abs(vy[i]); }
        if (z < -1) { z = -1; vz[i] = Math.abs(vz[i]); } else if (z > 1) { z = 1; vz[i] = -Math.abs(vz[i]); }
      }
      px[i] = x;
      py[i] = y;
      pz[i] = z;
    }
  }

  private draw(count: number, w: number, h: number): void {
    const ctx = this.ctx;
    const trail = this.trail.value / 100;
    if (trail > 0.01) {
      ctx.globalCompositeOperation = "destination-out";
      ctx.fillStyle = `rgba(0,0,0,${1 - trail})`;
      ctx.fillRect(0, 0, w, h);
      ctx.globalCompositeOperation = "source-over";
    } else {
      ctx.clearRect(0, 0, w, h);
    }

    const size = this.size.value;
    const { px, py, pz, vx, vy } = this;
    const isDot = this.dot.on;

    for (let i = 0; i < count; i++) this.drawOrder[i] = i;
    this.drawOrder.subarray(0, count).sort((a, b) => pz[a] - pz[b]);

    for (let idx = 0; idx < count; idx++) {
      const i = this.drawOrder[idx];
      const depth = (pz[i] + 1) * 0.5;
      const scale = 0.5 + depth * 0.5;
      const alpha = 0.4 + depth * 0.6;
      ctx.fillStyle = `rgba(192,252,4,${alpha})`;

      if (isDot) {
        const r = size * scale * 0.5;
        ctx.fillRect(px[i] - r, py[i] - r, r * 2, r * 2);
      } else {
        let dx = vx[i], dy = vy[i];
        const sp = Math.hypot(dx, dy) || 1;
        dx /= sp;
        dy /= sp;
        const ss = size * scale;
        const bcx = px[i] - dx * ss * 0.6;
        const bcy = py[i] - dy * ss * 0.6;
        const ox = -dy * ss * 0.5;
        const oy = dx * ss * 0.5;
        ctx.beginPath();
        ctx.moveTo(px[i] + dx * ss, py[i] + dy * ss);
        ctx.lineTo(bcx + ox, bcy + oy);
        ctx.lineTo(bcx - ox, bcy - oy);
        ctx.fill();
      }
    }
  }

  render(_f: Frame): HTMLCanvasElement {
    const w = this.canvas.width, h = this.canvas.height;
    const count = Math.max(0, Math.min(HARD_MAX, Math.round(this.count.value)));
    const seed = Math.round(this.seed.value);

    if (count !== this.lastCount || seed !== this.lastSeed || this.reseed.count !== this.lastReseed) {
      this.lastCount = count;
      this.lastSeed = seed;
      this.lastReseed = this.reseed.count;
      if (count > 0) this.reinit(count, seed, w, h);
    }

    if (count === 0) {
      this.ctx.clearRect(0, 0, w, h);
      return this.canvas;
    }

    const perception = this.perception.value;
    const sepRange = this.separationRange.value;
    this.step(count, {
      perception,
      perception2: perception * perception,
      sepRange2: sepRange * sepRange,
      maxSpeed: this.maxSpeed.value,
      maxForce: this.maxForce.value,
      sep: this.separation.value,
      align: this.alignment.value,
      coh: this.cohesion.value,
      wrap: this.wrap.on,
    }, w, h);
    this.draw(count, w, h);
    return this.canvas;
  }

  dispose(): void {
    super.dispose();
    this.px = this.py = this.pz = this.vx = this.vy = this.vz = new Float32Array(0);
    this.drawOrder = new Int32Array(0);
  }
}
