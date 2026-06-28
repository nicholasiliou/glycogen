import type { LayerTypeDefinition } from "../engine/plugins/Registry";
import type { LayerRenderer, RenderFrame } from "../engine/render/types";
import { ShaderRunner } from "./ShaderRunner";

function num(v: unknown, f: number): number {
  return typeof v === "number" ? v : f;
}

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

class DeepGlowRenderer implements LayerRenderer {
  private blurH = new ShaderRunner(BLUR_FRAG);
  private blurV = new ShaderRunner(BLUR_FRAG);
  private compose = new ShaderRunner(COMPOSE_FRAG, ["uBlur0", "uBlur1", "uBlur2"]);

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
