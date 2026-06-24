import type { LayerTypeDefinition } from "../../engine/plugins/Registry";
import type { LayerRenderer, RenderFrame } from "../../engine/render/types";
import { rotateVec } from "../_shared/mesh3d";

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
  const al = ((a[3] + (b[3] - a[3]) * t) / 255) * alphaMul;
  return `rgba(${r},${g},${bl},${al})`;
}

interface SliceGeom {
  y: number;
  loops: number[][]; // each loop: [x0,z0,x1,z1, ...] in object space (x=a, z=b)
}

/** Intersect every triangle with the plane y=yp; return contour segments in (x,z). */
function sliceMesh(tris: number[], yp: number): number[] {
  const segs: number[] = [];
  for (let i = 0; i < tris.length; i += 9) {
    const xs = [tris[i], tris[i + 3], tris[i + 6]];
    const ys = [tris[i + 1], tris[i + 4], tris[i + 7]];
    const zs = [tris[i + 2], tris[i + 5], tris[i + 8]];
    const pts: number[] = [];
    for (let e = 0; e < 3; e++) {
      const a = e, b = (e + 1) % 3;
      const ya = ys[a], yb = ys[b];
      if ((ya <= yp && yb > yp) || (yb <= yp && ya > yp)) {
        const tt = (yp - ya) / (yb - ya);
        pts.push(xs[a] + (xs[b] - xs[a]) * tt, zs[a] + (zs[b] - zs[a]) * tt);
      }
    }
    if (pts.length >= 4) segs.push(pts[0], pts[1], pts[2], pts[3]);
  }
  return segs;
}

/** Stitch unordered segments into polyline loops so rings are continuous and planes fillable. */
function linkContours(segs: number[], eps = 2e-3): number[][] {
  const n = segs.length / 4;
  if (!n) return [];
  const key = (x: number, y: number) => `${Math.round(x / eps)},${Math.round(y / eps)}`;
  const edges: number[][] = [];
  for (let i = 0; i < n; i++) edges.push([segs[i * 4], segs[i * 4 + 1], segs[i * 4 + 2], segs[i * 4 + 3]]);
  const used = new Array(n).fill(false);
  const pmap = new Map<string, number[]>();
  const addP = (k: string, i: number) => {
    let a = pmap.get(k);
    if (!a) { a = []; pmap.set(k, a); }
    a.push(i);
  };
  edges.forEach((e, i) => { addP(key(e[0], e[1]), i); addP(key(e[2], e[3]), i); });

  const loops: number[][] = [];
  for (let i = 0; i < n; i++) {
    if (used[i]) continue;
    used[i] = true;
    const loop = [edges[i][0], edges[i][1], edges[i][2], edges[i][3]];
    let cx = edges[i][2], cy = edges[i][3];
    const startK = key(edges[i][0], edges[i][1]);
    for (let guard = 0; guard < n; guard++) {
      const cand = pmap.get(key(cx, cy));
      if (!cand) break;
      let next = -1, nx = 0, ny = 0;
      for (const j of cand) {
        if (used[j]) continue;
        const e = edges[j];
        if (key(e[0], e[1]) === key(cx, cy)) { next = j; nx = e[2]; ny = e[3]; break; }
        if (key(e[2], e[3]) === key(cx, cy)) { next = j; nx = e[0]; ny = e[1]; break; }
      }
      if (next < 0) break;
      used[next] = true;
      loop.push(nx, ny);
      cx = nx; cy = ny;
      if (key(cx, cy) === startK) break;
    }
    loops.push(loop);
  }
  return loops;
}

/**
 * Slices the 3D object on the layer DIRECTLY BELOW it (a Shape, Model or Landscape — any
 * `meshSource`) into a stack of cross-sections, drawn as rotating rings or filled planes.
 * No shapes are built in here anymore — the slicer only slices whatever sits beneath it.
 * Slice geometry is cached (keyed by the source) so spin only re-projects.
 */
class SlicerRenderer implements LayerRenderer {
  private canvas = document.createElement("canvas");
  private ctx = this.canvas.getContext("2d")!;
  private geom: SliceGeom[] = [];
  private geomKey = "";
  private projKey = "";
  private lastFrame = -1;
  private forceInitial = true;

  resize(w: number, h: number): void {
    this.canvas.width = Math.max(1, Math.round(w));
    this.canvas.height = Math.max(1, Math.round(h));
  }

  render(frame: RenderFrame): HTMLCanvasElement {
    if (this.canvas.width !== frame.width || this.canvas.height !== frame.height) this.resize(frame.width, frame.height);
    const pr = frame.props;
    const slices = Math.max(2, Math.min(200, Math.round(num(pr.slices, 28))));
    const below = frame.below;
    const hasMesh = !!below?.mesh;
    const geomKey = [hasMesh ? below!.key ?? "mesh" : "none", slices].join("|");
    if (geomKey !== this.geomKey) {
      const mesh = below?.mesh?.();
      this.buildGeom(mesh?.tris, slices);
      this.geomKey = geomKey;
    }

    const projKey = JSON.stringify([pr.mode, pr.radius, pr.tiltX, pr.tiltY, pr.tiltZ, pr.rotation, pr.color, pr.colorB, pr.lineWidth, pr.depthShade]);
    const drew = this.forceInitial || frame.frame !== this.lastFrame || projKey !== this.projKey || geomKey !== this.geomKey;
    this.projKey = projKey;
    this.lastFrame = frame.frame;
    this.forceInitial = false;
    if (drew) this.draw(frame, slices, hasMesh);
    return this.canvas;
  }

  private buildGeom(tris: number[] | undefined, slices: number): void {
    this.geom = [];
    if (!tris || !tris.length) return;
    for (let s = 0; s < slices; s++) {
      const y = -1 + (2 * s) / (slices - 1);
      this.geom.push({ y, loops: linkContours(sliceMesh(tris, y)) });
    }
  }

  private draw(frame: RenderFrame, slices: number, hasMesh: boolean): void {
    const pr = frame.props;
    const ctx = this.ctx;
    const w = this.canvas.width, h = this.canvas.height;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, w, h);

    if (!hasMesh || !this.geom.length) {
      ctx.fillStyle = "rgba(140,140,140,0.5)";
      ctx.font = "500 24px ui-sans-serif, system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("Place a 3D layer (Shape / Model / Landscape) directly below to slice it", w / 2, h / 2);
      return;
    }

    const mode = pr.mode === "planes" ? "planes" : "rings";
    const radius = num(pr.radius, 0.8);
    const ax = (num(pr.tiltX, 62) * Math.PI) / 180;
    const ay = ((num(pr.tiltY, 0) + num(pr.rotation, 0) + frame.time * num(pr.spin, 30)) * Math.PI) / 180;
    const az = (num(pr.tiltZ, 0) * Math.PI) / 180;
    const lineW = num(pr.lineWidth, 1.5);
    const depthShade = pr.depthShade !== false;
    const colA = arr(pr.color, [192, 252, 4, 255]);
    const colB = arr(pr.colorB, [54, 1, 251, 255]);

    const ex = rotateVec(1, 0, 0, ax, ay, az);
    const ey = rotateVec(0, 1, 0, ax, ay, az);
    const ez = rotateVec(0, 0, 1, ax, ay, az);
    const scale = radius * Math.min(w, h) * 0.5;
    const cx = w / 2, cy = h / 2;

    const order = this.geom.map((_, i) => i).sort((a, b) => this.geom[a].y * ey[2] - this.geom[b].y * ey[2]);

    for (const idx of order) {
      const g = this.geom[idx];
      ctx.setTransform(ex[0] * scale, ex[1] * scale, ez[0] * scale, ez[1] * scale, cx + ey[0] * g.y * scale, cy + ey[1] * g.y * scale);
      const t = slices > 1 ? idx / (slices - 1) : 0;
      const shade = depthShade ? 0.45 + 0.55 * (0.5 + 0.5 * g.y * ey[2]) : 1;
      const style = lerpC(colA, colB, t, Math.max(0, Math.min(1, shade)));

      ctx.beginPath();
      for (const loop of g.loops) {
        ctx.moveTo(loop[0], loop[1]);
        for (let k = 2; k < loop.length; k += 2) ctx.lineTo(loop[k], loop[k + 1]);
      }
      if (mode === "planes") {
        ctx.fillStyle = style;
        ctx.fill("evenodd");
      } else {
        ctx.strokeStyle = style;
        ctx.lineWidth = lineW / scale;
        ctx.lineJoin = "round";
        ctx.stroke();
      }
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  dispose(): void {
    this.canvas.width = this.canvas.height = 0;
    this.geom = [];
  }
}

export const slicerLayerType: LayerTypeDefinition = {
  type: "slicer",
  label: "3D Slicer",
  category: "3D",
  icon: "Layers",
  description: "Slices the 3D object directly below it (Shape / Model / Landscape) into rings or planes.",
  defaultSize: (comp) => [comp.width, comp.height],
  schema: [
    { key: "mode", name: "Mode", type: "select", default: "rings", group: "Slice", meta: { options: [ { label: "Rings", value: "rings" }, { label: "Planes", value: "planes" } ] } },
    { key: "slices", name: "Slices", type: "number", default: 28, group: "Slice", meta: { min: 2, max: 200, step: 1 } },
    { key: "radius", name: "Size", type: "number", default: 0.8, group: "Slice", meta: { min: 0.1, max: 1.6, step: 0.01 } },
    { key: "tiltX", name: "Tilt X", type: "angle", default: 62, group: "View", meta: { step: 1, unit: "°" } },
    { key: "tiltY", name: "Tilt Y", type: "angle", default: 0, group: "View", meta: { step: 1, unit: "°" } },
    { key: "tiltZ", name: "Tilt Z", type: "angle", default: 0, group: "View", meta: { step: 1, unit: "°" } },
    { key: "spin", name: "Spin Speed", type: "number", default: 30, group: "View", meta: { min: -360, max: 360, step: 1 } },
    { key: "rotation", name: "Y Offset", type: "angle", default: 0, group: "View", meta: { step: 1, unit: "°" } },
    { key: "color", name: "Color (top)", type: "color", default: [192, 252, 4, 255], group: "Look" },
    { key: "colorB", name: "Color (bottom)", type: "color", default: [54, 1, 251, 255], group: "Look" },
    { key: "lineWidth", name: "Line Width", type: "number", default: 1.5, group: "Look", meta: { min: 0.25, max: 12, step: 0.25 } },
    { key: "depthShade", name: "Depth Shade", type: "boolean", default: true, group: "Look" },
  ],
  createRenderer: () => new SlicerRenderer(),
};
