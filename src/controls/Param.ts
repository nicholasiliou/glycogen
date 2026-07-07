import { clamp01, type SlotId, type SlotLive } from "./types";

/**
 * Binding handles. A plugin declares a field by binding a control — `spin = this.fader(0, {...})` —
 * and the returned `Param` *is* that field. The runtime host pulls live slot state into the param
 * each frame (only for the focused plugin); `render` reads `param.value`. Params keep working with
 * nothing bound (they hold their default) and stay directly settable from UI.
 */

export interface NumOpts {
  min?: number;
  max?: number;
  /** Quantisation; 0 = continuous. */
  step?: number;
  default?: number;
  /** 0 = instant, →1 = heavier easing toward the target each frame. */
  smooth?: number;
}

abstract class BaseParam {
  readonly slot: SlotId;
  /** The plugin field this is bound to (e.g. "spin"), filled in by the registry. Drives UI labels. */
  name = "";
  protected lastHits = -1;
  constructor(slot: SlotId) {
    this.slot = slot;
  }
  /** Apply a live slot snapshot. Called once per frame by the host for the focused plugin. */
  abstract pull(live: SlotLive): void;
}

/** A continuous numeric parameter driven by an absolute control (fader/knob) or relative encoder. */
export class Param extends BaseParam {
  value: number;
  readonly min: number;
  readonly max: number;
  readonly step: number;
  readonly default: number;
  readonly smooth: number;
  /** True for encoders/jog: live `delta` is integrated rather than `value` adopted. */
  readonly relative: boolean;
  private target: number;

  constructor(slot: SlotId, opts: NumOpts = {}, relative = false) {
    super(slot);
    this.min = opts.min ?? 0;
    this.max = opts.max ?? 1;
    this.step = opts.step ?? 0;
    this.default = opts.default ?? this.min;
    this.smooth = opts.smooth ?? 0;
    this.relative = relative;
    this.value = this.target = this.quantize(this.default);
  }

  /** Set from a normalised 0..1 absolute position (fader / knob / UI slider). */
  setNorm(n: number): void {
    this.set(this.min + clamp01(n) * (this.max - this.min));
  }

  /** Set the mapped value directly (UI numeric entry). */
  set(v: number): void {
    this.target = this.quantize(v);
    if (this.smooth <= 0) this.value = this.target;
  }

  /** Integrate a signed number of steps (encoder / jog). */
  nudge(steps: number): void {
    const inc = this.step > 0 ? this.step : (this.max - this.min) / 128;
    this.set(this.target + steps * inc);
  }

  /** Step through the quantised values with wraparound (a button cycling a stepped range). */
  cycleNudge(steps: number): void {
    if (this.step <= 0) return this.nudge(steps);
    const count = Math.round((this.max - this.min) / this.step) + 1;
    const at = Math.round((this.target - this.min) / this.step);
    const next = ((at + steps) % count + count) % count;
    this.set(this.min + next * this.step);
  }

  /** Advance smoothing one frame — call once per frame whether or not anything drove the param. */
  tick(): void {
    if (this.smooth > 0 && this.value !== this.target) {
      this.value += (this.target - this.value) * (1 - this.smooth);
      if (Math.abs(this.target - this.value) < 1e-4) this.value = this.target;
    }
  }

  /** Current value as a 0..1 fraction of the range. */
  get norm(): number {
    const span = this.max - this.min;
    return span ? (this.value - this.min) / span : 0;
  }

  pull(live: SlotLive): void {
    if (live.hits !== 0 && live.hits !== this.lastHits) {
      this.lastHits = live.hits;
      if (this.relative) {
        if (live.delta) this.nudge(live.delta);
      } else {
        this.setNorm(live.value);
      }
    }
    this.tick(); // ease toward target even on idle frames
  }

  private quantize(v: number): number {
    let x = Math.min(this.max, Math.max(this.min, v));
    if (this.step > 0) x = this.min + Math.round((x - this.min) / this.step) * this.step;
    return Math.min(this.max, Math.max(this.min, x));
  }
}

/** Best-effort human label for a cycle option (string as-is; objects fall back to a `name`/`label`). */
function cycleLabel(v: unknown): string {
  if (typeof v === "string") return v;
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    for (const k of ["label", "name", "id"]) if (typeof o[k] === "string") return o[k] as string;
  }
  return String(v);
}

/**
 * A discrete parameter driven by a button or pad. There is no declared "mode" — the same press
 * stream is exposed as every behaviour at once, and the plugin expresses intent purely by which it
 * reads: `.on` (toggle), `.held` (momentary), `.fired` (one-shot trigger), `.pick([…])` (cycle).
 */
export class ButtonParam extends BaseParam {
  /** Total presses since creation — `pick()` and any counter derive from this. */
  count = 0;
  /** Toggle state: flips on every press. */
  on = false;
  /** Momentary: true while the control is physically held down. */
  held = false;
  private firedFrame = false;
  private lastPresses = -1;
  /**
   * Labels of the most recent `pick()` cycle, captured so the UI can render named cycle states
   * (off/fill/attract, preset names, …) without a hand-maintained map — any new cycle a plugin
   * adds shows up automatically once it has rendered once. Empty for plain toggle/trigger pads.
   */
  cycle: readonly string[] = [];

  /** Cycle: the entry selected by the running press count. Records the option labels for the UI. */
  pick<T>(values: readonly T[]): T {
    const next = values.map((v) => cycleLabel(v));
    if (next.length !== this.cycle.length || next.some((s, i) => s !== this.cycle[i])) this.cycle = next;
    return values[this.count % values.length];
  }

  /** Trigger: true for the single frame after a press. */
  get fired(): boolean {
    return this.firedFrame;
  }

  /** Presses queued since the last {@link tick} (from a driver or a direct UI press). */
  private pending = 0;

  /** Queue presses — applied (and `fired` pulsed) by the next {@link tick}. */
  press(n = 1): void {
    this.pending += n;
  }

  setHeld(h: boolean): void {
    this.held = h;
  }

  /** Force the toggle state directly (momentary / absolute adapters). */
  setOn(v: boolean): void {
    this.on = v;
  }

  /** Consume queued presses — call once per frame whether or not anything drove the param. */
  tick(): void {
    const n = this.pending;
    this.pending = 0;
    this.firedFrame = n > 0;
    for (let i = 0; i < n; i++) {
      this.count++;
      this.on = !this.on;
    }
  }

  pull(live: SlotLive): void {
    this.held = live.pressed;
    if (this.lastPresses === -1) {
      this.lastPresses = live.presses; // first pull: adopt baseline without firing
      this.tick();
      return;
    }
    this.press(live.presses - this.lastPresses);
    this.lastPresses = live.presses;
    this.tick();
  }
}
