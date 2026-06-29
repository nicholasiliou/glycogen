import { Plugin, type Frame } from "@/plugins/Plugin";
import { ShaderRunner } from "./ShaderRunner";

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

export class FisheyeLayer extends Plugin {
  strength = this.knob(0, { min: -2, max: 2, default: 0.6 });
  zoom = this.knob(1, { min: 0.2, max: 3, default: 1 });

  private runner = new ShaderRunner(FRAG);

  resize(w: number, h: number): void { this.runner.resize(w, h); }

  render(f: Frame): HTMLCanvasElement | null {
    const bd = f.input;
    if (!bd) return null;
    if (!this.runner.available) return bd;
    this.runner.resize(f.width, f.height);
    return this.runner.render(bd, {
      uStrength: this.strength.value,
      uZoom: this.zoom.value,
      uAspect: f.width / f.height,
      uCenter: [0.5, 0.5],
    });
  }

  dispose(): void { this.runner.dispose(); }
}
