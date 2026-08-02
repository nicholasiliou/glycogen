import { Plugin, type Frame } from "@/plugins/Plugin";
import { ShaderRunner } from "./ShaderRunner";

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

/** Palette (constant  -  colour pickers have no control-kind in the new model). */
const PALETTE = {
  uC0: [0.75, 0.99, 0.02],
  uC1: [0.92, 0.01, 0.49],
  uC2: [0.21, 0.0, 0.98],
  uC3: [1.0, 0.33, 0.0],
  uC4: [0.04, 0.04, 0.05],
  uC5: [0.94, 0.94, 0.94],
};

export class ColorLookupLayer extends Plugin {
  count = this.number({ min: 1, max: 6, step: 1, default: 6 });
  amount = this.number({ min: 0, max: 1, default: 1 });

  private runner = new ShaderRunner(FRAG);

  resize(w: number, h: number): void { this.runner.resize(w, h); }

  render(f: Frame): HTMLCanvasElement | null {
    const bd = f.input;
    if (!bd) return null;
    if (!this.runner.available) return bd;
    this.runner.resize(f.width, f.height);
    return this.runner.render(bd, {
      ...PALETTE,
      uCount: Math.max(1, Math.min(6, Math.round(this.count.value))),
      uMix: Math.max(0, Math.min(1, this.amount.value)),
    });
  }

  dispose(): void { this.runner.dispose(); }
}
