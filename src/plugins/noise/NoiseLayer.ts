import type { LayerTypeDefinition } from "../../engine/plugins/Registry";
import type { LayerRenderer, RenderFrame } from "../../engine/render/types";

function num(v: unknown, f: number): number {
  return typeof v === "number" ? v : f;
}
function arr(v: unknown, f: number[]): number[] {
  return Array.isArray(v) ? (v as number[]) : f;
}
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

function fbm(perm: Uint8Array, x: number, y: number, z: number, oct: number, gain: number, lac: number): number {
  let amp = 0.5, freq = 1, sum = 0, norm = 0;
  for (let o = 0; o < oct; o++) {
    sum += amp * perlin3(perm, x * freq, y * freq, z * freq);
    norm += amp;
    amp *= gain;
    freq *= lac;
  }
  return sum / (norm || 1);
}

/**
 * Procedural fBm noise field. Heavy per-pixel work is kept cheap by rendering into a
 * downsampled buffer (the `detail` control) and letting the GPU upscale it — the usual
 * way to make a full-frame noise field affordable. 3D Perlin means the third axis is
 * time, so it evolves smoothly and is fully deterministic/seekable. Optional banding
 * gives a topographic / contour look.
 */
class NoiseRenderer implements LayerRenderer {
  private canvas = document.createElement("canvas");
  private ctx = this.canvas.getContext("2d")!;
  private buf = document.createElement("canvas");
  private bctx = this.buf.getContext("2d")!;
  private image?: ImageData;
  private perm = buildPerm(1);
  private permSeed = 1;

  resize(w: number, h: number): void {
    this.canvas.width = Math.max(1, Math.round(w));
    this.canvas.height = Math.max(1, Math.round(h));
  }

  render(frame: RenderFrame): HTMLCanvasElement {
    if (this.canvas.width !== frame.width || this.canvas.height !== frame.height) {
      this.resize(frame.width, frame.height);
    }
    const w = this.canvas.width;
    const h = this.canvas.height;
    const pr = frame.props;

    const seed = Math.round(num(pr.seed, 1));
    if (seed !== this.permSeed) {
      this.perm = buildPerm(seed);
      this.permSeed = seed;
    }

    const detail = Math.max(0.05, Math.min(1, num(pr.detail, 0.25)));
    const rw = Math.max(2, Math.round(w * detail));
    const rh = Math.max(2, Math.round(h * detail));
    if (this.buf.width !== rw || this.buf.height !== rh || !this.image) {
      this.buf.width = rw;
      this.buf.height = rh;
      this.image = this.bctx.createImageData(rw, rh);
    }

    const scale = num(pr.scale, 3);
    const octaves = Math.max(1, Math.min(8, Math.round(num(pr.octaves, 3))));
    const gain = num(pr.persistence, 0.5);
    const lac = num(pr.lacunarity, 2);
    const contrast = num(pr.contrast, 1);
    const bands = Math.max(0, Math.round(num(pr.bands, 0)));
    const z = frame.time * num(pr.speed, 0.3);
    const aspect = w / h;

    const [loR, loG, loB, loA] = arr(pr.colorLow, [10, 10, 12, 255]);
    const [hiR, hiG, hiB, hiA] = arr(pr.colorHigh, [192, 252, 4, 255]);
    const perm = this.perm;
    const data = this.image.data;

    let idx = 0;
    for (let y = 0; y < rh; y++) {
      const ny = (y / rh) * scale;
      for (let x = 0; x < rw; x++) {
        const nx = (x / rw) * scale * aspect;
        // fBm
        let amp = 0.5, freq = 1, sum = 0, norm = 0;
        for (let o = 0; o < octaves; o++) {
          sum += amp * perlin3(perm, nx * freq, ny * freq, z * freq);
          norm += amp;
          amp *= gain;
          freq *= lac;
        }
        let t = sum / (norm || 1); // ~[-1,1]
        t = t * 0.5 + 0.5;
        t = (t - 0.5) * contrast + 0.5;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        if (bands > 0) t = Math.round(t * bands) / bands;
        data[idx++] = loR + (hiR - loR) * t;
        data[idx++] = loG + (hiG - loG) * t;
        data[idx++] = loB + (hiB - loB) * t;
        data[idx++] = loA + (hiA - loA) * t;
      }
    }

    this.bctx.putImageData(this.image, 0, 0);
    this.ctx.clearRect(0, 0, w, h);
    this.ctx.imageSmoothingEnabled = pr.smooth !== false;
    this.ctx.drawImage(this.buf, 0, 0, rw, rh, 0, 0, w, h);
    return this.canvas;
  }

  /** Expose this noise as a field sampler so the layer above (Landscape, Glyph Scatter,
   * …) can feed off it instead of duplicating noise config. (u, v) are 0..1-ish across
   * the field; w is a depth/time the consumer supplies. Returns ~[-1, 1]. */
  fieldSource(props: Record<string, unknown>): (u: number, v: number, w: number) => number {
    const seed = Math.round(num(props.seed, 1));
    const perm = seed === this.permSeed ? this.perm : buildPerm(seed);
    const scale = num(props.scale, 3);
    const oct = Math.max(1, Math.min(8, Math.round(num(props.octaves, 3))));
    const gain = num(props.persistence, 0.5);
    const lac = num(props.lacunarity, 2);
    return (u, v, w) => fbm(perm, u * scale, v * scale, w, oct, gain, lac);
  }

  sourceKey(props: Record<string, unknown>): string {
    return [props.seed, props.scale, props.octaves, props.persistence, props.lacunarity].join("|");
  }

  dispose(): void {
    this.canvas.width = this.canvas.height = 0;
    this.buf.width = this.buf.height = 0;
    this.image = undefined;
  }
}

export const noiseLayerType: LayerTypeDefinition = {
  type: "noise",
  label: "Noise Field",
  category: "Generators",
  icon: "Cloudy",
  description: "Animated fBm Perlin noise — gradient-mapped, optional banding. Evolves over time.",
  defaultSize: (comp) => [comp.width, comp.height],
  schema: [
    { key: "scale", name: "Scale", type: "number", default: 3, group: "Noise", meta: { min: 0.2, max: 30, step: 0.1 } },
    { key: "octaves", name: "Octaves", type: "number", default: 3, group: "Noise", meta: { min: 1, max: 8, step: 1 } },
    { key: "persistence", name: "Persistence", type: "number", default: 0.5, group: "Noise", meta: { min: 0, max: 1, step: 0.01 } },
    { key: "lacunarity", name: "Lacunarity", type: "number", default: 2, group: "Noise", meta: { min: 1, max: 4, step: 0.05 } },
    { key: "speed", name: "Evolve Speed", type: "number", default: 0.3, group: "Noise", meta: { min: -4, max: 4, step: 0.05 } },
    { key: "seed", name: "Seed", type: "number", default: 1, group: "Noise", animatable: false, meta: { min: 0, max: 99999, step: 1 } },
    { key: "contrast", name: "Contrast", type: "number", default: 1, group: "Look", meta: { min: 0.1, max: 6, step: 0.05 } },
    { key: "bands", name: "Bands (0=smooth)", type: "number", default: 0, group: "Look", meta: { min: 0, max: 32, step: 1 } },
    { key: "colorLow", name: "Low Color", type: "color", default: [10, 10, 12, 0], group: "Look" },
    { key: "colorHigh", name: "High Color", type: "color", default: [192, 252, 4, 255], group: "Look" },
    { key: "smooth", name: "Smooth Upscale", type: "boolean", default: true, group: "Look" },
    { key: "detail", name: "Detail (perf)", type: "percent", default: 0.25, group: "Look", meta: { min: 0.05, max: 1, step: 0.05 } },
  ],
  createRenderer: () => new NoiseRenderer(),
};
