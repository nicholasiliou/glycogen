import type { LayerTypeDefinition } from "../../engine/plugins/Registry";
import type { LayerRenderer, RenderFrame } from "../../engine/render/types";
import { ShaderRunner } from "./ShaderRunner";

function num(v: unknown, f: number): number {
  return typeof v === "number" ? v : f;
}
function vec2n(v: unknown, fx: number, fy: number): [number, number] {
  return Array.isArray(v) ? [(v[0] as number) ?? fx, (v[1] as number) ?? fy] : [fx, fy];
}
function rgb01(v: unknown, f: [number, number, number]): [number, number, number] {
  if (!Array.isArray(v)) return f;
  return [(v[0] ?? 0) / 255, (v[1] ?? 0) / 255, (v[2] ?? 0) / 255];
}

// ───────────────────────────── Fisheye ─────────────────────────────

const FISHEYE_FRAG = `
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

class FisheyeRenderer implements LayerRenderer {
  private runner = new ShaderRunner(FISHEYE_FRAG);
  resize(w: number, h: number): void {
    this.runner.resize(w, h);
  }
  render(frame: RenderFrame): HTMLCanvasElement | null {
    const bd = frame.backdrop;
    if (!bd) return null;
    if (!this.runner.available) return bd;
    this.runner.resize(frame.width, frame.height);
    const p = frame.props;
    const c = vec2n(p.center, 0.5, 0.5);
    return this.runner.render(bd, {
      uStrength: num(p.strength, 0.6),
      uZoom: num(p.zoom, 1),
      uAspect: frame.width / frame.height,
      uCenter: [c[0], c[1]],
    });
  }
  dispose(): void {
    this.runner.dispose();
  }
}

export const fisheyeLayerType: LayerTypeDefinition = {
  type: "fx.fisheye",
  label: "Fisheye",
  category: "Effects",
  icon: "Aperture",
  kind: "effect",
  description: "Lens/barrel distortion of the layers below.",
  schema: [
    { key: "strength", name: "Strength", type: "number", default: 0.6, group: "Fisheye", meta: { min: -1, max: 2, step: 0.01 } },
    { key: "zoom", name: "Zoom", type: "number", default: 1, group: "Fisheye", meta: { min: 0.4, max: 2.5, step: 0.01 } },
    { key: "center", name: "Center (0-1)", type: "point", default: [0.5, 0.5], group: "Fisheye", meta: { step: 0.01 } },
  ],
  createRenderer: () => new FisheyeRenderer(),
};

// ───────────────────────────── ASCII ─────────────────────────────

const ASCII_FRAG = `
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
  private runner = new ShaderRunner(ASCII_FRAG, ["uGlyph"]);
  private atlasSet = false;
  resize(w: number, h: number): void {
    this.runner.resize(w, h);
  }
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
  dispose(): void {
    this.runner.dispose();
  }
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
