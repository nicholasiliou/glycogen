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
  private runner = new ShaderRunner(FRAG);
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
