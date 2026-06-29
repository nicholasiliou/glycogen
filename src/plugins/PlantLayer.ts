import P5 from "p5";
import { Plugin, type Frame } from "./Plugin";
import { Phi, drawTurtle, generateSystem, randomEGAColor } from "./plantSketch";

if (typeof window !== "undefined") {
  (window as unknown as { p5?: unknown }).p5 = (window as unknown as { p5?: unknown }).p5 ?? P5;
}

/**
 * An L-system plant rendered into a self-hosted offscreen p5 WEBGL canvas. Deterministic from
 * `seed` — the same seed always yields the same plant; turn `autoEvolve` on to advance the seed
 * with time. Grammar / palette / Phi / turtle maths are the original sketch's, untouched.
 */
export class PlantLayer extends Plugin {
  iterations = this.knob(0, { min: 1, max: 7, step: 1, default: 4 });
  cameraScale = this.knob(1, { min: 0.5, max: 8, default: 3 });
  spinSpeed = this.knob(2, { min: 0, max: 0.5, default: 0.06 });
  evolutionSpeed = this.knob(3, { min: 0.01, max: 4, default: 1 });
  seed = this.fader(0, { min: 1, max: 64, step: 1, default: 1 });
  autoEvolve = this.pad(4);
  opaque = this.pad(5);

  private p?: P5;
  private container: HTMLDivElement;
  private glCanvas?: HTMLCanvasElement;
  private w = 1920;
  private h = 1080;
  private sentence = "F";
  private len = 80;
  private angle = 0;
  private baseCol?: P5.Color;
  private lastSeed = NaN;
  private lastIterations = -1;
  private frameCount = 0;
  private frameTime = 0;

  constructor() {
    super();
    this.opaque.on = true;
    this.container = document.createElement("div");
    Object.assign(this.container.style, { position: "fixed", left: "-99999px", top: "0", width: "0", height: "0", overflow: "hidden" });
    if (typeof document !== "undefined") document.body.appendChild(this.container);
    this.p = new P5((p: P5) => this.attach(p), this.container);
  }

  private attach(p: P5): void {
    p.setup = () => {
      p.createCanvas(this.w, this.h, p.WEBGL);
      p.setAttributes("preserveDrawingBuffer", true);
      this.glCanvas = (p as unknown as { drawingContext: { canvas: HTMLCanvasElement } }).drawingContext.canvas;
      p.noLoop();
      this.angle = p.radians(35);
    };

    p.draw = () => {
      const iterations = Math.round(this.iterations.value);
      const seed = this.seed.value;
      const effectiveSeed = Math.floor(seed + (this.autoEvolve.on ? this.frameTime * this.evolutionSpeed.value : 0));

      p.scale(this.cameraScale.value);
      if (this.opaque.on) p.background(0);
      else p.clear();

      if (effectiveSeed !== this.lastSeed || iterations !== this.lastIterations || !this.baseCol) {
        p.randomSeed(effectiveSeed);
        const g = generateSystem(p, iterations);
        this.sentence = g.sentence;
        this.len = g.len;
        this.baseCol = randomEGAColor(p);
        this.lastSeed = effectiveSeed;
        this.lastIterations = iterations;
      }

      const phi = Phi(this.sentence);
      this.angle = p.map(phi.rotation, 0, 100, p.radians(10), p.radians(60));
      p.rotateX(0.01);
      p.rotateY(this.frameCount * this.spinSpeed.value);
      drawTurtle(p, this.sentence, this.baseCol!, this.len, this.angle);
    };
  }

  render(f: Frame): HTMLCanvasElement | null {
    if (!this.p || !this.glCanvas) return null;
    this.frameTime = f.time;
    this.frameCount++;
    this.p.redraw();
    return this.glCanvas;
  }

  resize(width: number, height: number): void {
    this.w = width;
    this.h = height;
    if (this.p && this.glCanvas) this.p.resizeCanvas(width, height);
  }

  dispose(): void {
    this.p?.remove();
    this.container.remove();
    this.p = undefined;
  }
}
