import { Plugin, type Frame } from "@/plugins/Plugin";
import { ShaderRunner } from "./ShaderRunner";

const FRAG = `
precision highp float;
varying vec2 vUv;
uniform sampler2D uTex;
uniform sampler2D uGlyph;
uniform vec2 uResolution;
uniform float uCell;
uniform float uCount;
uniform float uColored;
uniform vec3 uColor;
void main() {
  vec2 res = uResolution;
  vec2 pix = vUv * res;
  vec2 cell = floor(pix / uCell);
  vec2 cellCenter = (cell + 0.5) * uCell / res;
  vec3 src = texture2D(uTex, cellCenter).rgb;
  float lum = dot(src, vec3(0.299, 0.587, 0.114));
  float idx = floor(clamp(lum, 0.0, 0.999) * uCount);
  vec2 inCell = fract(pix / uCell);
  vec2 g = vec2((idx + inCell.x) / uCount, 1.0 - inCell.y);
  float a = texture2D(uGlyph, g).r;
  vec3 col = mix(uColor, src, uColored);
  gl_FragColor = vec4(col * a, a);
}`;

const ASCII_CHARS = " .:-=+*#%@";

function buildAsciiAtlas(): HTMLCanvasElement {
  const cw = 18;
  const ch = 28;
  const canvas = document.createElement("canvas");
  canvas.width = ASCII_CHARS.length * cw;
  canvas.height = ch;
  const ctx = canvas.getContext("2d")!;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#fff";
  ctx.font = `bold ${Math.round(ch * 0.82)}px ui-monospace, monospace`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (let i = 0; i < ASCII_CHARS.length; i++) {
    ctx.fillText(ASCII_CHARS[i], i * cw + cw / 2, ch / 2);
  }
  return canvas;
}

export class AsciiLayer extends Plugin {
  cell = this.knob(0, { min: 4, max: 40, step: 1, default: 12 });
  colored = this.pad(4);

  private runner = new ShaderRunner(FRAG, ["uGlyph"]);
  private atlasSet = false;

  resize(w: number, h: number): void { this.runner.resize(w, h); }

  render(f: Frame): HTMLCanvasElement | null {
    const bd = f.input;
    if (!bd) return null;
    if (!this.runner.available) return bd;
    if (!this.atlasSet) {
      this.runner.setTexture("uGlyph", buildAsciiAtlas());
      this.atlasSet = true;
    }
    this.runner.resize(f.width, f.height);
    return this.runner.render(bd, {
      uResolution: [f.width, f.height],
      uCell: Math.max(4, this.cell.value),
      uCount: ASCII_CHARS.length,
      uColored: this.colored.on ? 1 : 0,
      uColor: [0.75, 1, 0.02],
    });
  }

  dispose(): void { this.runner.dispose(); }
}
