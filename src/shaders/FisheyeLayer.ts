import type { LayerTypeDefinition } from "../engine/plugins/Registry";
import type { LayerRenderer, RenderFrame } from "../engine/render/types";
import { ShaderRunner } from "./ShaderRunner";

function num(v: unknown, f: number): number {
  return typeof v === "number" ? v : f;
}
function vec2n(v: unknown, fx: number, fy: number): [number, number] {
  return Array.isArray(v) ? [(v[0] as number) ?? fx, (v[1] as number) ?? fy] : [fx, fy];
}

const FRAG = `
precision highp float;
varying vec2 vUv;
uniform sampler2D uTex;
uniform float uStrength;
uniform float uZoom;
uniform float uAspect;
uniform vec2 uCenter;
void main() {
  vec2 c = uCenter;
  vec2 d = vUv - c;
  d.x *= uAspect;
  float r = length(d);
  float f = (1.0 + uStrength * r * r) / uZoom;
  d *= f;
  d.x /= uAspect;
  vec2 uv = c + d;
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) { gl_FragColor = vec4(0.0); return; }
  gl_FragColor = texture2D(uTex, uv);
}`;

class FisheyeRenderer implements LayerRenderer {
  private runner = new ShaderRunner(FRAG);
  resize(w: number, h: number): void { this.runner.resize(w, h); }
  render(frame: RenderFrame): HTMLCanvasElement | null {
    const bd = frame.backdrop;
    if (!bd) return null;
    if (!this.runner.available) return bd;
    this.runner.resize(frame.width, frame.height);
    const p = frame.props;
    const c = vec2n(p.center, 0.5, 0.5);
    return this.runner.render(bd, {
      uStrength: num(p.strength, 0.6),
      uZoom: num(p.zoom, 1),
      uAspect: frame.width / frame.height,
      uCenter: [c[0], c[1]],
    });
  }
  dispose(): void { this.runner.dispose(); }
}

export const fisheyeLayerType: LayerTypeDefinition = {
  type: "fx.fisheye",
  label: "Fisheye",
  category: "Effects",
  icon: "Aperture",
  kind: "effect",
  description: "Lens/barrel distortion of the layers below.",
  schema: [
    { key: "strength", name: "Strength", type: "number", default: 0.6, group: "Fisheye", meta: { min: -1, max: 2, step: 0.01 } },
    { key: "zoom", name: "Zoom", type: "number", default: 1, group: "Fisheye", meta: { min: 0.4, max: 2.5, step: 0.01 } },
    { key: "center", name: "Center (0-1)", type: "point", default: [0.5, 0.5], group: "Fisheye", meta: { step: 0.01 } },
  ],
  createRenderer: () => new FisheyeRenderer(),
};
