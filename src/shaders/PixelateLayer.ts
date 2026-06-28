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
uniform float uSize;
void main() {
  vec2 blocks = uResolution / uSize;
  vec2 uv = (floor(vUv * blocks) + 0.5) / blocks;
  gl_FragColor = texture2D(uTex, uv);
}`;

class PixelateRenderer implements LayerRenderer {
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
