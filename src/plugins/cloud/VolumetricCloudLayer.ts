import type { LayerTypeDefinition } from "../../engine/plugins/Registry";
import type { LayerRenderer, RenderFrame } from "../../engine/render/types";

function num(v: unknown, f: number): number {
  return typeof v === "number" ? v : f;
}
function arr(v: unknown, f: number[]): number[] {
  return Array.isArray(v) ? (v as number[]) : f;
}
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

/**
 * Stylised volumetric clouds: a short light-marched fBm density field rendered into a
 * downsampled buffer (the usual trick to keep per-pixel volume work affordable). Two
 * tone (lit/shadow) so it reads graphic and on-brand rather than photoreal. Transparent,
 * so it composites over the layers below; deterministic over time.
 */
class CloudRenderer implements LayerRenderer {
  private canvas = document.createElement("canvas");
  private ctx = this.canvas.getContext("2d")!;
  private buf = document.createElement("canvas");
  private bctx = this.buf.getContext("2d")!;
  private image?: ImageData;

  resize(w: number, h: number): void {
    this.canvas.width = Math.max(1, Math.round(w));
    this.canvas.height = Math.max(1, Math.round(h));
  }

  render(frame: RenderFrame): HTMLCanvasElement {
    if (this.canvas.width !== frame.width || this.canvas.height !== frame.height) this.resize(frame.width, frame.height);
    const w = this.canvas.width, h = this.canvas.height;
    const pr = frame.props;

    const detail = Math.max(0.05, Math.min(0.6, num(pr.detail, 0.2)));
    const rw = Math.max(2, Math.round(w * detail));
    const rh = Math.max(2, Math.round(h * detail));
    if (this.buf.width !== rw || this.buf.height !== rh || !this.image) {
      this.buf.width = rw;
      this.buf.height = rh;
      this.image = this.bctx.createImageData(rw, rh);
    }

    const scale = num(pr.scale, 3);
    const oct = Math.max(1, Math.min(6, Math.round(num(pr.octaves, 4))));
    const coverage = num(pr.coverage, 0.5);
    const density = num(pr.density, 1.4);
    const steps = Math.max(2, Math.min(24, Math.round(num(pr.steps, 8))));
    const shadowStrength = num(pr.shadow, 0.8);
    const z0 = frame.time * num(pr.speed, 0.25);
    const aspect = w / h;
    const lightC = arr(pr.lightColor, [214, 255, 170]);
    const shadowC = arr(pr.shadowColor, [62, 28, 96]);

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
        data[idx++] = shadowC[0] + (lightC[0] - shadowC[0]) * t;
        data[idx++] = shadowC[1] + (lightC[1] - shadowC[1]) * t;
        data[idx++] = shadowC[2] + (lightC[2] - shadowC[2]) * t;
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
    this.canvas.width = this.canvas.height = 0;
    this.buf.width = this.buf.height = 0;
    this.image = undefined;
  }
}

export const cloudLayerType: LayerTypeDefinition = {
  type: "cloud",
  label: "Volumetric Cloud",
  category: "Generators",
  icon: "CloudFog",
  description: "Stylised light-marched volumetric clouds (two-tone, transparent).",
  defaultSize: (comp) => [comp.width, comp.height],
  schema: [
    { key: "coverage", name: "Coverage", type: "number", default: 0.5, group: "Cloud", meta: { min: 0.1, max: 0.9, step: 0.01 } },
    { key: "density", name: "Density", type: "number", default: 1.4, group: "Cloud", meta: { min: 0.2, max: 4, step: 0.05 } },
    { key: "scale", name: "Scale", type: "number", default: 3, group: "Cloud", meta: { min: 0.5, max: 12, step: 0.1 } },
    { key: "octaves", name: "Octaves", type: "number", default: 4, group: "Cloud", animatable: false, meta: { min: 1, max: 6, step: 1 } },
    { key: "speed", name: "Drift Speed", type: "number", default: 0.25, group: "Cloud", meta: { min: -3, max: 3, step: 0.05 } },
    { key: "shadow", name: "Shadow", type: "percent", default: 0.8, group: "Cloud", meta: { min: 0, max: 1, step: 0.01 } },
    { key: "steps", name: "March Steps (perf)", type: "number", default: 8, group: "Cloud", animatable: false, meta: { min: 2, max: 24, step: 1 } },
    { key: "detail", name: "Detail (perf)", type: "percent", default: 0.2, group: "Cloud", meta: { min: 0.05, max: 0.6, step: 0.01 } },
    { key: "lightColor", name: "Light Color", type: "color", default: [214, 255, 170, 255], group: "Look" },
    { key: "shadowColor", name: "Shadow Color", type: "color", default: [62, 28, 96, 255], group: "Look" },
  ],
  createRenderer: () => new CloudRenderer(),
};
