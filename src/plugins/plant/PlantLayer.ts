import P5 from "p5";
import type { Layer } from "../../engine/scene/Layer";
import type { LayerTypeDefinition } from "../../engine/plugins/Registry";
import type { LayerRenderer, RenderFrame, RenderHost } from "../../engine/render/types";
import { Phi, drawTurtle, generateSystem, randomEGAColor } from "./plantSketch";

// p5.sound expects a global `p5`. Register it. The addon itself is loaded LAZILY, only
// when a plant actually opts into audio (audioReactive) — so the default audio-off path
// (and exported interactive apps) never pull in / initialise the audio backend.
if (typeof window !== "undefined") {
  (window as any).p5 = (window as any).p5 ?? P5;
}

function num(v: unknown, fallback: number): number {
  return typeof v === "number" ? v : fallback;
}

function applyTint(p: P5, col: P5.Color, tint: unknown): P5.Color {
  if (!Array.isArray(tint) || (tint[0] === 255 && tint[1] === 255 && tint[2] === 255)) {
    return col;
  }
  return p.color(
    (p.red(col) * (tint[0] ?? 255)) / 255,
    (p.green(col) * (tint[1] ?? 255)) / 255,
    (p.blue(col) * (tint[2] ?? 255)) / 255,
  );
}

/**
 * Renders the plant into an offscreen p5 WEBGL canvas, composited by the engine.
 *
 * Behaviour change (by request): the plant is now **deterministic from a `seed`** and
 * does NOT mutate on its own. The same seed always yields the same plant; change/animate
 * `seed` (keyframes or an expression) to make it evolve. `autoEvolve` (off by default)
 * advances the seed with composition time for those who want the old "always changing"
 * feel — and it does so deterministically, so it still scrubs and exports frame-accurately.
 *
 * The grammar / palette / Phi / turtle maths are still the original, untouched.
 */
class PlantRenderer implements LayerRenderer {
  private p?: P5;
  private container: HTMLDivElement;
  private glCanvas?: HTMLCanvasElement;

  private w = 1920;
  private h = 1080;

  // ----- preserved sketch state (now seed-deterministic) -----
  private sentence = "F";
  private len = 80;
  private angle = 0;
  private baseCol?: P5.Color;
  private lastSeed = NaN;
  private lastIterations = -1;

  // ----- optional audio (faithful oscillator, opt-in & lazily loaded) -----
  private osc?: any;
  private audioReady = false;
  private soundLoading = false;

  // ----- per-frame plumbing -----
  private frame?: RenderFrame;
  private forceInitial = true;
  private lastFrame = -1;
  private lastKey = "";

  constructor(_layer: Layer, host: RenderHost) {
    this.container = document.createElement("div");
    host.offscreenContainer.appendChild(this.container);
    this.p = new P5((p: P5) => this.attach(p), this.container);
  }

  private attach(p: P5): void {
    p.setup = () => {
      p.createCanvas(this.w, this.h, p.WEBGL);
      p.setAttributes("preserveDrawingBuffer", true);
      this.glCanvas = (p as any).drawingContext.canvas as HTMLCanvasElement;
      p.noLoop();
      this.angle = p.radians(35);
    };

    p.draw = () => {
      const props = this.frame?.props ?? {};
      const t = this.frame?.time ?? 0;
      const fcount = this.frame?.frame ?? 0;

      const cameraScale = num(props.cameraScale, 3);
      const spinSpeed = num(props.spinSpeed, 0.06);
      const iterations = Math.round(num(props.iterations, 4));
      const seed = num(props.seed, 1);
      const autoEvolve = props.autoEvolve === true;
      const evolutionSpeed = Math.max(0.01, num(props.evolutionSpeed, 1));
      const opaque = props.opaqueBackground !== false;
      const tint = props.tint;

      const effectiveSeed = Math.floor(seed + (autoEvolve ? t * evolutionSpeed : 0));

      p.scale(cameraScale);
      if (opaque) p.background(0);
      else p.clear();

      // Regenerate ONLY when the (effective) seed or iteration count changes — i.e. never,
      // unless the user/animation drives it. Reseeding makes the whole plant deterministic.
      if (effectiveSeed !== this.lastSeed || iterations !== this.lastIterations || !this.baseCol) {
        p.randomSeed(effectiveSeed);
        const g = generateSystem(p, iterations);
        this.sentence = g.sentence;
        this.len = g.len;
        this.baseCol = randomEGAColor(p);
        if (this.osc) this.osc.setType(p.random(["triangle", "sawtooth", "square", "sine"]));
        this.lastSeed = effectiveSeed;
        this.lastIterations = iterations;
      }

      const phi = Phi(this.sentence);

      if (this.osc) {
        const freqBase = p.map(phi.energy, 1, 10000, 10, 100, true);
        const currentFreq = this.osc.getFreq ? this.osc.getFreq() : freqBase;
        const freq = p.lerp(currentFreq, freqBase, 0.06);
        const ampTarget = p.map(phi.chaos + phi.branches, 0, 600, 0.02, 0.12, true);
        const currentAmp = this.osc.getAmp ? this.osc.getAmp() : ampTarget;
        const amp = p.lerp(currentAmp, ampTarget, 0.55);
        this.osc.freq(freq);
        this.osc.amp(amp, p.random(0.1, 10));
      }

      this.angle = p.map(phi.rotation, 0, 100, p.radians(10), p.radians(60));

      // Spin is driven by the COMPOSITION frame (not p5's internal counter) so it scrubs
      // and exports deterministically. Set Spin Speed to 0 for a perfectly still plant.
      p.rotateX(0.01);
      p.rotateY(fcount * spinSpeed);

      drawTurtle(p, this.sentence, applyTint(p, this.baseCol, tint), this.len, this.angle);
    };
  }

  /** Lazily pull in p5.sound the first time audio is requested, then wire the oscillator. */
  private ensureAudio(): void {
    if (this.audioReady || this.soundLoading) return;
    this.soundLoading = true;
    import("p5/lib/addons/p5.sound.js")
      .then(() => this.initAudio())
      .catch(() => {
        this.audioReady = true; // give up gracefully — visuals only
      });
  }

  private initAudio(): void {
    try {
      (this.p as any)?.userStartAudio?.();
      const Sound: any = (window as any).p5;
      if (Sound?.Oscillator && !this.osc) {
        this.osc = new Sound.Oscillator("sawtooth");
        this.osc.start();
        this.osc.amp(0);
      }
    } catch {
      /* visuals only */
    }
    this.audioReady = true;
  }

  render(frame: RenderFrame): HTMLCanvasElement | null {
    this.frame = frame;
    if (!this.p || !this.glCanvas) return null;

    const audioReactive = frame.props.audioReactive === true;
    if (frame.playing && audioReactive) this.ensureAudio();
    if ((!frame.playing || !audioReactive) && this.osc) {
      try {
        this.osc.amp(0, 0.1);
      } catch {
        /* ignore */
      }
    }

    const p = frame.props;
    const key = [
      p.cameraScale, p.spinSpeed, p.iterations, p.seed, p.autoEvolve, p.evolutionSpeed,
      Array.isArray(p.tint) ? p.tint.join(",") : p.tint, p.opaqueBackground, audioReactive,
    ].join("|");

    // Redraw on: first frame, the comp frame advancing (scrub/play → spin), or any control change.
    const shouldDraw = this.forceInitial || frame.frame !== this.lastFrame || frame.playing || key !== this.lastKey;
    this.lastFrame = frame.frame;
    this.lastKey = key;
    if (shouldDraw) {
      this.forceInitial = false;
      this.p.redraw();
    }
    return this.glCanvas;
  }

  resize(width: number, height: number): void {
    this.w = width;
    this.h = height;
    if (this.p && this.glCanvas) {
      this.p.resizeCanvas(width, height);
      this.forceInitial = true;
    }
  }

  dispose(): void {
    try {
      this.osc?.stop?.();
    } catch {
      /* ignore */
    }
    this.p?.remove();
    this.container.remove();
    this.p = undefined;
  }
}

export const plantLayerType: LayerTypeDefinition = {
  type: "plant",
  label: "Plant",
  category: "Generators",
  icon: "Sprout",
  description: "Deterministic, seed-driven L-system turtle plant (the original sketch).",
  defaultSize: (comp) => [comp.width, comp.height],
  schema: [
    { key: "seed", name: "Seed", type: "number", default: 1, group: "Plant", meta: { min: 0, max: 99999, step: 1 } },
    { key: "iterations", name: "Iterations", type: "number", default: 4, group: "Plant", meta: { min: 1, max: 6, step: 1 } },
    { key: "cameraScale", name: "Camera Scale", type: "number", default: 3, group: "Plant", meta: { min: 0.5, max: 12, step: 0.1 } },
    { key: "spinSpeed", name: "Spin Speed", type: "number", default: 0.06, group: "Plant", meta: { min: -0.5, max: 0.5, step: 0.005 } },
    { key: "tint", name: "Tint", type: "color", default: [255, 255, 255, 255], group: "Plant" },
    { key: "opaqueBackground", name: "Opaque Background", type: "boolean", default: false, group: "Plant" },
    { key: "autoEvolve", name: "Auto-Evolve", type: "boolean", default: false, group: "Evolution" },
    { key: "evolutionSpeed", name: "Evolution Speed", type: "number", default: 1, group: "Evolution", meta: { min: 0.1, max: 10, step: 0.1 } },
    { key: "audioReactive", name: "Audio Reactive (oscillator)", type: "boolean", default: false, group: "Audio" },
  ],
  createRenderer: (layer, host) => new PlantRenderer(layer, host),
};
