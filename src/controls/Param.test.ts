import { describe, expect, it } from "vitest";
import { ButtonParam, Param } from "./Param";

describe("Param (absolute)", () => {
  it("maps a normalised midpoint into the range", () => {
    const p = new Param("fader:0", { min: -360, max: 360 });
    p.setNorm(0.5);
    expect(p.value).toBe(0);
    p.setNorm(1);
    expect(p.value).toBe(360);
  });

  it("quantises to step and clamps", () => {
    const p = new Param("knob:0", { min: 0, max: 10, step: 1 });
    p.set(3.4);
    expect(p.value).toBe(3);
    p.set(999);
    expect(p.value).toBe(10);
  });
});

describe("Param (relative encoder)", () => {
  it("accumulates nudges and clamps to the range", () => {
    const p = new Param("encoder:0", { min: 0, max: 10, step: 1 }, true);
    expect(p.value).toBe(0); // defaults to min
    p.nudge(3);
    expect(p.value).toBe(3);
    p.nudge(100);
    expect(p.value).toBe(10);
    p.nudge(-100);
    expect(p.value).toBe(0);
  });
});

const live = (presses: number, pressed = false) => ({
  value: 0, delta: 0, relative: false, pressed, presses, hits: presses, lastSeen: 0,
});

describe("ButtonParam (behaviour as reads, no declared mode)", () => {
  it("pick() cycles by press count, toggles, and pulses fired — all from one press stream", () => {
    const b = new ButtonParam("button:0");
    b.pull(live(0)); // baseline, no fire
    expect(b.pick(["a", "b", "c"])).toBe("a");
    expect(b.on).toBe(false);
    expect(b.fired).toBe(false);

    b.pull(live(1)); // one press
    expect(b.pick(["a", "b", "c"])).toBe("b");
    expect(b.on).toBe(true);
    expect(b.fired).toBe(true);

    b.pull(live(3)); // two more presses, wraps a→b→c→a... count=3 → index 0
    expect(b.pick(["a", "b", "c"])).toBe("a");
    expect(b.on).toBe(true); // 3 flips from false → true
  });

  it("pick() records its option labels (strings and objects) on `cycle` for the UI", () => {
    const b = new ButtonParam("pad:0");
    expect(b.cycle).toEqual([]); // nothing picked yet
    b.pick(["off", "fill", "attract"]);
    expect(b.cycle).toEqual(["off", "fill", "attract"]);
    b.pick([{ label: "Coral" }, { name: "Maze" }]); // objects fall back to label/name
    expect(b.cycle).toEqual(["Coral", "Maze"]);
  });

  it("held tracks the physical press state", () => {
    const b = new ButtonParam("pad:0");
    b.pull(live(0, true));
    expect(b.held).toBe(true);
    b.pull(live(0, false));
    expect(b.held).toBe(false);
  });
});
