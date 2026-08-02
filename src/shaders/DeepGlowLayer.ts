import { Plugin, type Frame } from "@/plugins/Plugin";
import { ShaderRunner, type ShaderTarget } from "./ShaderRunner";

// Straight passthrough: parks the backdrop in a texture once per frame. Kept a plain copy so the
// target holds *straight* RGBA, which is what BLUR_FRAG and COMPOSE_FRAG's `uTex` both expect.
const COPY_FRAG = `
precision highp float;
varying vec2 vUv;
uniform sampler2D uTex;
void main() { gl_FragColor = texture2D(uTex, vUv); }`;

// Alpha discipline: textures arrive straight (texImage2D un-premultiplies canvas sources) but the
// GL canvas is composited as PREMULTIPLIED. Blurring/summing straight RGBA over a transparent
// background leaks color into near-zero-alpha pixels, which the compositor then un-premultiplies
// into a blown-out white halo  -  so both passes work premultiplied (rgb·a) and write premultiplied.
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
    vec4 t = texture2D(uTex, vUv + px * fi);
    acc += vec4(t.rgb * t.a, t.a) * w;
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
  // The blur tiers now arrive straight from BLUR_FRAG's target, which already writes premultiplied
  // (rgb·a) - so they are summed as-is. They used to make a round trip through a 2D canvas, and the
  // re-upload un-premultiplied them, which is why this used to multiply by .a again.
  vec3 glow = b0.rgb * uStr0 + b1.rgb * uStr1 + b2.rgb * uStr2;
  float glowA = b0.a * uStr0 + b1.a * uStr1 + b2.a * uStr2;
  float outA = clamp(src.a + glowA * uMix, 0.0, 1.0);
  vec3 outP = min(clamp(src.rgb * src.a + glow * uMix, 0.0, 1.0), vec3(outA));
  gl_FragColor = vec4(outP, outA);
}`;

export class DeepGlowLayer extends Plugin {
  radius0 = this.number({ min: 1, max: 16, step: 1, default: 4 });
  radius1 = this.number({ min: 1, max: 32, step: 1, default: 12 });
  radius2 = this.number({ min: 1, max: 64, step: 1, default: 32 });
  str0 = this.number({ min: 0, max: 1, default: 0.5 });
  str1 = this.number({ min: 0, max: 1, default: 0.3 });
  str2 = this.number({ min: 0, max: 1, default: 0.2 });
  mix = this.number({ min: 0, max: 1, default: 0.8 });

  // The backdrop is uploaded once per frame into `source`'s target, then every pass below reads
  // that texture instead of re-uploading the same canvas four times.
  private source = new ShaderRunner(COPY_FRAG);
  private blurH = new ShaderRunner(BLUR_FRAG);
  // A runner's target is overwritten the next time it draws, so the three tiers must finish in
  // three *different* runners - otherwise all three glow textures alias the last pass and the
  // multi-radius glow collapses to one. (This was the "broken" look.) The horizontal half is still
  // one runner: each tier consumes it immediately, before the next tier runs.
  private blurV = [new ShaderRunner(BLUR_FRAG), new ShaderRunner(BLUR_FRAG), new ShaderRunner(BLUR_FRAG)];
  private compose = new ShaderRunner(COMPOSE_FRAG, ["uBlur0", "uBlur1", "uBlur2"]);

  private runners(): ShaderRunner[] {
    return [this.source, this.blurH, ...this.blurV, this.compose];
  }

  resize(w: number, h: number): void {
    for (const r of this.runners()) r.resize(w, h);
  }

  private blurTier(tier: number, src: ShaderTarget, radius: number, w: number, h: number): ShaderTarget | null {
    const h1 = this.blurH.renderToTexture(src, { uDir: [1, 0], uResolution: [w, h], uRadius: radius });
    if (!h1) return null;
    return this.blurV[tier].renderToTexture(h1, { uDir: [0, 1], uResolution: [w, h], uRadius: radius });
  }

  render(f: Frame): HTMLCanvasElement | null {
    const bd = f.input;
    if (!bd) return null;
    if (!this.blurH.available) return bd;
    const w = f.width, h = f.height;
    this.resize(w, h);

    const src = this.source.renderToTexture(bd, {});
    if (!src) return bd;

    const b0 = this.blurTier(0, src, Math.max(1, this.radius0.value), w, h);
    const b1 = this.blurTier(1, src, Math.max(1, this.radius1.value), w, h);
    const b2 = this.blurTier(2, src, Math.max(1, this.radius2.value), w, h);
    if (!b0 || !b1 || !b2) return bd;

    this.compose.setTexture("uBlur0", b0);
    this.compose.setTexture("uBlur1", b1);
    this.compose.setTexture("uBlur2", b2);

    return this.compose.render(src, {
      uStr0: this.str0.value,
      uStr1: this.str1.value,
      uStr2: this.str2.value,
      uMix: this.mix.value,
    });
  }

  dispose(): void {
    for (const r of this.runners()) r.dispose();
  }
}
