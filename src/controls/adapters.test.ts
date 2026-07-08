import { describe, expect, it } from "vitest";
import type { ParamControl } from "@/db/schema";
import { legalAdapters, ParamDriver, type AdapterSpec } from "./adapters";
import { ButtonParam, Param } from "./Param";
import type { SlotLive } from "./types";

const num = (step = 0): ParamControl => ({ type: "number", min: 0, max: 10, step, default: 0, smooth: 0 });
const toggle: ParamControl = { type: "toggle", default: false };
const trigger: ParamControl = { type: "trigger" };
const cycle = (n: number): ParamControl => ({ type: "cycle", options: Array.from({ length: n }, (_, i) => `o${i}`) });

describe("legalAdapters — the full legality matrix", () => {
  it("continuous numbers take absolute from abs widgets, relative from rel widgets, nothing from presses", () => {
    expect(legalAdapters(num(), "knob")).toEqual(["absolute"]);
    expect(legalAdapters(num(), "fader")).toEqual(["absolute"]);
    expect(legalAdapters(num(), "encoder")).toEqual(["relative"]);
    expect(legalAdapters(num(), "jog")).toEqual(["relative"]);
    expect(legalAdapters(num(), "pad")).toEqual([]);
    expect(legalAdapters(num(), "button")).toEqual([]);
  });

  it("stepped numbers additionally cycle from presses", () => {
    expect(legalAdapters(num(1), "pad")).toEqual(["cycle"]);
    expect(legalAdapters(num(1), "knob")).toEqual(["absolute"]);
  });

  it("toggles take presses (toggle or momentary) and absolute thresholds, never relative", () => {
    expect(legalAdapters(toggle, "pad")).toEqual(["toggle", "momentary"]);
    expect(legalAdapters(toggle, "button")).toEqual(["toggle", "momentary"]);
    expect(legalAdapters(toggle, "fader")).toEqual(["absolute"]);
    expect(legalAdapters(toggle, "encoder")).toEqual([]);
  });

  it("triggers only take presses", () => {
    expect(legalAdapters(trigger, "pad")).toEqual(["trigger"]);
    expect(legalAdapters(trigger, "knob")).toEqual([]);
    expect(legalAdapters(trigger, "jog")).toEqual([]);
  });

  it("cycles take presses; a 2-option cycle doubles as an on/off switch", () => {
    expect(legalAdapters(cycle(3), "pad")).toEqual(["cycle"]);
    expect(legalAdapters(cycle(2), "pad")).toEqual(["cycle", "toggle"]);
    expect(legalAdapters(cycle(3), "fader")).toEqual([]);
  });
});

// ── drivers ─────────────────────────────────────────────────────────────────────────────────────

function live(over: Partial<SlotLive>): SlotLive {
  return { value: 0, delta: 0, relative: false, pressed: false, presses: 0, hits: 0, lastSeen: 0, ...over };
}

function drive(param: Param | ButtonParam, spec: AdapterSpec, frames: Partial<SlotLive>[]): void {
  const d = new ParamDriver("knob:0", param, spec);
  for (const f of frames) {
    d.apply(live(f));
    param.tick();
  }
}

describe("ParamDriver — absolute", () => {
  it("adopts absolute positions, only when the slot actually moved", () => {
    const p = new Param({ min: 0, max: 10 });
    drive(p, { kind: "absolute" }, [{ value: 0.5, hits: 1 }]);
    expect(p.value).toBe(5);
    // same hits again → no re-adoption even if the value snapshot changed
    drive(p, { kind: "absolute" }, [{ value: 0.9, hits: 0 }]);
    expect(p.value).toBe(5);
  });

  it("inverts when the spec says so", () => {
    const p = new Param({ min: 0, max: 10 });
    drive(p, { kind: "absolute", invert: true }, [{ value: 0.2, hits: 1 }]);
    expect(p.value).toBe(8);
  });

  it("thresholds a toggle param at the midpoint", () => {
    const b = new ButtonParam("toggle");
    drive(b, { kind: "absolute" }, [{ value: 0.8, hits: 1 }]);
    expect(b.on).toBe(true);
    drive(b, { kind: "absolute" }, [{ value: 0.2, hits: 2 }]);
    expect(b.on).toBe(false);
  });
});

describe("ParamDriver — relative", () => {
  it("integrates deltas", () => {
    const p = new Param({ min: 0, max: 10, step: 1 });
    const d = new ParamDriver("encoder:0", p, { kind: "relative" });
    d.apply(live({ delta: 3, relative: true, hits: 1 }));
    d.apply(live({ delta: 2, relative: true, hits: 2 }));
    expect(p.value).toBe(5);
  });
});

describe("ParamDriver — press family", () => {
  it("toggle: presses flip .on and pulse .fired for exactly one frame", () => {
    const b = new ButtonParam("toggle");
    const d = new ParamDriver("pad:4", b, { kind: "toggle" });
    d.apply(live({ presses: 0 })); // baseline adoption, no fire
    b.tick();
    expect(b.on).toBe(false);

    d.apply(live({ presses: 1, pressed: true }));
    b.tick();
    expect(b.on).toBe(true);
    expect(b.fired).toBe(true);
    expect(b.held).toBe(true);

    d.apply(live({ presses: 1, pressed: false })); // idle frame clears fired
    b.tick();
    expect(b.fired).toBe(false);
    expect(b.on).toBe(true);
    expect(b.held).toBe(false);
  });

  it("cycle: presses advance pick() through the declared options", () => {
    const b = new ButtonParam("toggle");
    const d = new ParamDriver("pad:4", b, { kind: "cycle" });
    d.apply(live({ presses: 0 }));
    b.tick();
    expect(b.pick(["a", "b", "c"])).toBe("a");
    d.apply(live({ presses: 2 }));
    b.tick();
    expect(b.pick(["a", "b", "c"])).toBe("c");
  });

  it("momentary: .on follows the physical hold without flipping", () => {
    const b = new ButtonParam("toggle");
    const d = new ParamDriver("pad:4", b, { kind: "momentary" });
    d.apply(live({ pressed: true, presses: 1 }));
    b.tick();
    expect(b.on).toBe(true);
    d.apply(live({ pressed: false, presses: 1 }));
    b.tick();
    expect(b.on).toBe(false);
  });

  it("cycle on a stepped number wraps through the quantised values", () => {
    const p = new Param({ min: 0, max: 2, step: 1 }); // values 0,1,2
    const d = new ParamDriver("pad:4", p, { kind: "cycle" });
    d.apply(live({ presses: 0 })); // baseline
    d.apply(live({ presses: 1 }));
    expect(p.value).toBe(1);
    d.apply(live({ presses: 2 }));
    expect(p.value).toBe(2);
    d.apply(live({ presses: 3 }));
    expect(p.value).toBe(0); // wrapped
  });

  it("a direct UI press() queues and pulses fired on the next tick", () => {
    const b = new ButtonParam("toggle");
    b.press();
    b.tick();
    expect(b.fired).toBe(true);
    expect(b.on).toBe(true);
    b.tick();
    expect(b.fired).toBe(false);
  });
});
