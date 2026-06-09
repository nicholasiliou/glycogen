import type { LayerTypeDefinition } from "../../engine/plugins/Registry";
import type { LayerRenderer, RenderFrame } from "../../engine/render/types";
import type { PropertyValue } from "../../engine/core/types";
import { drawMesh3D } from "../_shared/mesh3d";

function num(v: unknown, f: number): number {
  return typeof v === "number" ? v : f;
}
function arr(v: unknown, f: number[]): number[] {
  return Array.isArray(v) ? (v as number[]) : f;
}
// compact internal value noise (used when there is no noise layer below)
function hash3(x: number, y: number, z: number): number {
  let n = (x * 374761393 + y * 668265263 + z * 1274126177) | 0;
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296 - 0.5;
}
function vnoise(x: number, y: number, z: number): number {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const xf = x - xi, yf = y - yi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf), w = zf * zf * (3 - 2 * zf);
  const L = (a: number, b: number, t: number) => a + (b - a) * t;
  const c = (a: number, b: number, d: number) => hash3(xi + a, yi + b, zi + d);
  return 2 * L(L(L(c(0, 0, 0), c(1, 0, 0), u), L(c(0, 1, 0), c(1, 1, 0), u), v), L(L(c(0, 0, 1), c(1, 0, 1), u), L(c(0, 1, 1), c(1, 1, 1), u), v), w);
}

function buildTerrain(
  field: ((u: number, v: number, w: number) => number) | undefined,
  N: number,
  amp: number,
  scaleN: number,
  time: number,
  octaves: number,
  terrace: number,
): number[] {
  const H = new Float32Array((N + 1) * (N + 1));
  const sample = (u: number, v: number) => {
    if (field) return field(u, v, time);
    let s = 0, a = 0.5, f = 1;
    for (let o = 0; o < octaves; o++) {
      s += a * vnoise(u * scaleN * f, v * scaleN * f, time);
      a *= 0.5;
      f *= 2;
    }
    return s;
  };
  for (let j = 0; j <= N; j++) {
    for (let i = 0; i <= N; i++) {
      let n = sample(i / N, j / N);
      if (terrace > 1) n = Math.round(n * terrace) / terrace;
      H[j * (N + 1) + i] = n;
    }
  }
  const tris: number[] = [];
  const vert = (i: number, j: number) => [-1 + (2 * i) / N, H[j * (N + 1) + i] * amp, -1 + (2 * j) / N];
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const a = vert(i, j), b = vert(i + 1, j), c = vert(i + 1, j + 1), d = vert(i, j + 1);
      tris.push(...a, ...b, ...c, ...a, ...c, ...d);
    }
  }
  return tris;
}

/**
 * A procedurally generated 3D landscape: a heightfield meshed from a noise field. If a
 * Noise layer sits directly below, it feeds off that (no duplicated noise config);
 * otherwise it uses its own internal noise. Renders as a rotating wireframe/filled
 * terrain and exposes its mesh, so a Slicer above can slice the landscape too.
 */
class LandscapeRenderer implements LayerRenderer {
  private canvas = document.createElement("canvas");
  private ctx = this.canvas.getContext("2d")!;
  private tris: number[] = [];
  private builtKey = "";
  private lastFrame = -1;
  private projKey = "";
  private forceInitial = true;

  resize(w: number, h: number): void {
    this.canvas.width = Math.max(1, Math.round(w));
    this.canvas.height = Math.max(1, Math.round(h));
  }

  private rebuild(props: Record<string, PropertyValue>, time: number, below?: RenderFrame["below"]): void {
    const N = Math.max(8, Math.min(120, Math.round(num(props.resolution, 40))));
    const amp = num(props.amplitude, 0.55);
    const scaleN = num(props.scale, 4);
    const octaves = Math.max(1, Math.round(num(props.octaves, 4)));
    const speed = num(props.speed, 0.15);
    const terrace = Math.round(num(props.terrace, 0));
    const field = below?.field;
    const key = [below?.key ?? "internal", N, amp, scaleN, octaves, terrace, Math.round(time * speed * 100)].join("|");
    if (key === this.builtKey) return;
    this.tris = buildTerrain(field, N, amp, scaleN, time * speed, octaves, terrace);
    this.builtKey = key;
  }

  render(frame: RenderFrame): HTMLCanvasElement {
    if (this.canvas.width !== frame.width || this.canvas.height !== frame.height) this.resize(frame.width, frame.height);
    const pr = frame.props;
    this.rebuild(pr, frame.time, frame.below);
    const projKey = JSON.stringify([this.builtKey, pr.style, pr.radius, pr.tiltX, pr.tiltY, pr.tiltZ, pr.color, pr.colorB, pr.lineWidth, pr.depthShade]);
    const drew = this.forceInitial || frame.frame !== this.lastFrame || projKey !== this.projKey;
    this.projKey = projKey;
    this.lastFrame = frame.frame;
    this.forceInitial = false;
    if (!drew) return this.canvas;

    const w = this.canvas.width, h = this.canvas.height;
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.clearRect(0, 0, w, h);
    drawMesh3D(this.ctx, this.tris, {
      w, h,
      scale: num(pr.radius, 0.8) * Math.min(w, h) * 0.5,
      ax: (num(pr.tiltX, 58) * Math.PI) / 180,
      ay: ((num(pr.tiltY, 0) + frame.time * num(pr.spin, 8)) * Math.PI) / 180,
      az: (num(pr.tiltZ, 0) * Math.PI) / 180,
      style: pr.style === "filled" ? "filled" : "wire",
      color: arr(pr.color, [192, 252, 4, 255]),
      colorB: arr(pr.colorB, [54, 1, 251, 255]),
      lineWidth: num(pr.lineWidth, 1),
      depthShade: pr.depthShade !== false,
      cull: false,
    });
    return this.canvas;
  }

  meshSource(props: Record<string, PropertyValue>, time: number): { tris: number[] } {
    if (!this.tris.length) this.rebuild(props, time, undefined);
    return { tris: this.tris };
  }
  sourceKey(): string {
    return this.builtKey || "landscape";
  }

  dispose(): void {
    this.canvas.width = this.canvas.height = 0;
    this.tris = [];
  }
}

export const landscapeLayerType: LayerTypeDefinition = {
  type: "landscape",
  label: "Landscape",
  category: "3D",
  icon: "Mountain",
  description: "Procedural 3D terrain from a noise field (feeds off a Noise layer below). Sliceable.",
  defaultSize: (comp) => [comp.width, comp.height],
  schema: [
    { key: "amplitude", name: "Height", type: "number", default: 0.55, group: "Terrain", meta: { min: 0, max: 1.2, step: 0.01 } },
    { key: "scale", name: "Noise Scale", type: "number", default: 4, group: "Terrain", meta: { min: 0.5, max: 20, step: 0.1 } },
    { key: "octaves", name: "Octaves", type: "number", default: 4, group: "Terrain", animatable: false, meta: { min: 1, max: 7, step: 1 } },
    { key: "terrace", name: "Terrace (0=off)", type: "number", default: 0, group: "Terrain", meta: { min: 0, max: 16, step: 1 } },
    { key: "resolution", name: "Resolution", type: "number", default: 40, group: "Terrain", animatable: false, meta: { min: 8, max: 120, step: 1 } },
    { key: "speed", name: "Drift Speed", type: "number", default: 0.15, group: "Terrain", meta: { min: -3, max: 3, step: 0.05 } },
    { key: "radius", name: "Size", type: "number", default: 0.85, group: "View", meta: { min: 0.1, max: 1.6, step: 0.01 } },
    { key: "tiltX", name: "Tilt X", type: "angle", default: 58, group: "View", meta: { step: 1, unit: "°" } },
    { key: "tiltY", name: "Tilt Y", type: "angle", default: 0, group: "View", meta: { step: 1, unit: "°" } },
    { key: "tiltZ", name: "Tilt Z", type: "angle", default: 0, group: "View", meta: { step: 1, unit: "°" } },
    { key: "spin", name: "Spin Speed", type: "number", default: 8, group: "View", meta: { min: -360, max: 360, step: 1 } },
    { key: "style", name: "Style", type: "select", default: "wire", group: "Look", meta: { options: [ { label: "Wireframe", value: "wire" }, { label: "Filled", value: "filled" } ] } },
    { key: "color", name: "Color (peaks)", type: "color", default: [192, 252, 4, 255], group: "Look" },
    { key: "colorB", name: "Color (valleys)", type: "color", default: [54, 1, 251, 255], group: "Look" },
    { key: "lineWidth", name: "Line Width", type: "number", default: 1, group: "Look", meta: { min: 0.25, max: 8, step: 0.25 } },
    { key: "depthShade", name: "Depth Shade", type: "boolean", default: true, group: "Look" },
  ],
  createRenderer: () => new LandscapeRenderer(),
};
