import { Plugin, type Frame } from "@/plugins/Plugin";
import { ShaderRunner } from "./ShaderRunner";

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

export class PixelStretchLayer extends Plugin {
  threshold = this.number({ min: 0, max: 1, default: 0.5 });
  amount = this.number({ min: 0, max: 1, default: 0.1 });
  horizontal = this.toggle();

  private runner = new ShaderRunner(FRAG);

  resize(w: number, h: number): void { this.runner.resize(w, h); }

  render(f: Frame): HTMLCanvasElement | null {
    const bd = f.input;
    if (!bd) return null;
    if (!this.runner.available) return bd;
    this.runner.resize(f.width, f.height);
    return this.runner.render(bd, {
      uResolution: [f.width, f.height],
      uThreshold: this.threshold.value,
      uAmount: this.amount.value,
      uHorizontal: this.horizontal.on ? 1 : 0,
    });
  }

  dispose(): void { this.runner.dispose(); }
}
