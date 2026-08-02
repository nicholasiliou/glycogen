import { describe, expect, it } from "vitest";
import { ButtonParam, Param } from "./Param";

describe("Param (numeric)", () => {
  it("maps a normalised midpoint into the range", () => {
    const p = new Param({ min: -360, max: 360 });
    p.setNorm(0.5);
    expect(p.value).toBe(0);
    p.setNorm(1);
    expect(p.value).toBe(360);
  });

  it("quantises to step and clamps", () => {
    const p = new Param({ min: 0, max: 10, step: 1 });
    p.set(3.4);
    expect(p.value).toBe(3);
    p.set(999);
    expect(p.value).toBe(10);
  });

  it("accumulates nudges and clamps to the range", () => {
    const p = new Param({ min: 0, max: 10, step: 1 });
    expect(p.value).toBe(0); // defaults to min
    p.nudge(3);
    expect(p.value).toBe(3);
    p.nudge(100);
    expect(p.value).toBe(10);
    p.nudge(-100);
    expect(p.value).toBe(0);
  });

  it("eases toward the target across ticks when smoothed", () => {
    const p = new Param({ min: 0, max: 100, smooth: 0.5 });
    p.set(100);
    expect(p.value).toBe(0); // target set, value eases
    p.tick();
    expect(p.value).toBe(50);
    for (let i = 0; i < 60; i++) p.tick();
    expect(p.value).toBe(100);
  });

  it("authors its db metadata row", () => {
    const p = new Param({ min: 1, max: 8, step: 1, default: 3 });
    expect(p.control).toEqual({ type: "number", min: 1, max: 8, step: 1, default: 3, smooth: 0 });
  });
});

describe("ButtonParam (declared intent, press stream)", () => {
  it("pick() cycles by press count, toggles, and pulses fired  -  all from one press stream", () => {
    const b = new ButtonParam("cycle", { options: ["a", "b", "c"] });
    b.tick();
    expect(b.pick(["a", "b", "c"])).toBe("a");
    expect(b.on).toBe(false);
    expect(b.fired).toBe(false);

    b.press();
    b.tick();
    expect(b.pick(["a", "b", "c"])).toBe("b");
    expect(b.on).toBe(true);
    expect(b.fired).toBe(true);

    b.press(2); // wraps a→b→c→a… count=3 → index 0
    b.tick();
    expect(b.pick(["a", "b", "c"])).toBe("a");
    expect(b.on).toBe(true); // 3 flips from false → true

    b.tick(); // idle frame clears fired
    expect(b.fired).toBe(false);
  });

  it("toggle defaults land on .on without consuming presses", () => {
    const b = new ButtonParam("toggle", { default: true });
    expect(b.on).toBe(true);
    expect(b.count).toBe(0);
    b.press();
    b.tick();
    expect(b.on).toBe(false);
  });

  it("held tracks the physical press state; setOn forces the toggle", () => {
    const b = new ButtonParam("toggle");
    b.setHeld(true);
    expect(b.held).toBe(true);
    b.setOn(true);
    expect(b.on).toBe(true);
  });

  it("authors its db metadata row per intent", () => {
    expect(new ButtonParam("toggle", { default: true }).control).toEqual({ type: "toggle", default: true });
    expect(new ButtonParam("trigger").control).toEqual({ type: "trigger" });
    expect(new ButtonParam("cycle", { options: ["x", "y"] }).control).toEqual({ type: "cycle", options: ["x", "y"] });
  });
});
