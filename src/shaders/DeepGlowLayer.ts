import { Plugin, type Frame } from "@/plugins/Plugin";
import { ShaderRunner } from "./ShaderRunner";

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
  for (int i = -32; i <= 32; i++) {
    float fi = float(i);
    if (fi < -uRadius || fi > uRadius) continue;
    float w = exp(-0.5 * (fi * fi) / (sigma * sigma));
    acc += texture2D(uTex, vUv + px * fi) * w;
    wsum += w;
  }
  gl_FragColor = acc / wsum;
}`;

const COMPOSE_FRAG = `
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

export class DeepGlowLayer extends Plugin {
  radius0 = this.knob(0, { min: 1, max: 16, step: 1, default: 4 });
  radius1 = this.knob(1, { min: 1, max: 32, step: 1, default: 12 });
  radius2 = this.knob(2, { min: 1, max: 64, step: 1, default: 32 });
  str0 = this.knob(3, { min: 0, max: 1, default: 0.5 });
  str1 = this.knob(4, { min: 0, max: 1, default: 0.3 });
  str2 = this.knob(5, { min: 0, max: 1, default: 0.2 });
  mix = this.knob(6, { min: 0, max: 1, default: 0.8 });

  private blurH = new ShaderRunner(BLUR_FRAG);
  private blurV = new ShaderRunner(BLUR_FRAG);
  private compose = new ShaderRunner(COMPOSE_FRAG, ["uBlur0", "uBlur1", "uBlur2"]);
  // ShaderRunner returns its single reused canvas, so each blur tier must be snapshotted into its
  // own canvas before the next tier overwrites it — otherwise all three glow textures alias the
  // last pass and the multi-radius glow collapses to one. (This was the "broken" look.)
  private tiers = [document.createElement("canvas"), document.createElement("canvas"), document.createElement("canvas")];
  private tierCtx = this.tiers.map((c) => c.getContext("2d")!);

  resize(w: number, h: number): void {
    this.blurH.resize(w, h);
    this.blurV.resize(w, h);
    this.compose.resize(w, h);
    for (const c of this.tiers) { c.width = Math.max(1, w); c.height = Math.max(1, h); }
  }

  private blurInto(tier: number, src: HTMLCanvasElement, radius: number, w: number, h: number): HTMLCanvasElement {
    const h1 = this.blurH.render(src, { uDir: [1, 0], uResolution: [w, h], uRadius: radius });
    const v = this.blurV.render(h1, { uDir: [0, 1], uResolution: [w, h], uRadius: radius });
    const dst = this.tiers[tier], ctx = this.tierCtx[tier];
    if (dst.width !== w || dst.height !== h) { dst.width = w; dst.height = h; }
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(v, 0, 0);
    return dst;
  }

  render(f: Frame): HTMLCanvasElement | null {
    const bd = f.input;
    if (!bd) return null;
    if (!this.blurH.available) return bd;
    const w = f.width, h = f.height;
    this.blurH.resize(w, h);
    this.blurV.resize(w, h);
    this.compose.resize(w, h);

    const b0 = this.blurInto(0, bd, Math.max(1, this.radius0.value), w, h);
    const b1 = this.blurInto(1, bd, Math.max(1, this.radius1.value), w, h);
    const b2 = this.blurInto(2, bd, Math.max(1, this.radius2.value), w, h);

    this.compose.setTexture("uBlur0", b0);
    this.compose.setTexture("uBlur1", b1);
    this.compose.setTexture("uBlur2", b2);

    return this.compose.render(bd, {
      uStr0: this.str0.value,
      uStr1: this.str1.value,
      uStr2: this.str2.value,
      uMix: this.mix.value,
    });
  }

  dispose(): void {
    this.blurH.dispose();
    this.blurV.dispose();
    this.compose.dispose();
    for (const c of this.tiers) { c.width = c.height = 0; }
  }
}
