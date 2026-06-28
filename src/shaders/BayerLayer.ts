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
