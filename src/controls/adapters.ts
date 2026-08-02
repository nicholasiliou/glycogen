/**
 * Signal adapters: the layer that lets any widget drive any (compatible) param. Every widget emits
 * one of three signal classes  -  an absolute position, a relative step, or a press  -  and every
 * param declares what it is (see `ParamControl` in the db schema). An adapter on the binding row
 * converts between the two; {@link legalAdapters} is the single source of truth for which
 * conversions exist, used both by the drop UI and by the db's paramBindings validator.
 *
 * {@link ParamDriver} is the runtime piece: one per binding row, it pulls a bus slot's live state
 * into its param each frame (the stateful hits/presses bookkeeping that used to live in
 * `Param.pull`). Driver state resets naturally on rebind because the driver is rebuilt.
 */
import type { ParamControl } from "@/db/schema";
import { ButtonParam, Param } from "./Param";
import type { ControlKind, SlotId, SlotLive } from "./types";

export type SignalClass = "abs" | "rel" | "press";

/** What each widget kind emits. */
export const WIDGET_SIGNAL: Record<ControlKind, SignalClass> = {
  fader: "abs",
  knob: "abs",
  encoder: "rel",
  jog: "rel",
  button: "press",
  pad: "press",
};

export type AdapterKind = "absolute" | "relative" | "toggle" | "momentary" | "trigger" | "cycle";

export interface AdapterSpec {
  kind: AdapterKind;
  /** Flip an absolute position (1 − v) before applying. */
  invert?: boolean;
}

/**
 * Every adapter that can convert `widgetKind`'s signal into `control`'s input  -  empty means the
 * combination is illegal (the UI rejects the drop). First entry is the sensible default.
 */
export function legalAdapters(control: ParamControl, widgetKind: ControlKind): AdapterKind[] {
  const signal = WIDGET_SIGNAL[widgetKind];
  switch (control.type) {
    case "number":
      if (signal === "abs") return ["absolute"];
      if (signal === "rel") return ["relative"];
      // a press can only step a quantised range (wrapping)  -  continuous ranges have no press shape
      return control.step > 0 ? ["cycle"] : [];
    case "toggle":
      if (signal === "press") return ["toggle", "momentary"];
      if (signal === "abs") return ["absolute"]; // on above the midpoint
      return [];
    case "trigger":
      return signal === "press" ? ["trigger"] : [];
    case "cycle":
      if (signal !== "press") return [];
      // a 2-option cycle is an on/off switch, so offer the toggle flavour too
      return control.options.length === 2 ? ["cycle", "toggle"] : ["cycle"];
  }
}

export function defaultAdapter(control: ParamControl, widgetKind: ControlKind): AdapterSpec | null {
  const kind = legalAdapters(control, widgetKind)[0];
  return kind ? { kind } : null;
}

type AnyParam = Param | ButtonParam;

/**
 * One binding row's runtime: pulls a bus slot's live state into the bound param through the
 * adapter. Call {@link apply} once per frame (before the params' own `tick()`), with the slot's
 * current {@link SlotLive}.
 */
export class ParamDriver {
  private lastHits = -1;
  private lastPresses = -1;

  constructor(
    readonly widgetId: SlotId,
    readonly param: AnyParam,
    readonly spec: AdapterSpec,
  ) {}

  apply(live: SlotLive): void {
    switch (this.spec.kind) {
      case "absolute": {
        if (!this.moved(live)) return;
        const v = this.spec.invert ? 1 - live.value : live.value;
        if (this.param instanceof Param) this.param.setNorm(v);
        else this.param.setOn(v > 0.5);
        return;
      }
      case "relative": {
        if (!this.moved(live)) return;
        if (this.param instanceof Param && live.delta) this.param.nudge(live.delta);
        return;
      }
      case "momentary": {
        if (this.param instanceof ButtonParam) {
          this.param.setHeld(live.pressed);
          this.param.setOn(live.pressed);
        }
        return;
      }
      // toggle / trigger / cycle all consume the press stream; the declared param intent decides
      // what a press *means* (flip .on, pulse .fired, advance .pick)  -  except cycle on a stepped
      // number param, which steps the quantised range with wraparound.
      case "toggle":
      case "trigger":
      case "cycle": {
        const n = this.presses(live);
        if (this.param instanceof ButtonParam) {
          this.param.setHeld(live.pressed);
          if (n > 0) this.param.press(n);
        } else if (n > 0) {
          this.param.cycleNudge(n);
        }
        return;
      }
    }
  }

  /** Adopt-then-detect on the monotonic hit counter, as `Param.pull` did. */
  private moved(live: SlotLive): boolean {
    if (live.hits === 0 || live.hits === this.lastHits) return false;
    this.lastHits = live.hits;
    return true;
  }

  /** New presses since last frame; the first sighting adopts a baseline without firing. */
  private presses(live: SlotLive): number {
    if (this.lastPresses === -1) {
      this.lastPresses = live.presses;
      return 0;
    }
    const n = live.presses - this.lastPresses;
    this.lastPresses = live.presses;
    return n;
  }
}
