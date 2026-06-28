import type { LayerTypeDefinition } from "../engine/plugins/Registry";
import type { LayerRenderer, RenderFrame } from "../engine/render/types";
import { ShaderRunner } from "./ShaderRunner";

function num(v: unknown, f: number): number {
  return typeof v === "number" ? v : f;
}
function rgb01(v: unknown, f: [number, number, number]): [number, number, number] {
  if (!Array.isArray(v)) return f;
  return [(v[0] ?? 0) / 255, (v[1] ?? 0) / 255, (v[2] ?? 0) / 255];
}

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

class AsciiRenderer implements LayerRenderer {
  private runner = new ShaderRunner(FRAG, ["uGlyph"]);
  private atlasSet = false;
  resize(w: number, h: number): void { this.runner.resize(w, h); }
  render(frame: RenderFrame): HTMLCanvasElement | null {
    const bd = frame.backdrop;
    if (!bd) return null;
    if (!this.runner.available) return bd;
    if (!this.atlasSet) {
      this.runner.setTexture("uGlyph", buildAsciiAtlas());
      this.atlasSet = true;
    }
    this.runner.resize(frame.width, frame.height);
    const p = frame.props;
    const col = rgb01(p.color, [0.75, 1, 0.02]);
    return this.runner.render(bd, {
      uResolution: [frame.width, frame.height],
      uCell: Math.max(4, num(p.cell, 12)),
      uCount: ASCII_CHARS.length,
      uColored: p.colored ? 1 : 0,
      uColor: col,
    });
  }
  dispose(): void { this.runner.dispose(); }
}

export const asciiLayerType: LayerTypeDefinition = {
  type: "fx.ascii",
  label: "ASCII",
  category: "Effects",
  icon: "Hash",
  kind: "effect",
  description: "Renders the layers below as ASCII glyphs by luminance.",
  schema: [
    { key: "cell", name: "Cell Size", type: "number", default: 12, group: "ASCII", meta: { min: 4, max: 64, step: 1 } },
    { key: "colored", name: "Use Source Color", type: "boolean", default: false, group: "ASCII" },
    { key: "color", name: "Ink Color", type: "color", default: [192, 252, 4, 255], group: "ASCII" },
  ],
  createRenderer: () => new AsciiRenderer(),
};
