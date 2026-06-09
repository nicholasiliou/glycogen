import { normalizeTris } from "../slicer/meshLoader";

/** Shared 3D helpers: parametric shape generators + an orthographic wireframe/filled
 * renderer. Geometry is a flat array of triangle vertices (9 numbers per triangle),
 * normalised to roughly [-1,1]. Shape, Model and Landscape layers all build on this. */

export function rotateVec(x: number, y: number, z: number, ax: number, ay: number, az: number): [number, number, number] {
  const cx = Math.cos(ax), sx = Math.sin(ax);
  let ny = y * cx - z * sx, nz = y * sx + z * cx;
  y = ny; z = nz;
  const cy = Math.cos(ay), sy = Math.sin(ay);
  let nx = x * cy + z * sy;
  nz = -x * sy + z * cy;
  x = nx; z = nz;
  const cz = Math.cos(az), sz = Math.sin(az);
  nx = x * cz - y * sz;
  ny = x * sz + y * cz;
  return [nx, ny, z];
}

export interface Mesh3DStyle {
  w: number;
  h: number;
  scale: number;
  ax: number;
  ay: number;
  az: number;
  style: "wire" | "filled";
  color: number[];
  colorB: number[];
  lineWidth: number;
  depthShade: boolean;
  cull: boolean;
}

function rgba(c: number[], a = 1): string {
  return `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${((c[3] ?? 255) / 255) * a})`;
}

export function drawMesh3D(ctx: CanvasRenderingContext2D, tris: number[], o: Mesh3DStyle): void {
  const cx = o.w / 2;
  const cy = o.h / 2;
  const items: { p: number[]; depth: number; t: number; shade: number }[] = [];

  for (let i = 0; i < tris.length; i += 9) {
    const sxy: number[] = [];
    let depth = 0;
    let avgY = 0;
    let normalZ = 0;
    for (let v = 0; v < 3; v++) {
      const [rx, ry, rz] = rotateVec(tris[i + v * 3], tris[i + v * 3 + 1], tris[i + v * 3 + 2], o.ax, o.ay, o.az);
      sxy.push(cx + rx * o.scale, cy + ry * o.scale);
      depth += rz;
      avgY += tris[i + v * 3 + 1];
    }
    // screen-space winding for backface cull / fake lighting
    normalZ = (sxy[2] - sxy[0]) * (sxy[5] - sxy[1]) - (sxy[3] - sxy[1]) * (sxy[4] - sxy[0]);
    if (o.cull && normalZ < 0) continue;
    items.push({ p: sxy, depth: depth / 3, t: (avgY / 3 + 1) / 2, shade: normalZ });
  }

  if (o.style === "filled") {
    items.sort((a, b) => a.depth - b.depth); // far first
    const maxN = items.reduce((m, it) => Math.max(m, Math.abs(it.shade)), 1);
    for (const it of items) {
      const light = o.depthShade ? 0.35 + 0.65 * Math.min(1, Math.abs(it.shade) / maxN) : 1;
      const c = [
        o.color[0] + (o.colorB[0] - o.color[0]) * it.t,
        o.color[1] + (o.colorB[1] - o.color[1]) * it.t,
        o.color[2] + (o.colorB[2] - o.color[2]) * it.t,
        o.color[3] ?? 255,
      ];
      ctx.fillStyle = rgba(c, light);
      ctx.beginPath();
      ctx.moveTo(it.p[0], it.p[1]);
      ctx.lineTo(it.p[2], it.p[3]);
      ctx.lineTo(it.p[4], it.p[5]);
      ctx.closePath();
      ctx.fill();
    }
  } else {
    ctx.strokeStyle = rgba(o.color);
    ctx.lineWidth = o.lineWidth;
    ctx.lineJoin = "round";
    ctx.beginPath();
    for (const it of items) {
      ctx.moveTo(it.p[0], it.p[1]);
      ctx.lineTo(it.p[2], it.p[3]);
      ctx.lineTo(it.p[4], it.p[5]);
      ctx.closePath();
    }
    ctx.stroke();
  }
}

// ───────────────────────── parametric generators ─────────────────────────

function pushQuad(t: number[], a: number[], b: number[], c: number[], d: number[]): void {
  t.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
  t.push(a[0], a[1], a[2], c[0], c[1], c[2], d[0], d[1], d[2]);
}

export function sphereMesh(seg = 24): number[] {
  const t: number[] = [];
  const vert = (u: number, v: number) => {
    const phi = u * Math.PI, theta = v * 2 * Math.PI;
    return [Math.sin(phi) * Math.cos(theta), Math.cos(phi), Math.sin(phi) * Math.sin(theta)];
  };
  for (let i = 0; i < seg; i++)
    for (let j = 0; j < seg; j++)
      pushQuad(t, vert(i / seg, j / seg), vert((i + 1) / seg, j / seg), vert((i + 1) / seg, (j + 1) / seg), vert(i / seg, (j + 1) / seg));
  return normalizeTris(t);
}

export function torusMesh(R = 0.62, r = 0.28, seg = 28): number[] {
  const t: number[] = [];
  const vert = (u: number, v: number) => {
    const a = u * 2 * Math.PI, b = v * 2 * Math.PI;
    return [(R + r * Math.cos(b)) * Math.cos(a), r * Math.sin(b), (R + r * Math.cos(b)) * Math.sin(a)];
  };
  for (let i = 0; i < seg; i++)
    for (let j = 0; j < seg; j++)
      pushQuad(t, vert(i / seg, j / seg), vert((i + 1) / seg, j / seg), vert((i + 1) / seg, (j + 1) / seg), vert(i / seg, (j + 1) / seg));
  return normalizeTris(t);
}

export function boxMesh(): number[] {
  const c = 0.85;
  const v = [
    [-c, -c, -c], [c, -c, -c], [c, c, -c], [-c, c, -c],
    [-c, -c, c], [c, -c, c], [c, c, c], [-c, c, c],
  ];
  const t: number[] = [];
  const q = (a: number, b: number, d: number, e: number) => pushQuad(t, v[a], v[b], v[d], v[e]);
  q(0, 1, 2, 3); q(5, 4, 7, 6); q(4, 5, 1, 0); q(3, 2, 6, 7); q(1, 5, 6, 2); q(4, 0, 3, 7);
  return t;
}

export function cylinderMesh(seg = 28): number[] {
  const t: number[] = [];
  const ring = (y: number, a: number) => [Math.cos(a), y, Math.sin(a)];
  for (let i = 0; i < seg; i++) {
    const a0 = (i / seg) * 2 * Math.PI, a1 = ((i + 1) / seg) * 2 * Math.PI;
    pushQuad(t, ring(-1, a0), ring(-1, a1), ring(1, a1), ring(1, a0));
    t.push(0, -1, 0, ...ring(-1, a1), ...ring(-1, a0));
    t.push(0, 1, 0, ...ring(1, a0), ...ring(1, a1));
  }
  return normalizeTris(t);
}

export function coneMesh(seg = 28): number[] {
  const t: number[] = [];
  const ring = (a: number) => [Math.cos(a), -1, Math.sin(a)];
  for (let i = 0; i < seg; i++) {
    const a0 = (i / seg) * 2 * Math.PI, a1 = ((i + 1) / seg) * 2 * Math.PI;
    t.push(0, 1, 0, ...ring(a0), ...ring(a1));
    t.push(0, -1, 0, ...ring(a1), ...ring(a0));
  }
  return normalizeTris(t);
}

export function torusKnotMesh(p = 2, q = 3, seg = 160, tubeSeg = 12, tube = 0.18): number[] {
  const curve = (s: number) => {
    const a = s * 2 * Math.PI;
    const r = Math.cos(q * a) + 2;
    return [r * Math.cos(p * a), r * Math.sin(p * a), -Math.sin(q * a)];
  };
  const t: number[] = [];
  const ringAt = (s: number) => {
    const c = curve(s);
    const c2 = curve(s + 1e-3);
    const tan = [c2[0] - c[0], c2[1] - c[1], c2[2] - c[2]];
    const tl = Math.hypot(tan[0], tan[1], tan[2]) || 1;
    const T = [tan[0] / tl, tan[1] / tl, tan[2] / tl];
    // arbitrary normal
    let N = [T[1], -T[0], 0];
    const nl = Math.hypot(N[0], N[1], N[2]) || 1;
    N = [N[0] / nl, N[1] / nl, N[2] / nl];
    const B = [T[1] * N[2] - T[2] * N[1], T[2] * N[0] - T[0] * N[2], T[0] * N[1] - T[1] * N[0]];
    const ring: number[][] = [];
    for (let j = 0; j <= tubeSeg; j++) {
      const a = (j / tubeSeg) * 2 * Math.PI;
      ring.push([
        c[0] + tube * (Math.cos(a) * N[0] + Math.sin(a) * B[0]),
        c[1] + tube * (Math.cos(a) * N[1] + Math.sin(a) * B[1]),
        c[2] + tube * (Math.cos(a) * N[2] + Math.sin(a) * B[2]),
      ]);
    }
    return ring;
  };
  for (let i = 0; i < seg; i++) {
    const r0 = ringAt(i / seg), r1 = ringAt((i + 1) / seg);
    for (let j = 0; j < tubeSeg; j++) pushQuad(t, r0[j], r0[j + 1], r1[j + 1], r1[j]);
  }
  return normalizeTris(t);
}

export function supershapeMesh(m = 6, n1 = 0.4, n2 = 1, n3 = 1, seg = 56): number[] {
  const sf = (ang: number) => {
    const t1 = Math.pow(Math.abs(Math.cos((m * ang) / 4)), n2);
    const t2 = Math.pow(Math.abs(Math.sin((m * ang) / 4)), n3);
    return Math.pow(t1 + t2, -1 / n1);
  };
  const vert = (u: number, v: number) => {
    const theta = -Math.PI / 2 + u * Math.PI;
    const phi = -Math.PI + v * 2 * Math.PI;
    const r1 = sf(theta), r2 = sf(phi);
    return [r2 * Math.cos(phi) * r1 * Math.cos(theta), r1 * Math.sin(theta), r2 * Math.sin(phi) * r1 * Math.cos(theta)];
  };
  const t: number[] = [];
  for (let i = 0; i < seg; i++)
    for (let j = 0; j < seg; j++)
      pushQuad(t, vert(i / seg, j / seg), vert((i + 1) / seg, j / seg), vert((i + 1) / seg, (j + 1) / seg), vert(i / seg, (j + 1) / seg));
  return normalizeTris(t);
}
