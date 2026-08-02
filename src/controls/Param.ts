import type { ParamControl } from "@/db/schema";
import { clamp01 } from "./types";

/**
 * Param handles. A plugin declares a field  -  `spin = this.number({...})`, `wrap = this.toggle()`  - 
 * and the returned param *is* that field: `render` reads `param.value` / `.on` / `.fired` /
 * `.pick([...])`. Params carry no slot: which widget/hardware drives them is a `paramBindings` row
 * in the db, executed by a `ParamDriver` (see adapters.ts). Params keep working with nothing bound
 * (they hold their default) and stay directly settable from UI via `set()` / `press()`.
 *
 * `tick()` must run once per frame on every loaded param (the Stage does this): it advances
 * smoothing and consumes queued presses so `.fired` pulses for exactly one frame.
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

/** A continuous (or stepped) numeric parameter. */
export class Param {
  /** The plugin field this was assigned to (e.g. "spin"), filled in by the registry. */
  name = "";
  value: number;
  readonly min: number;
  readonly max: number;
  readonly step: number;
  readonly default: number;
  readonly smooth: number;
  private target: number;

  constructor(opts: NumOpts = {}) {
    this.min = opts.min ?? 0;
    this.max = opts.max ?? 1;
    this.step = opts.step ?? 0;
    this.default = opts.default ?? this.min;
    this.smooth = opts.smooth ?? 0;
    this.value = this.target = this.quantize(this.default);
  }

  /** The db `params` row metadata this declaration authors. */
  get control(): ParamControl {
    return { type: "number", min: this.min, max: this.max, step: this.step, default: this.default, smooth: this.smooth };
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

  /** Land on the target immediately, skipping smoothing (load-time default overrides). */
  snap(): void {
    this.value = this.target;
  }

  /** Current value as a 0..1 fraction of the range. */
  get norm(): number {
    const span = this.max - this.min;
    return span ? (this.value - this.min) / span : 0;
  }

  /** Advance smoothing one frame  -  call once per frame whether or not anything drove the param. */
  tick(): void {
    if (this.smooth > 0 && this.value !== this.target) {
      this.value += (this.target - this.value) * (1 - this.smooth);
      if (Math.abs(this.target - this.value) < 1e-4) this.value = this.target;
    }
  }

  private quantize(v: number): number {
    let x = Math.min(this.max, Math.max(this.min, v));
    if (this.step > 0) x = this.min + Math.round((x - this.min) / this.step) * this.step;
    return Math.min(this.max, Math.max(this.min, x));
  }
}

/** What a press *means* for this param  -  declared so the db can derive adapter legality. */
export type ButtonIntent = "toggle" | "trigger" | "cycle";

/**
 * A discrete parameter driven by presses. The declared {@link intent} names what the plugin reads
 *  -  `.on` (toggle), `.fired` (trigger), `.pick([...])` / `.count` (cycle)  -  but every facet stays
 * live regardless, so reads don't need to match pedantically (a cycle can also check `.held`).
 */
export class ButtonParam {
  /** The plugin field this was assigned to, filled in by the registry. */
  name = "";
  readonly intent: ButtonIntent;
  /** Declared cycle option labels (empty for toggle/trigger)  -  drives the UI chips + legality. */
  readonly cycle: readonly string[];
  /** Total presses since creation  -  `pick()` and any counter derive from this. */
  count = 0;
  /** Toggle state: flips on every press. */
  on: boolean;
  /** Momentary: true while the control is physically held down. */
  held = false;
  private firedFrame = false;
  private pending = 0;

  constructor(intent: ButtonIntent, opts: { default?: boolean; options?: readonly string[] } = {}) {
    this.intent = intent;
    this.cycle = opts.options ?? [];
    this.on = opts.default ?? false;
  }

  /** The db `params` row metadata this declaration authors. */
  get control(): ParamControl {
    switch (this.intent) {
      case "toggle": return { type: "toggle", default: this.on };
      case "trigger": return { type: "trigger" };
      case "cycle": return { type: "cycle", options: this.cycle };
    }
  }

  /** Cycle: the entry selected by the running press count. */
  pick<T>(values: readonly T[]): T {
    return values[this.count % values.length];
  }

  /** Trigger: true for the single frame after a press. */
  get fired(): boolean {
    return this.firedFrame;
  }

  /** Queue presses  -  applied (and `fired` pulsed) by the next {@link tick}. */
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

  /** Consume queued presses  -  call once per frame whether or not anything drove the param. */
  tick(): void {
    const n = this.pending;
    this.pending = 0;
    this.firedFrame = n > 0;
    for (let i = 0; i < n; i++) {
      this.count++;
      this.on = !this.on;
    }
  }
}
