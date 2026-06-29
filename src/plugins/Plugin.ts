import { ButtonParam, Param, type NumOpts } from "@/controls/Param";
import { slotId } from "@/controls/types";

// ── bindable slot indices (compile-time guard) ────────────────────────────────────────────────
// The literal index ranges a plugin may bind per control kind. They mirror the controller's
// exposed counts (see SLOT_CATALOG in midi/keymap) MINUS slots reserved for app-wide globals:
//   • knob:9     — global hue (declared on the Plugin base)
//   • crossfader — the A/B crossfade (the kind is omitted from the factory entirely)
// Binding anything outside these unions is a TypeScript error at build time, so a plugin can never
// silently squat a global's control. Keep these in sync with SLOT_CATALOG.
export type FaderSlot = 0 | 1 | 2 | 3;
export type KnobSlot = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8; // knob:9 (hue) is reserved and not bindable
export type EncoderSlot = 0 | 1 | 2 | 3;
export type PadSlot = 4 | 5 | 6 | 7; // pad:0..3 are the deck's global Del/Bank row, not plugin-bindable
export type ButtonSlot = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;
export type JogSlot = 0 | 1;

/**
 * A scalar field function that any plugin can export for other plugins to read.
 * Coordinates are normalised: x/y in [0,1], z is time or an animation axis.
 * Used by TextLayer to export a coverage mask that sim layers use to guide agents.
 *
 * `key` identifies the field's *content* so consumers can cache a rasterised mask and only rebuild
 * it when the content actually changes. A fresh closure is returned every frame, so its identity
 * (or `String(fn)`) is useless as a cache key — read `fn.key` instead. Omitted ⇒ treat as volatile.
 */
export interface FieldFn {
  (x: number, y: number, z: number): number;
  key?: string;
}

/** Real-time per-frame context handed to every plugin. No timeline — this is a live instrument. */
export interface Frame {
  width: number;
  height: number;
  /** Seconds since this plugin's stage started. */
  time: number;
  /** Seconds since the previous frame. */
  dt: number;
  /** For effects: the canvas of everything composited below. Null for the bottom of the stack. */
  input: HTMLCanvasElement | null;
  /**
   * Field function exported by a TextLayer earlier in the same deck's bank stack.
   * Sims (Physarum, RD, ContourField) use this to shape their behaviour around the text.
   * Null when no TextLayer is present below.
   */
  textField: FieldFn | null;
}

export type AnyParam = Param | ButtonParam;

/**
 * The plugin factory. Every visual plugin extends this and, in its field initialisers, binds the
 * controls it wants — `spin = this.fader(0, { min: -360, max: 360 })`. The whole controller
 * surface (faders, knobs, encoders, buttons, pads, jog, crossfader) is exposed here, so the *only*
 * thing an author writes is which slot a field is tied to; everything else (the plugin's id, label,
 * whether it's a generator or effect, how a button behaves) is derived from structure, not declared.
 */
export abstract class Plugin {
  /** Registry id (derived from the file path), stamped on by `create()`. Drives instrument lookup. */
  id = "";
  /** Every bound control, in declaration order — for the host to drive and the UI to learn/show. */
  readonly params: AnyParam[] = [];
  /** A plugin owns its output surface; generators draw here, effects usually return a shader canvas. */
  protected canvas: HTMLCanvasElement = document.createElement("canvas");

  /** Global hue rotation in degrees, available on every plugin via knob:9 (a slot plugins can't bind). */
  hue = this.bind(new Param(slotId("knob", 9), { min: -180, max: 180, default: 0 }));

  /** Offscreen canvas used to apply the hue filter without mutating the plugin's own canvas. */
  private hueCanvas: HTMLCanvasElement | null = null;

  // ── the controller surface ──────────────────────────────────────────────────────────────────
  // Slot indices are typed to exactly the controller's exposed range, minus any reserved for app
  // globals, so binding a reserved or out-of-range slot is a *compile-time* error (see PluginSlot).
  // knob:9 is the global hue and crossfader:0 is the A/B crossfade — neither is offered to plugins.
  protected fader(slot: FaderSlot, o: NumOpts = {}): Param { return this.bind(new Param(slotId("fader", slot), o)); }
  protected knob(slot: KnobSlot, o: NumOpts = {}): Param { return this.bind(new Param(slotId("knob", slot), o)); }
  protected encoder(slot: EncoderSlot, o: NumOpts = {}): Param { return this.bind(new Param(slotId("encoder", slot), o, true)); }
  protected jog(slot: JogSlot, o: NumOpts = {}): Param { return this.bind(new Param(slotId("jog", slot), o, true)); }
  protected button(slot: ButtonSlot): ButtonParam { return this.bind(new ButtonParam(slotId("button", slot))); }
  protected pad(slot: PadSlot): ButtonParam { return this.bind(new ButtonParam(slotId("pad", slot))); }

  /**
   * Apply the hue shift (if non-zero) to `src` and return the filtered canvas.
   * Called by Stage after render() so plugins don't need to think about it.
   */
  applyHue(src: HTMLCanvasElement): HTMLCanvasElement {
    const deg = this.hue.value % 360;
    if (Math.abs(deg) < 0.5) return src;
    const w = src.width, h = src.height;
    if (!this.hueCanvas) this.hueCanvas = document.createElement("canvas");
    if (this.hueCanvas.width !== w || this.hueCanvas.height !== h) {
      this.hueCanvas.width = w;
      this.hueCanvas.height = h;
    }
    const ctx = this.hueCanvas.getContext("2d")!;
    ctx.clearRect(0, 0, w, h);
    ctx.filter = `hue-rotate(${deg}deg)`;
    ctx.drawImage(src, 0, 0);
    ctx.filter = "none";
    return this.hueCanvas;
  }

  private bind<T extends AnyParam>(p: T): T {
    this.params.push(p);
    return p;
  }

  // ── lifecycle ───────────────────────────────────────────────────────────────────────────────
  resize(w: number, h: number): void {
    this.canvas.width = Math.max(1, Math.round(w));
    this.canvas.height = Math.max(1, Math.round(h));
  }

  /** Draw one frame. Return the surface to composite, or null to pass the input through unchanged. */
  abstract render(f: Frame): HTMLCanvasElement | null;

  /**
   * Optionally export a scalar field for downstream plugins to use (e.g. TextLayer exports
   * a coverage function so sim layers can shape agents around the text).
   * Return null (or omit this method) if this plugin exports nothing.
   */
  exportField?(): FieldFn | null;

  dispose(): void {
    this.canvas.width = this.canvas.height = 0;
  }
}
