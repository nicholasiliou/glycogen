import type { LayerTypeDefinition } from "../engine/plugins/Registry";
import type { LayerRenderer, RenderFrame } from "../engine/render/types";
import { ShaderRunner } from "./ShaderRunner";

function num(v: unknown, f: number): number {
  return typeof v === "number" ? v : f;
}

const FRAG = `
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
  private runner = new ShaderRunner(FRAG);
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
