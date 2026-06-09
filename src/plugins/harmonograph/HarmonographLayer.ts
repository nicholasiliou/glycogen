import type { LayerTypeDefinition } from "../../engine/plugins/Registry";
import type { LayerRenderer, RenderFrame } from "../../engine/render/types";

function num(v: unknown, fallback: number): number {
  return typeof v === "number" ? v : fallback;
}
function rgba(v: unknown, fallback = "rgba(192,252,4,1)"): string {
  if (!Array.isArray(v)) return fallback;
  const [r, g, b, a] = v as number[];
  return `rgba(${r ?? 0},${g ?? 0},${b ?? 0},${(a ?? 255) / 255})`;
}

/**
 * A harmonograph: two damped oscillators per axis trace spirograph-like curves —
 * an oscilloscope/EGA vibe that sits naturally next to the plant. Fully parametric
 * and deterministic (no RNG): animate `phase` to make the figure breathe and morph.
 * Pure 2D canvas, so it needs no p5.
 */
class HarmonographRenderer implements LayerRenderer {
  private canvas = document.createElement("canvas");
  private ctx = this.canvas.getContext("2d")!;

  resize(w: number, h: number): void {
    this.canvas.width = Math.max(1, w);
    this.canvas.height = Math.max(1, h);
  }

  render(frame: RenderFrame): HTMLCanvasElement {
    if (this.canvas.width !== frame.width) this.resize(frame.width, frame.height);
    const ctx = this.ctx;
    const W = this.canvas.width;
    const H = this.canvas.height;
    ctx.clearRect(0, 0, W, H);

    const p = frame.props;
    const fX1 = num(p.freqX1, 3);
    const fY1 = num(p.freqY1, 2);
    const fX2 = num(p.freqX2, 5);
    const fY2 = num(p.freqY2, 4);
    const phase = (num(p.phase, 0) * Math.PI) / 180;
    const damping = Math.max(0, num(p.damping, 0.6)) * 0.02;
    const points = Math.max(64, Math.round(num(p.points, 6000)));
    const cycles = Math.max(1, num(p.cycles, 12));

    const scale = (Math.min(W, H) * 0.46) / 2; // /2 because two unit sines sum to ±2
    const cx = W / 2;
    const cy = H / 2;
    const dt = (cycles * Math.PI * 2) / points;

    ctx.beginPath();
    for (let i = 0; i <= points; i++) {
      const tt = i * dt;
      const env = Math.exp(-damping * tt);
      const x = (Math.sin(fX1 * tt + phase) + Math.sin(fX2 * tt)) * env;
      const y = (Math.sin(fY1 * tt) + Math.sin(fY2 * tt + phase)) * env;
      const px = cx + x * scale;
      const py = cy + y * scale;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.strokeStyle = rgba(p.color);
    ctx.lineWidth = Math.max(0.5, num(p.lineWidth, 2));
    ctx.lineJoin = "round";
    ctx.globalCompositeOperation = num(p.glow, 0) > 0 ? "lighter" : "source-over";
    ctx.stroke();
    return this.canvas;
  }

  dispose(): void {
    this.canvas.width = this.canvas.height = 0;
  }
}

export const harmonographLayerType: LayerTypeDefinition = {
  type: "harmonograph",
  label: "Harmonograph",
  category: "Generators",
  icon: "Waves",
  description: "Damped Lissajous / oscilloscope curves. Animate the phase to morph it.",
  defaultSize: (comp) => [comp.width, comp.height],
  schema: [
    { key: "color", name: "Color", type: "color", default: [192, 252, 4, 255], group: "Harmonograph" },
    { key: "lineWidth", name: "Line Width", type: "number", default: 2, group: "Harmonograph", meta: { min: 0.5, max: 20, step: 0.5 } },
    { key: "phase", name: "Phase", type: "angle", default: 0, group: "Harmonograph", meta: { step: 1, unit: "°" } },
    { key: "freqX1", name: "Freq X1", type: "number", default: 3, group: "Frequencies", meta: { min: 1, max: 24, step: 1 } },
    { key: "freqY1", name: "Freq Y1", type: "number", default: 2, group: "Frequencies", meta: { min: 1, max: 24, step: 1 } },
    { key: "freqX2", name: "Freq X2", type: "number", default: 5, group: "Frequencies", meta: { min: 1, max: 24, step: 1 } },
    { key: "freqY2", name: "Freq Y2", type: "number", default: 4, group: "Frequencies", meta: { min: 1, max: 24, step: 1 } },
    { key: "damping", name: "Damping", type: "percent", default: 0.6, group: "Shape", meta: { min: 0, max: 5, step: 0.05 } },
    { key: "cycles", name: "Cycles", type: "number", default: 12, group: "Shape", meta: { min: 1, max: 60, step: 1 } },
    { key: "points", name: "Resolution", type: "number", default: 6000, group: "Shape", meta: { min: 256, max: 24000, step: 256 } },
    { key: "glow", name: "Additive Glow", type: "boolean", default: false, group: "Shape" },
  ],
  createRenderer: () => new HarmonographRenderer(),
};
