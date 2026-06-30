import type { ControlBus } from "@/controls/ControlBus";
import { clamp01 } from "@/controls/types";
import type { FieldFn, Frame, Plugin } from "@/plugins/Plugin";

export type DeckName = "A" | "B";
/** One deck: a set of banks (loaded generators) and which one is currently active. */
export interface DeckState {
  banks: (Plugin | null)[];
  active: number;
}
/** What the controller is currently driving: a deck's active bank, or the full-canvas shader. */
export type Focus = DeckName | "shader";

export const BANK_COUNT = 3;

/**
 * The runtime host and compositor. Reproduces the old engine's live composition: two decks (A/B),
 * each holding up to {@link BANK_COUNT} generator plugins with one active bank, blended by an
 * equal-power crossfade, with a single full-canvas effect ("shader") on top. Each frame it pulls
 * live control values into the *focused* plugin's params, renders the active banks + shader, and
 * composites to the output canvas.
 */
export class Stage {
  readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private buffer = document.createElement("canvas");
  private bctx = this.buffer.getContext("2d")!;

  readonly decks: Record<DeckName, DeckState> = {
    A: { banks: Array(BANK_COUNT).fill(null), active: 0 },
    B: { banks: Array(BANK_COUNT).fill(null), active: 0 },
  };
  crossfade = 0.5;
  shader: Plugin | null = null;
  focus: Focus = "A";

  // Per-deck compositor canvas: each bank's output is drawn here in source-over order.
  private deckCanvas: Record<DeckName, HTMLCanvasElement> = {
    A: document.createElement("canvas"),
    B: document.createElement("canvas"),
  };
  private deckCtx: Record<DeckName, CanvasRenderingContext2D> = {
    A: this.deckCanvas.A.getContext("2d")!,
    B: this.deckCanvas.B.getContext("2d")!,
  };

  private raf = 0;
  private startT = 0;
  private lastT = 0;

  constructor(private bus: ControlBus, canvas?: HTMLCanvasElement) {
    this.canvas = canvas ?? document.createElement("canvas");
    this.ctx = this.canvas.getContext("2d")!;
  }

  // ── composition ──────────────────────────────────────────────────────────────────────────────
  active(deck: DeckName): Plugin | null {
    const d = this.decks[deck];
    return d.banks[d.active];
  }

  /** The plugin whose param labels the controller surface shows right now. */
  managed(): Plugin | null {
    return this.focus === "shader" ? this.shader : this.active(this.focus);
  }

  /** Every currently-loaded plugin (all banks in both decks + the shader), for live param pulls. */
  private loaded(): Plugin[] {
    const out: Plugin[] = [];
    for (const deck of ["A", "B"] as const) {
      for (const p of this.decks[deck].banks) if (p) out.push(p);
    }
    if (this.shader) out.push(this.shader);
    return out;
  }

  loadBank(deck: DeckName, index: number, plugin: Plugin): void {
    const d = this.decks[deck];
    d.banks[index]?.dispose();
    plugin.resize(this.canvas.width, this.canvas.height);
    d.banks[index] = plugin;
    d.active = index;
  }

  selectBank(deck: DeckName, index: number): void {
    if (this.decks[deck].banks[index]) this.decks[deck].active = index;
  }

  clearBank(deck: DeckName): void {
    const d = this.decks[deck];
    d.banks[d.active]?.dispose();
    d.banks[d.active] = null;
  }

  setShader(plugin: Plugin | null): void {
    if (this.shader && this.shader !== plugin) this.shader.dispose();
    this.shader = plugin;
    plugin?.resize(this.canvas.width, this.canvas.height);
  }

  resize(w: number, h: number): void {
    this.canvas.width = this.buffer.width = w;
    this.canvas.height = this.buffer.height = h;
    for (const deck of ["A", "B"] as const) {
      this.deckCanvas[deck].width = w;
      this.deckCanvas[deck].height = h;
      for (const p of this.decks[deck].banks) p?.resize(w, h);
    }
    this.shader?.resize(w, h);
  }

  // ── loop ─────────────────────────────────────────────────────────────────────────────────────
  start(): void {
    if (this.raf) return;
    this.startT = this.lastT = nowSec();
    const loop = () => {
      this.tick();
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop(): void {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  /**
   * The text field for sims to react to, sourced from *any* loaded TextLayer anywhere on the stage
   * (either deck, any bank). The deck/bank split means a TextLayer and a sim usually can't share a
   * bank stack, so a stage-wide field is what makes text interaction (fill/attract) reachable — it
   * restores the old "text sits below everything" behaviour. A deck's own in-stack TextLayer (a
   * lower bank) still overrides this for that deck.
   */
  private stageTextField(): FieldFn | null {
    for (const p of this.loaded()) {
      if (p.exportField) {
        const f = p.exportField();
        if (f) return f;
      }
    }
    return null;
  }

  /** Render all loaded banks in a deck, compositing each onto a shared deck canvas. */
  private renderDeck(deck: DeckName, frame: Frame): HTMLCanvasElement | null {
    const d = this.decks[deck];
    const plugins = d.banks.filter((p): p is Plugin => p !== null);
    if (plugins.length === 0) return null;

    const dc = this.deckCanvas[deck];
    const dctx = this.deckCtx[deck];
    const { width: w, height: h } = frame;
    dctx.clearRect(0, 0, w, h);

    // Thread frame.input (composite so far) and frame.textField. Seed textField from the stage-wide
    // source (frame.textField), then let any TextLayer earlier in this deck's stack override it.
    let lastOut: HTMLCanvasElement | null = null;
    let textField: FieldFn | null = frame.textField;
    for (const plugin of plugins) {
      const result = plugin.render({ ...frame, input: lastOut, textField });
      if (result) {
        const huedResult = plugin.applyHue(result);
        dctx.drawImage(huedResult, 0, 0, w, h);
        lastOut = dc;
      }
      // If this plugin exports a field function, thread it to subsequent banks.
      if (plugin.exportField) textField = plugin.exportField();
    }
    return lastOut ? dc : null;
  }

  /** Advance one frame. Exposed (with an injectable clock) for headless tests. */
  tick(now = nowSec()): void {
    const dt = now - this.lastT;
    this.lastT = now;

    // Pull live control values into only the focused/active plugin, so the controller drives one
    // layer at a time (not every loaded layer at once). Param state is retained on each plugin
    // instance, so a setting made while a layer is focused — e.g. a sim's textMode — persists after
    // focus moves elsewhere; text interaction does not depend on inactive layers tracking the bus.
    const managed = this.managed();
    if (managed) for (const p of managed.params) p.pull(this.bus.get(p.slot));

    const w = this.canvas.width, h = this.canvas.height;
    const frame: Frame = { width: w, height: h, time: now - this.startT, dt, input: null, textField: this.stageTextField() };
    const ca = this.renderDeck("A", frame);
    const cb = this.renderDeck("B", frame);

    // composite the two decks with an equal-power crossfade
    this.bctx.clearRect(0, 0, w, h);
    const both = !!ca && !!cb;
    const t = clamp01(this.crossfade);
    if (ca) {
      this.bctx.globalAlpha = both ? Math.cos((t * Math.PI) / 2) : 1;
      this.bctx.drawImage(ca, 0, 0, w, h);
    }
    if (cb) {
      this.bctx.globalAlpha = both ? Math.sin((t * Math.PI) / 2) : 1;
      this.bctx.drawImage(cb, 0, 0, w, h);
    }
    this.bctx.globalAlpha = 1;

    // full-canvas shader on top
    let out: HTMLCanvasElement = this.buffer;
    if (this.shader) {
      const s = this.shader.render({ ...frame, input: this.buffer, textField: null });
      if (s) out = this.shader.applyHue(s);
    }

    this.ctx.clearRect(0, 0, w, h);
    this.ctx.fillStyle = "#000";
    this.ctx.fillRect(0, 0, w, h);
    this.ctx.drawImage(out, 0, 0, w, h);
  }
}

function nowSec(): number {
  return (typeof performance !== "undefined" ? performance.now() : Date.now()) / 1000;
}
