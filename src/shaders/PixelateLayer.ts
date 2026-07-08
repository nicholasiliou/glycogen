import { Plugin, type Frame } from "@/plugins/Plugin";
import { ShaderRunner } from "./ShaderRunner";

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

/**
 * Reference effect port. Reads the layers below via `frame.input` (was `frame.backdrop`) and
 * post-processes them with the unchanged {@link ShaderRunner}. Its one parameter is a bound knob.
 */
export class PixelateLayer extends Plugin {
  size = this.number({ min: 1, max: 64, step: 1, default: 8 });

  private runner = new ShaderRunner(FRAG);

  resize(w: number, h: number): void {
    this.runner.resize(w, h);
  }

  render(f: Frame): HTMLCanvasElement | null {
    const bd = f.input;
    if (!bd) return null;
    if (!this.runner.available) return bd;
    this.runner.resize(f.width, f.height);
    return this.runner.render(bd, {
      uResolution: [f.width, f.height],
      uSize: Math.max(1, this.size.value),
    });
  }

  dispose(): void {
    this.runner.dispose();
  }
}
