import type { LayerTypeDefinition } from "../../engine/plugins/Registry";
import type { LayerRenderer, RenderFrame } from "../../engine/render/types";

function num(v: unknown, f: number): number {
  return typeof v === "number" ? v : f;
}
function p3(v: unknown, f: [number, number, number]): [number, number, number] {
  if (!Array.isArray(v)) return f;
  return [(v[0] as number) ?? f[0], (v[1] as number) ?? f[1], (v[2] as number) ?? f[2]];
}
function rgba(v: unknown, f = "rgba(192,252,4,1)"): string {
  if (!Array.isArray(v)) return f;
  const [r, g, b, a] = v as number[];
  return `rgba(${r ?? 0},${g ?? 0},${b ?? 0},${(a ?? 255) / 255})`;
}

interface V3 { x: number; y: number; z: number; }

function rotate(x: number, y: number, z: number, ax: number, ay: number, az: number): V3 {
  // X axis
  const cx = Math.cos(ax), sx = Math.sin(ax);
  let ny = y * cx - z * sx;
  let nz = y * sx + z * cx;
  y = ny; z = nz;
  // Y axis
  const cyA = Math.cos(ay), syA = Math.sin(ay);
  let nx = x * cyA + z * syA;
  nz = -x * syA + z * cyA;
  x = nx; z = nz;
  // Z axis
  const cz = Math.cos(az), sz = Math.sin(az);
  nx = x * cz - y * sz;
  ny = x * sz + y * cz;
  return { x: nx, y: ny, z };
}

/**
 * A 3D wire / arrow: a quadratic Bézier from A to B with a third "twist" control point,
 * rendered in 3D (tilt X/Y/Z + time spin) and orthographically projected. The line's
 * completion (0→1) is animatable so it can draw on from A to B; an optional arrowhead
 * sits at the growing tip. Deterministic & seekable (spin comes from the comp clock).
 */
class WireRenderer implements LayerRenderer {
  private canvas = document.createElement("canvas");
  private ctx = this.canvas.getContext("2d")!;
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
      pr.pointA, pr.pointB, pr.control, pr.completion, pr.color, pr.width,
      pr.arrowhead, pr.arrowSize, pr.tiltX, pr.tiltY, pr.tiltZ, pr.resolution, pr.dash,
    ]);
    const drew = this.forceInitial || frame.frame !== this.lastFrame || key !== this.lastKey;
    this.lastFrame = frame.frame;
    this.lastKey = key;
    this.forceInitial = false;
    if (drew) this.draw(frame);
    return this.canvas;
  }

  private draw(frame: RenderFrame): void {
    const ctx = this.ctx;
    const w = this.canvas.width;
    const h = this.canvas.height;
    ctx.clearRect(0, 0, w, h);

    const pr = frame.props;
    const A = p3(pr.pointA, [w * 0.3, h * 0.62, 0]);
    const B = p3(pr.pointB, [w * 0.7, h * 0.4, 0]);
    const C = p3(pr.control, [w * 0.5, h * 0.2, 220]);
    const completion = Math.max(0, Math.min(1, num(pr.completion, 1)));
    const seg = Math.max(2, Math.round(num(pr.resolution, 64)));
    const ax = (num(pr.tiltX, 0) * Math.PI) / 180;
    const ay = ((num(pr.tiltY, 0) + frame.time * num(pr.spin, 0)) * Math.PI) / 180;
    const az = (num(pr.tiltZ, 0) * Math.PI) / 180;
    const cx = w / 2;
    const cy = h / 2;

    const project = (x: number, y: number, z: number) => {
      const r = rotate(x - cx, y - cy, z, ax, ay, az);
      return { x: cx + r.x, y: cy + r.y };
    };
    const bez = (t: number): V3 => {
      const u = 1 - t;
      return {
        x: u * u * A[0] + 2 * u * t * C[0] + t * t * B[0],
        y: u * u * A[1] + 2 * u * t * C[1] + t * t * B[1],
        z: u * u * A[2] + 2 * u * t * C[2] + t * t * B[2],
      };
    };

    if (completion <= 0) return;

    const pts: { x: number; y: number }[] = [];
    for (let i = 0; i <= seg; i++) {
      const t = (i / seg) * completion;
      const b = bez(t);
      pts.push(project(b.x, b.y, b.z));
    }

    ctx.strokeStyle = rgba(pr.color);
    ctx.lineWidth = Math.max(0.25, num(pr.width, 4));
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    const dash = num(pr.dash, 0);
    ctx.setLineDash(dash > 0 ? [dash, dash] : []);
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.stroke();
    ctx.setLineDash([]);

    if (pr.arrowhead !== false && pts.length >= 2) {
      const tip = pts[pts.length - 1];
      const prev = pts[pts.length - 2];
      let dx = tip.x - prev.x, dy = tip.y - prev.y;
      const len = Math.hypot(dx, dy) || 1;
      dx /= len; dy /= len;
      const size = num(pr.arrowSize, 22);
      const ox = -dy, oy = dx;
      ctx.fillStyle = rgba(pr.color);
      ctx.beginPath();
      ctx.moveTo(tip.x, tip.y);
      ctx.lineTo(tip.x - dx * size + ox * size * 0.5, tip.y - dy * size + oy * size * 0.5);
      ctx.lineTo(tip.x - dx * size - ox * size * 0.5, tip.y - dy * size - oy * size * 0.5);
      ctx.closePath();
      ctx.fill();
    }
  }

  dispose(): void {
    this.canvas.width = this.canvas.height = 0;
  }
}

export const wireLayerType: LayerTypeDefinition = {
  type: "wire",
  label: "Wire / Arrow",
  category: "Generators",
  icon: "Spline",
  description: "A 3D quadratic-spline wire from A to B with a twist point; animatable completion + arrowhead.",
  defaultSize: (comp) => [comp.width, comp.height],
  schema: [
    { key: "pointA", name: "Point A", type: "point3", default: [560, 670, 0], group: "Points" },
    { key: "control", name: "Twist (C)", type: "point3", default: [960, 220, 240], group: "Points" },
    { key: "pointB", name: "Point B", type: "point3", default: [1360, 430, 0], group: "Points" },
    { key: "completion", name: "Completion", type: "number", default: 1, group: "Line", meta: { min: 0, max: 1, step: 0.01 } },
    { key: "width", name: "Width", type: "number", default: 5, group: "Line", meta: { min: 0.25, max: 60, step: 0.25 } },
    { key: "dash", name: "Dash", type: "number", default: 0, group: "Line", meta: { min: 0, max: 80, step: 1 } },
    { key: "color", name: "Color", type: "color", default: [192, 252, 4, 255], group: "Line" },
    { key: "arrowhead", name: "Arrowhead", type: "boolean", default: true, group: "Line" },
    { key: "arrowSize", name: "Arrow Size", type: "number", default: 22, group: "Line", meta: { min: 0, max: 200, step: 1 } },
    { key: "resolution", name: "Resolution", type: "number", default: 64, group: "Line", meta: { min: 2, max: 400, step: 1 } },
    { key: "tiltX", name: "Tilt X", type: "angle", default: 0, group: "View", meta: { step: 1, unit: "°" } },
    { key: "tiltY", name: "Tilt Y", type: "angle", default: 0, group: "View", meta: { step: 1, unit: "°" } },
    { key: "tiltZ", name: "Tilt Z", type: "angle", default: 0, group: "View", meta: { step: 1, unit: "°" } },
    { key: "spin", name: "Spin Speed", type: "number", default: 0, group: "View", meta: { min: -360, max: 360, step: 1 } },
  ],
  createRenderer: () => new WireRenderer(),
};
