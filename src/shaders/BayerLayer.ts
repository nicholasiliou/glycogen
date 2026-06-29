import { Plugin, type Frame } from "@/plugins/Plugin";
import { ShaderRunner } from "./ShaderRunner";

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

export class BayerLayer extends Plugin {
  levels = this.knob(0, { min: 2, max: 8, step: 1, default: 4 });
  scale = this.knob(1, { min: 1, max: 8, step: 1, default: 1 });
  colored = this.pad(4);

  private runner = new ShaderRunner(FRAG);

  resize(w: number, h: number): void { this.runner.resize(w, h); }

  render(f: Frame): HTMLCanvasElement | null {
    const bd = f.input;
    if (!bd) return null;
    if (!this.runner.available) return bd;
    this.runner.resize(f.width, f.height);
    return this.runner.render(bd, {
      uResolution: [f.width, f.height],
      uLevels: this.levels.value,
      uScale: Math.max(1, this.scale.value),
      uColored: this.colored.on ? 1 : 0,
    });
  }

  dispose(): void { this.runner.dispose(); }
}
