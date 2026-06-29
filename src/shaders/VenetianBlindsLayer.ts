import { Plugin, type Frame } from "@/plugins/Plugin";
import { ShaderRunner } from "./ShaderRunner";

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

export class VenetianBlindsLayer extends Plugin {
  bands = this.knob(0, { min: 1, max: 40, step: 1, default: 8 });
  offset = this.knob(1, { min: 0, max: 1, default: 0 });
  angle = this.fader(0, { min: -180, max: 180, default: 0 });
  fade = this.knob(2, { min: 0, max: 0.49, default: 0.05 });

  private runner = new ShaderRunner(FRAG);

  resize(w: number, h: number): void { this.runner.resize(w, h); }

  render(f: Frame): HTMLCanvasElement | null {
    const bd = f.input;
    if (!bd) return null;
    if (!this.runner.available) return bd;
    this.runner.resize(f.width, f.height);
    return this.runner.render(bd, {
      uBands: Math.max(1, this.bands.value),
      uOffset: this.offset.value,
      uAngle: this.angle.value,
      uFade: Math.max(0, Math.min(0.49, this.fade.value)),
    });
  }

  dispose(): void { this.runner.dispose(); }
}
