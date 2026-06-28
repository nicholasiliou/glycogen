import type { LayerTypeDefinition } from "../engine/plugins/Registry";
import type { LayerRenderer, RenderFrame } from "../engine/render/types";
import { ShaderRunner } from "./ShaderRunner";

function num(v: unknown, f: number): number {
  return typeof v === "number" ? v : f;
}
function rgb01(v: unknown, f: [number, number, number]): [number, number, number] {
  if (!Array.isArray(v)) return f;
  return [(v[0] ?? 0) / 255, (v[1] ?? 0) / 255, (v[2] ?? 0) / 255];
}

const FRAG = `
precision highp float;
varying vec2 vUv;
uniform sampler2D uTex;
uniform vec3 uC0, uC1, uC2, uC3, uC4, uC5;
uniform float uCount;
uniform float uMix;
float d2(vec3 a, vec3 b) { vec3 d = a - b; return dot(d, d); }
void main() {
  vec4 src = texture2D(uTex, vUv);
  vec3 c = src.rgb;
  vec3 best = uC0; float bd = d2(c, uC0);
  if (uCount > 1.5) { float d = d2(c, uC1); if (d < bd) { bd = d; best = uC1; } }
  if (uCount > 2.5) { float d = d2(c, uC2); if (d < bd) { bd = d; best = uC2; } }
  if (uCount > 3.5) { float d = d2(c, uC3); if (d < bd) { bd = d; best = uC3; } }
  if (uCount > 4.5) { float d = d2(c, uC4); if (d < bd) { bd = d; best = uC4; } }
  if (uCount > 5.5) { float d = d2(c, uC5); if (d < bd) { bd = d; best = uC5; } }
  gl_FragColor = vec4(mix(c, best, uMix), src.a);
}`;

class ColorLookupRenderer implements LayerRenderer {
  private runner = new ShaderRunner(FRAG);
  resize(w: number, h: number): void { this.runner.resize(w, h); }
  render(frame: RenderFrame): HTMLCanvasElement | null {
    const bd = frame.backdrop;
    if (!bd) return null;
    if (!this.runner.available) return bd;
    this.runner.resize(frame.width, frame.height);
    const p = frame.props;
    return this.runner.render(bd, {
      uC0: rgb01(p.color0, [0.75, 0.99, 0.02]),
      uC1: rgb01(p.color1, [0.92, 0.01, 0.49]),
      uC2: rgb01(p.color2, [0.21, 0.0, 0.98]),
      uC3: rgb01(p.color3, [1.0, 0.33, 0.0]),
      uC4: rgb01(p.color4, [0.04, 0.04, 0.05]),
      uC5: rgb01(p.color5, [0.94, 0.94, 0.94]),
      uCount: Math.max(1, Math.min(6, Math.round(num(p.count, 6)))),
      uMix: Math.max(0, Math.min(1, num(p.amount, 1))),
    });
  }
  dispose(): void { this.runner.dispose(); }
}

export const colorLookupLayerType: LayerTypeDefinition = {
  type: "fx.colorLookup",
  label: "Color Lookup",
  category: "Effects",
  icon: "Palette",
  kind: "effect",
  description: "Forces every colour below to the nearest colour in a defined palette (EGA by default).",
  schema: [
    { key: "count", name: "Palette Size", type: "number", default: 4, group: "Palette", meta: { min: 1, max: 6, step: 1 } },
    { key: "amount", name: "Amount", type: "percent", default: 1, group: "Palette", meta: { min: 0, max: 1, step: 0.01 } },
    { key: "color0", name: "Color 1", type: "color", default: [192, 252, 4, 255], group: "Palette" },
    { key: "color1", name: "Color 2", type: "color", default: [234, 2, 126, 255], group: "Palette" },
    { key: "color2", name: "Color 3", type: "color", default: [54, 1, 251, 255], group: "Palette" },
    { key: "color3", name: "Color 4", type: "color", default: [255, 85, 0, 255], group: "Palette" },
    { key: "color4", name: "Color 5", type: "color", default: [10, 10, 12, 255], group: "Palette" },
    { key: "color5", name: "Color 6", type: "color", default: [240, 240, 240, 255], group: "Palette" },
  ],
  createRenderer: () => new ColorLookupRenderer(),
};
