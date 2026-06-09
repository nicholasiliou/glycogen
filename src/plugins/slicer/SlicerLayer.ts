import type { LayerTypeDefinition } from "../../engine/plugins/Registry";
import type { LayerRenderer, RenderFrame } from "../../engine/render/types";

function num(v: unknown, f: number): number {
  return typeof v === "number" ? v : f;
}
function arr(v: unknown, f: number[]): number[] {
  return Array.isArray(v) ? (v as number[]) : f;
}
function lerpC(a: number[], b: number[], t: number, alphaMul = 1): string {
  const r = Math.round(a[0] + (b[0] - a[0]) * t);
  const g = Math.round(a[1] + (b[1] - a[1]) * t);
  const bl = Math.round(a[2] + (b[2] - a[2]) * t);
  const al = (a[3] + (b[3] - a[3]) * t) / 255 * alphaMul;
  return `rgba(${r},${g},${bl},${al})`;
}

type Shape = "sphere" | "torus" | "gyroid";

/** Implicit field; inside is field < 0. Domain is the unit cube [-1,1]³. */
function field(shape: Shape, x: number, y: number, z: number, freq: number): number {
  if (shape === "sphere") return x * x + y * y + z * z - 0.81;
  if (shape === "torus") {
    const q = Math.sqrt(x * x + z * z) - 0.55;
    return q * q + y * y - 0.0484; // tube radius 0.22
  }
  // gyroid (a triply-periodic minimal surface) clipped to the unit ball
  if (x * x + y * y + z * z > 0.9) return 1;
  const k = Math.PI * freq;
  return Math.sin(k * x) * Math.cos(k * y) + Math.sin(k * y) * Math.cos(k * z) + Math.sin(k * z) * Math.cos(k * x);
}

/**
 * Slices an implicit 3D object into a stack of horizontal cross-sections and projects
 * each one with its own affine transform (a tilt + a time-driven spin), so it reads as
 * a rotating 3D form built from rings or planes.
 *   • rings  → marching-squares contour of each slice, stroked.
 *   • planes → filled cross-section (inside cells).
 * Each slice is drawn in its own local 2D space via ctx.setTransform, which is what
 * makes the 3D placement cheap (no matrix maths per point). Spin comes from the
 * composition clock, so it's deterministic and seekable.
 */
class SlicerRenderer implements LayerRenderer {
  private canvas = document.createElement("canvas");
  private ctx = this.canvas.getContext("2d")!;
  private grid = new Float32Array(0);
  private gridN = -1;
  private lastFrame = -1;
  private lastKey = "";
  private forceInitial = true;

  resize(w: number, h: number): void {
    this.canvas.width = Math.max(1, Math.round(w));
    this.canvas.height = Math.max(1, Math.round(h));
  }

  render(frame: RenderFrame): HTMLCanvasElement {
    if (this.canvas.width !== frame.width || this.canvas.height !== frame.height) {
      this.resize(frame.width, frame.height);
    }
    const pr = frame.props;
    const key = JSON.stringify([
      pr.shape, pr.mode, pr.slices, pr.detail, pr.radius, pr.gyroidFreq,
      pr.tilt, pr.color, pr.colorB, pr.lineWidth, pr.depthShade,
    ]);
    const drew = this.forceInitial || frame.frame !== this.lastFrame || key !== this.lastKey;
    this.lastFrame = frame.frame;
    this.lastKey = key;
    this.forceInitial = false;
    if (drew) this.draw(frame);
    return this.canvas;
  }

  private draw(frame: RenderFrame): void {
    const pr = frame.props;
    const w = this.canvas.width;
    const h = this.canvas.height;
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const shape = (pr.shape === "torus" || pr.shape === "gyroid" ? pr.shape : "sphere") as Shape;
    const mode = pr.mode === "planes" ? "planes" : "rings";
    const slices = Math.max(2, Math.min(120, Math.round(num(pr.slices, 22))));
    const n = Math.max(8, Math.min(96, Math.round(num(pr.detail, 36))));
    const radius = num(pr.radius, 0.7);
    const freq = num(pr.gyroidFreq, 2.5);
    const tilt = (num(pr.tilt, 62) * Math.PI) / 180;
    const spinDeg = frame.time * num(pr.spin, 30) + num(pr.rotation, 0);
    const theta = (spinDeg * Math.PI) / 180;
    const lineW = num(pr.lineWidth, 1.5);
    const depthShade = pr.depthShade !== false;

    const colA = arr(pr.color, [192, 252, 4, 255]);
    const colB = arr(pr.colorB, [54, 1, 251, 255]);

    const scale = radius * Math.min(w, h) * 0.5;
    const cx = w / 2;
    const cy = h / 2;

    // Rotation basis images (R = rotX(tilt) * rotY(theta)); we only need .X/.Y/.Z parts.
    const ct = Math.cos(theta), st = Math.sin(theta);
    const cf = Math.cos(tilt), sf = Math.sin(tilt);
    const exX = ct, exY = sf * st;
    const ezX = st, ezY = -sf * ct;
    const eyX = 0, eyY = cf, eyZ = sf;

    if (this.grid.length < (n + 1) * (n + 1)) this.grid = new Float32Array((n + 1) * (n + 1));
    const F = this.grid;

    // Depth-sorted slice order (painter's algorithm).
    const order: number[] = [];
    for (let s = 0; s < slices; s++) order.push(s);
    const ys = (s: number) => -1 + (2 * s) / (slices - 1);
    order.sort((a, b) => ys(a) * eyZ - ys(b) * eyZ);

    const step = 2 / n;

    for (const s of order) {
      const y = ys(s);
      // sample the field grid for this slice
      for (let j = 0; j <= n; j++) {
        const b = -1 + j * step;
        const rowOff = j * (n + 1);
        for (let i = 0; i <= n; i++) {
          const a = -1 + i * step;
          F[rowOff + i] = field(shape, a, y, b, freq);
        }
      }

      // affine: local (a,b) → screen
      const m11 = exX * scale;
      const m21 = exY * scale;
      const m12 = ezX * scale;
      const m22 = ezY * scale;
      const dx = cx + y * eyX * scale;
      const dy = cy + y * eyY * scale;
      ctx.setTransform(m11, m21, m12, m22, dx, dy);

      const t = s / (slices - 1);
      const shade = depthShade ? 0.45 + 0.55 * (0.5 + 0.5 * (y * eyZ)) : 1;
      const style = lerpC(colA, colB, t, Math.max(0, Math.min(1, shade)));

      if (mode === "planes") {
        ctx.fillStyle = style;
        ctx.beginPath();
        for (let j = 0; j < n; j++) {
          const b = -1 + j * step;
          for (let i = 0; i < n; i++) {
            const a = -1 + i * step;
            const o = j * (n + 1) + i;
            const avg = (F[o] + F[o + 1] + F[o + n + 1] + F[o + n + 2]) * 0.25;
            if (avg < 0) ctx.rect(a, b, step, step);
          }
        }
        ctx.fill();
      } else {
        ctx.strokeStyle = style;
        ctx.lineWidth = lineW / scale;
        ctx.lineJoin = "round";
        ctx.beginPath();
        for (let j = 0; j < n; j++) {
          const b = -1 + j * step;
          for (let i = 0; i < n; i++) {
            const a = -1 + i * step;
            const o = j * (n + 1) + i;
            const tl = F[o], tr = F[o + 1], br = F[o + n + 2], bl = F[o + n + 1];
            // crossing points on the 4 edges
            const pts: number[] = [];
            if (tl < 0 !== tr < 0) pts.push(a + step * (tl / (tl - tr)), b);
            if (tr < 0 !== br < 0) pts.push(a + step, b + step * (tr / (tr - br)));
            if (bl < 0 !== br < 0) pts.push(a + step * (bl / (bl - br)), b + step);
            if (tl < 0 !== bl < 0) pts.push(a, b + step * (tl / (tl - bl)));
            if (pts.length === 4) {
              ctx.moveTo(pts[0], pts[1]); ctx.lineTo(pts[2], pts[3]);
              ctx.moveTo(pts[4], pts[5]); ctx.lineTo(pts[6], pts[7]);
            } else if (pts.length === 2) {
              ctx.moveTo(pts[0], pts[1]); ctx.lineTo(pts[2], pts[3]);
            }
          }
        }
        ctx.stroke();
      }
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  dispose(): void {
    this.canvas.width = this.canvas.height = 0;
    this.grid = new Float32Array(0);
  }
}

export const slicerLayerType: LayerTypeDefinition = {
  type: "slicer",
  label: "3D Slicer",
  category: "Generators",
  icon: "Layers",
  description: "Slices an implicit 3D object (sphere / torus / gyroid) into rotating rings or planes.",
  defaultSize: (comp) => [comp.width, comp.height],
  schema: [
    { key: "shape", name: "Object", type: "select", default: "torus", group: "Object", meta: { options: [ { label: "Sphere", value: "sphere" }, { label: "Torus", value: "torus" }, { label: "Gyroid", value: "gyroid" } ] } },
    { key: "mode", name: "Mode", type: "select", default: "rings", group: "Object", meta: { options: [ { label: "Rings", value: "rings" }, { label: "Planes", value: "planes" } ] } },
    { key: "slices", name: "Slices", type: "number", default: 22, group: "Object", meta: { min: 2, max: 120, step: 1 } },
    { key: "detail", name: "Detail (perf)", type: "number", default: 36, group: "Object", meta: { min: 8, max: 96, step: 1 } },
    { key: "radius", name: "Size", type: "number", default: 0.7, group: "Object", meta: { min: 0.1, max: 1.2, step: 0.01 } },
    { key: "gyroidFreq", name: "Gyroid Freq", type: "number", default: 2.5, group: "Object", meta: { min: 0.5, max: 8, step: 0.1 } },
    { key: "tilt", name: "Tilt X", type: "angle", default: 62, group: "View", meta: { min: 0, max: 90, step: 1, unit: "°" } },
    { key: "spin", name: "Spin Speed", type: "number", default: 30, group: "View", meta: { min: -360, max: 360, step: 1 } },
    { key: "rotation", name: "Rotation Offset", type: "angle", default: 0, group: "View", meta: { step: 1, unit: "°" } },
    { key: "color", name: "Color (top)", type: "color", default: [192, 252, 4, 255], group: "Look" },
    { key: "colorB", name: "Color (bottom)", type: "color", default: [54, 1, 251, 255], group: "Look" },
    { key: "lineWidth", name: "Line Width", type: "number", default: 1.5, group: "Look", meta: { min: 0.25, max: 12, step: 0.25 } },
    { key: "depthShade", name: "Depth Shade", type: "boolean", default: true, group: "Look" },
  ],
  createRenderer: () => new SlicerRenderer(),
};
