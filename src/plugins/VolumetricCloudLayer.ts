import { Plugin, type Frame } from "./Plugin";

function smooth(e0: number, e1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0 || 1)));
  return t * t * (3 - 2 * t);
}

// 0..1 value noise (3D) + fBm
function hash3(x: number, y: number, z: number): number {
  let n = (x * 374761393 + y * 668265263 + z * 1274126177) | 0;
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}
function vnoise3(x: number, y: number, z: number): number {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const xf = x - xi, yf = y - yi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf), w = zf * zf * (3 - 2 * zf);
  const L = (a: number, b: number, t: number) => a + (b - a) * t;
  const c = (a: number, b: number, d: number) => hash3(xi + a, yi + b, zi + d);
  return L(L(L(c(0, 0, 0), c(1, 0, 0), u), L(c(0, 1, 0), c(1, 1, 0), u), v), L(L(c(0, 0, 1), c(1, 0, 1), u), L(c(0, 1, 1), c(1, 1, 1), u), v), w);
}
function fbm3(x: number, y: number, z: number, oct: number): number {
  let s = 0, a = 0.5, f = 1, n = 0;
  for (let o = 0; o < oct; o++) { s += a * vnoise3(x * f, y * f, z * f); n += a; a *= 0.5; f *= 2; }
  return s / (n || 1);
}

const LIGHT = [214, 255, 170];
const SHADOW = [62, 28, 96];

/**
 * Stylised volumetric clouds: a short light-marched fBm density field rendered into a downsampled
 * buffer. Two-tone (lit/shadow) so it reads graphic rather than photoreal. Transparent + deterministic.
 */
export class VolumetricCloudLayer extends Plugin {
  detail = this.knob(0, { min: 0.05, max: 0.6, default: 0.2 });
  scale = this.knob(1, { min: 1, max: 8, default: 3 });
  octaves = this.knob(2, { min: 1, max: 6, step: 1, default: 4 });
  coverage = this.knob(3, { min: 0, max: 1, default: 0.5 });
  density = this.knob(4, { min: 0.2, max: 3, default: 1.4 });
  steps = this.knob(5, { min: 2, max: 24, step: 1, default: 8 });
  shadow = this.knob(6, { min: 0, max: 1, default: 0.8 });
  speed = this.knob(7, { min: 0, max: 1.5, default: 0.25 });

  private ctx = this.canvas.getContext("2d")!;
  private buf = document.createElement("canvas");
  private bctx = this.buf.getContext("2d")!;
  private image?: ImageData;

  render(f: Frame): HTMLCanvasElement {
    const w = this.canvas.width, h = this.canvas.height;
    const detail = Math.max(0.05, Math.min(0.6, this.detail.value));
    const rw = Math.max(2, Math.round(w * detail));
    const rh = Math.max(2, Math.round(h * detail));
    if (this.buf.width !== rw || this.buf.height !== rh || !this.image) {
      this.buf.width = rw;
      this.buf.height = rh;
      this.image = this.bctx.createImageData(rw, rh);
    }

    const scale = this.scale.value;
    const oct = Math.max(1, Math.min(6, Math.round(this.octaves.value)));
    const coverage = this.coverage.value;
    const density = this.density.value;
    const steps = Math.max(2, Math.min(24, Math.round(this.steps.value)));
    const shadowStrength = this.shadow.value;
    const z0 = f.time * this.speed.value;
    const aspect = w / h;

    const data = this.image.data;
    let idx = 0;
    for (let y = 0; y < rh; y++) {
      const sy = (y / rh) * scale;
      for (let x = 0; x < rw; x++) {
        const sx = (x / rw) * scale * aspect;
        let trans = 1, lum = 0;
        for (let k = 0; k < steps; k++) {
          const zt = z0 + (k / steps) * 2.2;
          let d = fbm3(sx, sy, zt, oct);
          d = smooth(coverage, coverage + 0.22, d) * density;
          if (d > 0.002) {
            const ls = fbm3(sx + 0.18, sy - 0.28, zt + 0.18, oct);
            const lit = 1 - smooth(coverage, 1, ls) * shadowStrength;
            const a = Math.min(1, (d / steps) * 4.5);
            lum += a * trans * Math.max(0, lit);
            trans *= 1 - a;
            if (trans < 0.02) break;
          }
        }
        const alpha = 1 - trans;
        const t = alpha > 0.001 ? Math.max(0, Math.min(1, lum / alpha)) : 0;
        data[idx++] = SHADOW[0] + (LIGHT[0] - SHADOW[0]) * t;
        data[idx++] = SHADOW[1] + (LIGHT[1] - SHADOW[1]) * t;
        data[idx++] = SHADOW[2] + (LIGHT[2] - SHADOW[2]) * t;
        data[idx++] = alpha * 255;
      }
    }
    this.bctx.putImageData(this.image, 0, 0);
    this.ctx.clearRect(0, 0, w, h);
    this.ctx.imageSmoothingEnabled = true;
    this.ctx.drawImage(this.buf, 0, 0, rw, rh, 0, 0, w, h);
    return this.canvas;
  }

  dispose(): void {
    super.dispose();
    this.buf.width = this.buf.height = 0;
    this.image = undefined;
  }
}
