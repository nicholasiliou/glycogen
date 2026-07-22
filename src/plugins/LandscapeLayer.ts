import { Plugin, type Frame } from "./Plugin";
import { drawMesh3D } from "./_shared/mesh3d";

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

function buildTerrain(N: number, amp: number, scaleN: number, time: number, octaves: number, terrace: number): number[] {
  const H = new Float32Array((N + 1) * (N + 1));
  const sample = (u: number, v: number) => {
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

/** A procedurally generated 3D landscape: a noise heightfield meshed and drawn as a rotating terrain. */
export class LandscapeLayer extends Plugin {
  resolution = this.number({ min: 8, max: 48, step: 1, default: 40 });
  amplitude = this.number({ min: 0, max: 1.5, default: 0.55 });
  scale = this.number({ min: 1, max: 12, default: 4 });
  octaves = this.number({ min: 1, max: 6, step: 1, default: 4 });
  terrace = this.number({ min: 0, max: 12, step: 1, default: 0 });
  radius = this.number({ min: 0.1, max: 1.4, default: 0.8 });
  lineWidth = this.number({ min: 0.25, max: 8, default: 1 });
  speed = this.number({ min: 0, max: 1, default: 0.15 });
  tiltX = this.number({ min: -180, max: 180, default: 58 });
  tiltY = this.number({ min: -180, max: 180, default: 0 });
  tiltZ = this.number({ min: -180, max: 180, default: 0 });
  spin = this.number({ min: -360, max: 360, default: 8 });
  filled = this.toggle();
  depthShade = this.toggle(true);

  private ctx = this.canvas.getContext("2d")!;
  private tris: number[] = [];
  private builtKey = "";

  constructor() {
    super();
  }

  render(f: Frame): HTMLCanvasElement {
    const N = Math.max(8, Math.min(48, Math.round(this.resolution.value)));
    const octaves = Math.max(1, Math.round(this.octaves.value));
    const terrace = Math.round(this.terrace.value);
    const t = f.time * this.speed.value;
    const key = [N, this.amplitude.value, this.scale.value, octaves, terrace, Math.round(t * 100)].join("|");
    if (key !== this.builtKey) {
      this.tris = buildTerrain(N, this.amplitude.value, this.scale.value, t, octaves, terrace);
      this.builtKey = key;
    }

    const w = this.canvas.width, h = this.canvas.height;
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.clearRect(0, 0, w, h);
    drawMesh3D(this.ctx, this.tris, {
      w, h,
      scale: this.radius.value * Math.min(w, h) * 0.5,
      ax: (this.tiltX.value * Math.PI) / 180,
      ay: ((this.tiltY.value + f.time * this.spin.value) * Math.PI) / 180,
      az: (this.tiltZ.value * Math.PI) / 180,
      style: this.filled.on ? "filled" : "wire",
      color: [192, 252, 4, 255],
      colorB: [54, 1, 251, 255],
      lineWidth: this.lineWidth.value,
      depthShade: this.depthShade.on,
      cull: false,
    });
    return this.canvas;
  }

  dispose(): void {
    super.dispose();
    this.tris = [];
  }
}
