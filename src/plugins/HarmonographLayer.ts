import { Plugin, type Frame } from "./Plugin";

/**
 * A harmonograph: two damped oscillators per axis trace spirograph-like curves — an oscilloscope /
 * EGA vibe. Fully parametric and deterministic; animate `phase` to make the figure breathe.
 */
export class HarmonographLayer extends Plugin {
  freqX1 = this.knob(0, { min: 1, max: 12, default: 3 });
  freqY1 = this.knob(1, { min: 1, max: 12, default: 2 });
  freqX2 = this.knob(2, { min: 1, max: 12, default: 5 });
  freqY2 = this.knob(3, { min: 1, max: 12, default: 4 });
  phaseSpeed = this.knob(4, { min: 0, max: 4, default: 0.5 });
  damping = this.knob(5, { min: 0, max: 1, default: 0.6 });
  cycles = this.knob(6, { min: 1, max: 24, step: 1, default: 12 });
  lineWidth = this.knob(7, { min: 0.5, max: 8, default: 2 });
  phase = this.fader(0, { min: 0, max: 360, default: 0 });

  private ctx = this.canvas.getContext("2d")!;

  render(f: Frame): HTMLCanvasElement {
    const ctx = this.ctx;
    const W = this.canvas.width, H = this.canvas.height;
    ctx.clearRect(0, 0, W, H);

    const phase = ((this.phase.value + f.time * this.phaseSpeed.value) * Math.PI) / 180;
    const damping = Math.max(0, this.damping.value) * 0.02;
    const points = 6000;
    const cycles = Math.max(1, this.cycles.value);

    const scale = (Math.min(W, H) * 0.46) / 2;
    const cx = W / 2, cy = H / 2;
    const step = (cycles * Math.PI * 2) / points;

    ctx.beginPath();
    for (let i = 0; i <= points; i++) {
      const tt = i * step;
      const env = Math.exp(-damping * tt);
      const x = (Math.sin(this.freqX1.value * tt + phase) + Math.sin(this.freqX2.value * tt)) * env;
      const y = (Math.sin(this.freqY1.value * tt) + Math.sin(this.freqY2.value * tt + phase)) * env;
      const px = cx + x * scale, py = cy + y * scale;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.strokeStyle = "rgba(192,252,4,1)";
    ctx.lineWidth = Math.max(0.5, this.lineWidth.value);
    ctx.lineJoin = "round";
    ctx.stroke();
    ctx.globalCompositeOperation = "source-over";
    return this.canvas;
  }
}
