import { Plugin, type Frame } from "./Plugin";
import { fieldToMask } from "./_shared/textField";

// ── deterministic hash + 3D value-noise (z is the animation axis) ─────────────
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
  const c000 = hash3(x0, y0, z0, seed);
  const c100 = hash3(x0 + 1, y0, z0, seed);
  const c010 = hash3(x0, y0 + 1, z0, seed);
  const c110 = hash3(x0 + 1, y0 + 1, z0, seed);
  const c001 = hash3(x0, y0, z0 + 1, seed);
  const c101 = hash3(x0 + 1, y0, z0 + 1, seed);
  const c011 = hash3(x0, y0 + 1, z0 + 1, seed);
  const c111 = hash3(x0 + 1, y0 + 1, z0 + 1, seed);
  const x00 = c000 + (c100 - c000) * fx;
  const x10 = c010 + (c110 - c010) * fx;
  const x01 = c001 + (c101 - c001) * fx;
  const x11 = c011 + (c111 - c011) * fx;
  const y0v = x00 + (x10 - x00) * fy;
  const y1v = x01 + (x11 - x01) * fy;
  return y0v + (y1v - y0v) * fz;
}
function fbm3(x: number, y: number, z: number, seed: number, octaves: number): number {
  let amp = 0.5, freq = 1, sum = 0, norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += amp * valueNoise3(x * freq, y * freq, z * freq, seed + o * 1013);
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return sum / norm;
}

const MAX_CELLS = 200000;
const LINE = [40, 40, 255, 255];

/**
 * Marching-squares contour field over an animated 3D fBm noise field: walking the field's z-axis
 * over time morphs contours in place (loops pinch off, merge, drift), and a second domain-warp axis
 * adds a swirling "floating on water" motion.
 */
export class ContourFieldLayer extends Plugin {
  override nativeColor = "#2828FF"; // matches LINE — colors the bank dot / "native" on the color cycle
  resolution = this.number({ min: 0.05, max: 0.5, default: 0.22 });
  scale = this.number({ min: 1, max: 16, default: 6 });
  octaves = this.number({ min: 1, max: 8, step: 1, default: 4 });
  warp = this.number({ min: 0, max: 2, default: 0.4 });
  levels = this.number({ min: 2, max: 60, step: 1, default: 18 });
  evolveSpeed = this.number({ min: 0, max: 4, default: 1 });
  swirlSpeed = this.number({ min: 0, max: 4, default: 0.6 });
  lineWidth = this.number({ min: 0.25, max: 6, default: 1 });
  seed = this.number({ min: 1, max: 64, step: 1, default: 1 });
  textStrength = this.number({ min: 0, max: 1, default: 0.7 });

  private ctx = this.canvas.getContext("2d")!;
  private cols = 0;
  private rows = 0;
  private grid = new Float32Array(0);
  private mask = new Float32Array(0);
  private maskKey = "";

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

  private sampleField(scale: number, octaves: number, seed: number, zEvo: number, warp: number, zWarp: number): void {
    const { cols, rows } = this;
    const n = cols * rows;
    if (this.grid.length !== n) this.grid = new Float32Array(n);
    const g = this.grid;
    const fx = scale / cols, fy = scale / rows;
    let i = 0;
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        let sx = x * fx, sy = y * fy;
        if (warp > 0) {
          const wx = fbm3(sx + 11.3, sy + 4.7, zWarp, seed + 7777, 2) - 0.5;
          const wy = fbm3(sx + 2.1, sy + 19.4, zWarp + 5.0, seed + 3333, 2) - 0.5;
          sx += wx * warp;
          sy += wy * warp;
        }
        g[i++] = fbm3(sx, sy, zEvo, seed, octaves);
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
    const L = ContourFieldLayer.lerp;
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
          case 6: case 9: seg(top(), bottom()); break;
          case 7: case 8: seg(top(), left()); break;
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

  render(f: Frame): HTMLCanvasElement {
    const resolution = Math.max(0.05, Math.min(0.5, this.resolution.value));
    const [cols, rows] = this.gridSize(resolution);
    this.cols = cols;
    this.rows = rows;

    const seed = Math.round(this.seed.value);
    const scale = Math.max(1, this.scale.value);
    const octaves = Math.max(1, Math.min(8, Math.round(this.octaves.value)));
    const warp = Math.max(0, this.warp.value);
    const levels = Math.max(2, Math.min(60, Math.round(this.levels.value)));
    const zEvo = f.time * this.evolveSpeed.value * 0.6;
    const zWarp = f.time * this.swirlSpeed.value * 0.6;

    this.sampleField(scale, octaves, seed, zEvo, warp, zWarp);

    // Boost grid values where text mask is set so contours cluster around the text.
    if (f.textField) {
      const n = cols * rows;
      const fieldKey = (f.textField.key ?? String(f.time)) + cols + "x" + rows;
      if (fieldKey !== this.maskKey || this.mask.length !== n) {
        if (this.mask.length !== n) this.mask = new Float32Array(n);
        fieldToMask(f.textField, cols, rows, this.mask);
        this.maskKey = fieldKey;
      }
      const strength = this.textStrength.value;
      if (strength > 0) {
        for (let i = 0; i < n; i++) this.grid[i] += this.mask[i] * strength * 0.5;
      }
    }

    const w = this.canvas.width, h = this.canvas.height;
    const sx = w / (cols - 1), sy = h / (rows - 1);
    const ctx = this.ctx;
    ctx.clearRect(0, 0, w, h);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = `rgba(${LINE[0]},${LINE[1]},${LINE[2]},${LINE[3] / 255})`;

    const lineWidth = Math.max(0.25, this.lineWidth.value);
    for (let k = 1; k <= levels; k++) {
      const level = k / (levels + 1);
      ctx.lineWidth = k % 5 === 0 ? lineWidth * 2.2 : lineWidth;
      ctx.beginPath();
      this.marchLevel(level, sx, sy);
      ctx.stroke();
    }
    return this.canvas;
  }

  dispose(): void {
    super.dispose();
    this.grid = new Float32Array(0);
  }
}
