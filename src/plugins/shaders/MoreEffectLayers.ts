import type { LayerTypeDefinition } from "../../engine/plugins/Registry";
import type { LayerRenderer, RenderFrame } from "../../engine/render/types";
import { ShaderRunner } from "./ShaderRunner";

function num(v: unknown, f: number): number {
  return typeof v === "number" ? v : f;
}
function rgb01(v: unknown, f: [number, number, number]): [number, number, number] {
  if (!Array.isArray(v)) return f;
  return [(v[0] ?? 0) / 255, (v[1] ?? 0) / 255, (v[2] ?? 0) / 255];
}

// ───────────────────────────── Bayer Dithering ─────────────────────────────

const BAYER_FRAG = `
precision highp float;
varying vec2 vUv;
uniform sampler2D uTex;
uniform vec2 uResolution;
uniform float uLevels;
uniform float uScale;
uniform float uColored;

float bayer4x4(vec2 pos) {
  int x = int(mod(pos.x, 4.0));
  int y = int(mod(pos.y, 4.0));
  int idx = y * 4 + x;
  if (idx == 0)  return  0.0 / 16.0;
  if (idx == 1)  return  8.0 / 16.0;
  if (idx == 2)  return  2.0 / 16.0;
  if (idx == 3)  return 10.0 / 16.0;
  if (idx == 4)  return 12.0 / 16.0;
  if (idx == 5)  return  4.0 / 16.0;
  if (idx == 6)  return 14.0 / 16.0;
  if (idx == 7)  return  6.0 / 16.0;
  if (idx == 8)  return  3.0 / 16.0;
  if (idx == 9)  return 11.0 / 16.0;
  if (idx == 10) return  1.0 / 16.0;
  if (idx == 11) return  9.0 / 16.0;
  if (idx == 12) return 15.0 / 16.0;
  if (idx == 13) return  7.0 / 16.0;
  if (idx == 14) return 13.0 / 16.0;
  return 5.0 / 16.0;
}

void main() {
  vec4 src = texture2D(uTex, vUv);
  vec2 pix = floor(vUv * uResolution / uScale);
  float threshold = bayer4x4(pix);
  float levels = max(2.0, uLevels);
  if (uColored > 0.5) {
    vec3 q = floor(src.rgb * levels + threshold) / (levels - 1.0);
    gl_FragColor = vec4(clamp(q, 0.0, 1.0), src.a);
  } else {
    float lum = dot(src.rgb, vec3(0.299, 0.587, 0.114));
    float q = floor(lum * levels + threshold) / (levels - 1.0);
    q = clamp(q, 0.0, 1.0);
    gl_FragColor = vec4(vec3(q), src.a);
  }
}`;

class BayerRenderer implements LayerRenderer {
  private runner = new ShaderRunner(BAYER_FRAG);
  resize(w: number, h: number): void { this.runner.resize(w, h); }
  render(frame: RenderFrame): HTMLCanvasElement | null {
    const bd = frame.backdrop;
    if (!bd) return null;
    if (!this.runner.available) return bd;
    this.runner.resize(frame.width, frame.height);
    const p = frame.props;
    return this.runner.render(bd, {
      uResolution: [frame.width, frame.height],
      uLevels: num(p.levels, 4),
      uScale: Math.max(1, num(p.scale, 1)),
      uColored: p.colored ? 1 : 0,
    });
  }
  dispose(): void { this.runner.dispose(); }
}

export const bayerLayerType: LayerTypeDefinition = {
  type: "fx.bayer",
  label: "Bayer Dither",
  category: "Effects",
  icon: "Grid2x2",
  kind: "effect",
  description: "Ordered 4×4 Bayer matrix dithering.",
  schema: [
    { key: "levels", name: "Levels", type: "number", default: 4, group: "Bayer", meta: { min: 2, max: 16, step: 1 } },
    { key: "scale", name: "Matrix Scale", type: "number", default: 1, group: "Bayer", meta: { min: 1, max: 8, step: 1 } },
    { key: "colored", name: "Color Mode", type: "boolean", default: false, group: "Bayer" },
  ],
  createRenderer: () => new BayerRenderer(),
};

// ───────────────────────────── Pixelation ─────────────────────────────

const PIXELATE_FRAG = `
precision highp float;
varying vec2 vUv;
uniform sampler2D uTex;
uniform vec2 uResolution;
uniform float uSize;
void main() {
  vec2 blocks = uResolution / uSize;
  vec2 uv = (floor(vUv * blocks) + 0.5) / blocks;
  gl_FragColor = texture2D(uTex, uv);
}`;

class PixelateRenderer implements LayerRenderer {
  private runner = new ShaderRunner(PIXELATE_FRAG);
  resize(w: number, h: number): void { this.runner.resize(w, h); }
  render(frame: RenderFrame): HTMLCanvasElement | null {
    const bd = frame.backdrop;
    if (!bd) return null;
    if (!this.runner.available) return bd;
    this.runner.resize(frame.width, frame.height);
    const p = frame.props;
    return this.runner.render(bd, {
      uResolution: [frame.width, frame.height],
      uSize: Math.max(1, num(p.size, 8)),
    });
  }
  dispose(): void { this.runner.dispose(); }
}

export const pixelateLayerType: LayerTypeDefinition = {
  type: "fx.pixelate",
  label: "Pixelate",
  category: "Effects",
  icon: "LayoutGrid",
  kind: "effect",
  description: "Reduces resolution to large square pixels.",
  schema: [
    { key: "size", name: "Pixel Size", type: "number", default: 8, group: "Pixelate", meta: { min: 1, max: 128, step: 1 } },
  ],
  createRenderer: () => new PixelateRenderer(),
};

// ───────────────────────────── Pixel Sorting ─────────────────────────────
// CPU-side sort per column/row — GPU can't do arbitrary data reordering.

class PixelSortRenderer implements LayerRenderer {
  private canvas = document.createElement("canvas");
  private ctx = this.canvas.getContext("2d")!;

  resize(w: number, h: number): void {
    this.canvas.width = w;
    this.canvas.height = h;
  }

  render(frame: RenderFrame): HTMLCanvasElement | null {
    const bd = frame.backdrop;
    if (!bd) return null;
    const { width: w, height: h } = frame;
    const p = frame.props;
    const threshold = num(p.threshold, 0.25);
    const horizontal = p.direction === "horizontal";
    const reverse = !!p.reverse;

    this.canvas.width = w;
    this.canvas.height = h;
    this.ctx.drawImage(bd, 0, 0, w, h);
    const img = this.ctx.getImageData(0, 0, w, h);
    const d = img.data;

    const lum = (r: number, g: number, b: number) =>
      (0.299 * r + 0.587 * g + 0.114 * b) / 255;

    if (horizontal) {
      for (let y = 0; y < h; y++) {
        const row = y * w;
        let start = -1;
        for (let x = 0; x <= w; x++) {
          const i = (row + x) * 4;
          const bright = x < w ? lum(d[i], d[i + 1], d[i + 2]) > threshold : false;
          if (bright && start === -1) { start = x; }
          else if (!bright && start !== -1) {
            const segment: [number, number, number, number][] = [];
            for (let sx = start; sx < x; sx++) {
              const si = (row + sx) * 4;
              segment.push([d[si], d[si + 1], d[si + 2], d[si + 3]]);
            }
            segment.sort((a, b) => lum(a[0], a[1], a[2]) - lum(b[0], b[1], b[2]));
            if (reverse) segment.reverse();
            for (let sx = start; sx < x; sx++) {
              const si = (row + sx) * 4;
              [d[si], d[si + 1], d[si + 2], d[si + 3]] = segment[sx - start];
            }
            start = -1;
          }
        }
      }
    } else {
      for (let x = 0; x < w; x++) {
        let start = -1;
        for (let y = 0; y <= h; y++) {
          const i = (y * w + x) * 4;
          const bright = y < h ? lum(d[i], d[i + 1], d[i + 2]) > threshold : false;
          if (bright && start === -1) { start = y; }
          else if (!bright && start !== -1) {
            const segment: [number, number, number, number][] = [];
            for (let sy = start; sy < y; sy++) {
              const si = (sy * w + x) * 4;
              segment.push([d[si], d[si + 1], d[si + 2], d[si + 3]]);
            }
            segment.sort((a, b) => lum(a[0], a[1], a[2]) - lum(b[0], b[1], b[2]));
            if (reverse) segment.reverse();
            for (let sy = start; sy < y; sy++) {
              const si = (sy * w + x) * 4;
              [d[si], d[si + 1], d[si + 2], d[si + 3]] = segment[sy - start];
            }
            start = -1;
          }
        }
      }
    }

    this.ctx.putImageData(img, 0, 0);
    return this.canvas;
  }

  dispose(): void {}
}

export const pixelSortLayerType: LayerTypeDefinition = {
  type: "fx.pixelSort",
  label: "Pixel Sort",
  category: "Effects",
  icon: "AlignVerticalDistributeCenter",
  kind: "effect",
  description: "Sorts pixels within bright spans along rows or columns.",
  schema: [
    { key: "threshold", name: "Threshold", type: "number", default: 0.25, group: "Pixel Sort", meta: { min: 0, max: 1, step: 0.01 } },
    {
      key: "direction", name: "Direction", type: "select", default: "vertical", group: "Pixel Sort",
      meta: { options: [{ value: "vertical", label: "Vertical" }, { value: "horizontal", label: "Horizontal" }] },
    },
    { key: "reverse", name: "Reverse", type: "boolean", default: false, group: "Pixel Sort" },
  ],
  createRenderer: () => new PixelSortRenderer(),
};

// ───────────────────────────── Venetian Blinds ─────────────────────────────

const BLINDS_FRAG = `
precision highp float;
varying vec2 vUv;
uniform sampler2D uTex;
uniform float uBands;
uniform float uOffset;
uniform float uAngle;
uniform float uFade;

void main() {
  float angle = uAngle * 3.14159265 / 180.0;
  float axis = vUv.x * cos(angle) + vUv.y * sin(angle);
  float band = fract((axis + uOffset) * uBands);
  float a = smoothstep(uFade, 1.0 - uFade, band);
  vec4 src = texture2D(uTex, vUv);
  gl_FragColor = vec4(src.rgb, src.a * a);
}`;

class BlindsRenderer implements LayerRenderer {
  private runner = new ShaderRunner(BLINDS_FRAG);
  resize(w: number, h: number): void { this.runner.resize(w, h); }
  render(frame: RenderFrame): HTMLCanvasElement | null {
    const bd = frame.backdrop;
    if (!bd) return null;
    if (!this.runner.available) return bd;
    this.runner.resize(frame.width, frame.height);
    const p = frame.props;
    return this.runner.render(bd, {
      uBands: Math.max(1, num(p.bands, 8)),
      uOffset: num(p.offset, 0),
      uAngle: num(p.angle, 0),
      uFade: Math.max(0, Math.min(0.49, num(p.fade, 0.05))),
    });
  }
  dispose(): void { this.runner.dispose(); }
}

export const venetianBlindsLayerType: LayerTypeDefinition = {
  type: "fx.venetianBlinds",
  label: "Venetian Blinds",
  category: "Effects",
  icon: "PanelTop",
  kind: "effect",
  description: "Slices the image into alternating transparent bands.",
  schema: [
    { key: "bands", name: "Bands", type: "number", default: 8, group: "Blinds", meta: { min: 1, max: 64, step: 1 } },
    { key: "offset", name: "Offset", type: "number", default: 0, group: "Blinds", meta: { min: 0, max: 1, step: 0.01 } },
    { key: "angle", name: "Angle (deg)", type: "number", default: 0, group: "Blinds", meta: { min: -180, max: 180, step: 1 } },
    { key: "fade", name: "Edge Fade", type: "number", default: 0.05, group: "Blinds", meta: { min: 0, max: 0.49, step: 0.01 } },
  ],
  createRenderer: () => new BlindsRenderer(),
};

// ───────────────────────────── Deep Glow (triple pass) ─────────────────────

// Single-pass separable Gaussian blur used three times at different radii
const BLUR_FRAG = `
precision highp float;
varying vec2 vUv;
uniform sampler2D uTex;
uniform vec2 uDir;
uniform vec2 uResolution;
uniform float uRadius;

void main() {
  vec2 px = uDir / uResolution;
  vec4 acc = vec4(0.0);
  float wsum = 0.0;
  float sigma = uRadius / 3.0;
  int steps = int(uRadius);
  for (int i = -32; i <= 32; i++) {
    float fi = float(i);
    if (fi < -uRadius || fi > uRadius) continue;
    float w = exp(-0.5 * (fi * fi) / (sigma * sigma));
    acc += texture2D(uTex, vUv + px * fi) * w;
    wsum += w;
  }
  gl_FragColor = acc / wsum;
}`;

const GLOW_COMPOSE_FRAG = `
precision highp float;
varying vec2 vUv;
uniform sampler2D uTex;
uniform sampler2D uBlur0;
uniform sampler2D uBlur1;
uniform sampler2D uBlur2;
uniform float uStr0;
uniform float uStr1;
uniform float uStr2;
uniform float uMix;
void main() {
  vec4 src = texture2D(uTex, vUv);
  vec4 b0 = texture2D(uBlur0, vUv);
  vec4 b1 = texture2D(uBlur1, vUv);
  vec4 b2 = texture2D(uBlur2, vUv);
  vec4 glow = b0 * uStr0 + b1 * uStr1 + b2 * uStr2;
  gl_FragColor = clamp(src + glow * uMix, 0.0, 1.0);
}`;

class DeepGlowRenderer implements LayerRenderer {
  private blurH = new ShaderRunner(BLUR_FRAG);
  private blurV = new ShaderRunner(BLUR_FRAG);
  private compose = new ShaderRunner(GLOW_COMPOSE_FRAG, ["uBlur0", "uBlur1", "uBlur2"]);
  private tmp0 = document.createElement("canvas");
  private tmp1 = document.createElement("canvas");
  private tmp2 = document.createElement("canvas");

  resize(w: number, h: number): void {
    this.blurH.resize(w, h);
    this.blurV.resize(w, h);
    this.compose.resize(w, h);
  }

  private blurPass(src: HTMLCanvasElement, radius: number, w: number, h: number): HTMLCanvasElement {
    const h1 = this.blurH.render(src, { uDir: [1, 0], uResolution: [w, h], uRadius: radius });
    if (!h1) return src;
    return this.blurV.render(h1, { uDir: [0, 1], uResolution: [w, h], uRadius: radius }) ?? src;
  }

  render(frame: RenderFrame): HTMLCanvasElement | null {
    const bd = frame.backdrop;
    if (!bd) return null;
    if (!this.blurH.available) return bd;
    const { width: w, height: h } = frame;
    this.blurH.resize(w, h);
    this.blurV.resize(w, h);
    this.compose.resize(w, h);
    const p = frame.props;
    const r0 = Math.max(1, num(p.radius0, 4));
    const r1 = Math.max(1, num(p.radius1, 12));
    const r2 = Math.max(1, num(p.radius2, 32));

    const b0 = this.blurPass(bd, r0, w, h);
    const b1 = this.blurPass(bd, r1, w, h);
    const b2 = this.blurPass(bd, r2, w, h);

    this.compose.setTexture("uBlur0", b0);
    this.compose.setTexture("uBlur1", b1);
    this.compose.setTexture("uBlur2", b2);

    return this.compose.render(bd, {
      uStr0: num(p.str0, 0.5),
      uStr1: num(p.str1, 0.3),
      uStr2: num(p.str2, 0.2),
      uMix: num(p.mix, 0.8),
    });
  }

  dispose(): void {
    this.blurH.dispose();
    this.blurV.dispose();
    this.compose.dispose();
  }
}

export const deepGlowLayerType: LayerTypeDefinition = {
  type: "fx.deepGlow",
  label: "Deep Glow",
  category: "Effects",
  icon: "Sparkles",
  kind: "effect",
  description: "Triple-layered bloom: near, mid, and far Gaussian blur passes.",
  schema: [
    { key: "radius0", name: "Near Radius", type: "number", default: 4, group: "Deep Glow", meta: { min: 1, max: 32, step: 1 } },
    { key: "radius1", name: "Mid Radius", type: "number", default: 12, group: "Deep Glow", meta: { min: 1, max: 64, step: 1 } },
    { key: "radius2", name: "Far Radius", type: "number", default: 32, group: "Deep Glow", meta: { min: 1, max: 96, step: 1 } },
    { key: "str0", name: "Near Strength", type: "number", default: 0.5, group: "Deep Glow", meta: { min: 0, max: 2, step: 0.01 } },
    { key: "str1", name: "Mid Strength", type: "number", default: 0.3, group: "Deep Glow", meta: { min: 0, max: 2, step: 0.01 } },
    { key: "str2", name: "Far Strength", type: "number", default: 0.2, group: "Deep Glow", meta: { min: 0, max: 2, step: 0.01 } },
    { key: "mix", name: "Glow Mix", type: "number", default: 0.8, group: "Deep Glow", meta: { min: 0, max: 3, step: 0.01 } },
  ],
  createRenderer: () => new DeepGlowRenderer(),
};

// ───────────────────────────── Pixel Stretching ─────────────────────────────

const STRETCH_FRAG = `
precision highp float;
varying vec2 vUv;
uniform sampler2D uTex;
uniform vec2 uResolution;
uniform float uThreshold;
uniform float uAmount;
uniform float uHorizontal;

void main() {
  vec2 px = 1.0 / uResolution;
  vec2 uv = vUv;
  vec4 src = texture2D(uTex, uv);
  float lum = dot(src.rgb, vec3(0.299, 0.587, 0.114));
  if (lum < uThreshold) {
    gl_FragColor = src;
    return;
  }
  float stretch = (lum - uThreshold) / (1.0 - uThreshold + 0.0001) * uAmount;
  vec2 dir = uHorizontal > 0.5 ? vec2(px.x, 0.0) : vec2(0.0, px.y);
  vec2 sampleUv = uv - dir * stretch * uResolution * 0.5;
  sampleUv = clamp(sampleUv, vec2(0.0), vec2(1.0));
  gl_FragColor = texture2D(uTex, sampleUv);
}`;

class PixelStretchRenderer implements LayerRenderer {
  private runner = new ShaderRunner(STRETCH_FRAG);
  resize(w: number, h: number): void { this.runner.resize(w, h); }
  render(frame: RenderFrame): HTMLCanvasElement | null {
    const bd = frame.backdrop;
    if (!bd) return null;
    if (!this.runner.available) return bd;
    this.runner.resize(frame.width, frame.height);
    const p = frame.props;
    return this.runner.render(bd, {
      uResolution: [frame.width, frame.height],
      uThreshold: num(p.threshold, 0.5),
      uAmount: num(p.amount, 0.1),
      uHorizontal: p.direction === "horizontal" ? 1 : 0,
    });
  }
  dispose(): void { this.runner.dispose(); }
}

export const pixelStretchLayerType: LayerTypeDefinition = {
  type: "fx.pixelStretch",
  label: "Pixel Stretch",
  category: "Effects",
  icon: "StretchHorizontal",
  kind: "effect",
  description: "Smears bright pixels along an axis, creating a streak/glitch effect.",
  schema: [
    { key: "threshold", name: "Threshold", type: "number", default: 0.5, group: "Pixel Stretch", meta: { min: 0, max: 1, step: 0.01 } },
    { key: "amount", name: "Amount", type: "number", default: 0.1, group: "Pixel Stretch", meta: { min: 0, max: 1, step: 0.01 } },
    {
      key: "direction", name: "Direction", type: "select", default: "vertical", group: "Pixel Stretch",
      meta: { options: [{ value: "vertical", label: "Vertical" }, { value: "horizontal", label: "Horizontal" }] },
    },
  ],
  createRenderer: () => new PixelStretchRenderer(),
};
