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

// ---- classic improved Perlin noise (3D), seedable via a shuffled permutation ----
function buildPerm(seed: number): Uint8Array {
  const perm = new Uint8Array(512);
  const base = new Uint8Array(256);
  for (let i = 0; i < 256; i++) base[i] = i;
  const rnd = mulberry32(seed * 2654435761 + 1);
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    const t = base[i];
    base[i] = base[j];
    base[j] = t;
  }
  for (let i = 0; i < 512; i++) perm[i] = base[i & 255];
  return perm;
}
function fade(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10);
}
function grad(hash: number, x: number, y: number, z: number): number {
  const h = hash & 15;
  const u = h < 8 ? x : y;
  const v = h < 4 ? y : h === 12 || h === 14 ? x : z;
  return ((h & 1) === 0 ? u : -u) + ((h & 2) === 0 ? v : -v);
}
function perlin3(p: Uint8Array, x: number, y: number, z: number): number {
  const xf = Math.floor(x), yf = Math.floor(y), zf = Math.floor(z);
  const X = xf & 255, Y = yf & 255, Z = zf & 255;
  x -= xf; y -= yf; z -= zf;
  const u = fade(x), v = fade(y), w = fade(z);
  const A = p[X] + Y, AA = p[A] + Z, AB = p[A + 1] + Z;
  const B = p[X + 1] + Y, BA = p[B] + Z, BB = p[B + 1] + Z;
  const l = (a: number, b: number, t: number) => a + t * (b - a);
  return l(
    l(l(grad(p[AA], x, y, z), grad(p[BA], x - 1, y, z), u), l(grad(p[AB], x, y - 1, z), grad(p[BB], x - 1, y - 1, z), u), v),
    l(l(grad(p[AA + 1], x, y, z - 1), grad(p[BA + 1], x - 1, y, z - 1), u), l(grad(p[AB + 1], x, y - 1, z - 1), grad(p[BB + 1], x - 1, y - 1, z - 1), u), v),
    w,
  );
}

const LOW = [10, 10, 12, 0];
const HIGH = [192, 252, 4, 255];

/**
 * Procedural fBm noise field, rendered into a downsampled buffer (`detail`) and upscaled. 3D Perlin,
 * so the third axis is time — it evolves smoothly and is deterministic. Optional banding gives a
 * topographic look.
 */
export class NoiseLayer extends Plugin {
  detail = this.number({ min: 0.05, max: 1, default: 0.25 });
  scale = this.number({ min: 1, max: 12, default: 3 });
  persistence = this.number({ min: 0.1, max: 0.9, default: 0.5 });
  lacunarity = this.number({ min: 1, max: 4, default: 2 });
  contrast = this.number({ min: 0.2, max: 4, default: 1 });
  bands = this.number({ min: 0, max: 16, step: 1, default: 0 });
  speed = this.number({ min: 0, max: 1.5, default: 0.3 });
  seed = this.number({ min: 1, max: 64, step: 1, default: 1 });

  private ctx = this.canvas.getContext("2d")!;
  private buf = document.createElement("canvas");
  private bctx = this.buf.getContext("2d")!;
  private image?: ImageData;
  private perm = buildPerm(1);
  private permSeed = 1;

  render(f: Frame): HTMLCanvasElement {
    const w = this.canvas.width, h = this.canvas.height;

    const seed = Math.round(this.seed.value);
    if (seed !== this.permSeed) {
      this.perm = buildPerm(seed);
      this.permSeed = seed;
    }

    const detail = Math.max(0.05, Math.min(1, this.detail.value));
    const rw = Math.max(2, Math.round(w * detail));
    const rh = Math.max(2, Math.round(h * detail));
    if (this.buf.width !== rw || this.buf.height !== rh || !this.image) {
      this.buf.width = rw;
      this.buf.height = rh;
      this.image = this.bctx.createImageData(rw, rh);
    }

    const scale = this.scale.value;
    const octaves = 1;
    const gain = this.persistence.value;
    const lac = this.lacunarity.value;
    const contrast = this.contrast.value;
    const bands = Math.max(0, Math.round(this.bands.value));
    const z = f.time * this.speed.value;
    const aspect = w / h;
    const perm = this.perm;
    const data = this.image.data;

    let idx = 0;
    for (let y = 0; y < rh; y++) {
      const ny = (y / rh) * scale;
      for (let x = 0; x < rw; x++) {
        const nx = (x / rw) * scale * aspect;
        let amp = 0.5, freq = 1, sum = 0, norm = 0;
        for (let o = 0; o < octaves; o++) {
          sum += amp * perlin3(perm, nx * freq, ny * freq, z * freq);
          norm += amp;
          amp *= gain;
          freq *= lac;
        }
        let t = sum / (norm || 1);
        t = t * 0.5 + 0.5;
        t = (t - 0.5) * contrast + 0.5;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        if (bands > 0) t = Math.round(t * bands) / bands;
        data[idx++] = LOW[0] + (HIGH[0] - LOW[0]) * t;
        data[idx++] = LOW[1] + (HIGH[1] - LOW[1]) * t;
        data[idx++] = LOW[2] + (HIGH[2] - LOW[2]) * t;
        data[idx++] = LOW[3] + (HIGH[3] - LOW[3]) * t;
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
