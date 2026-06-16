import { describe, it, expect } from "vitest";
import { makeRng, lerp, pick } from "./rng";

describe("makeRng", () => {
  it("is deterministic for the same seed", () => {
    const a = makeRng(42);
    const b = makeRng(42);
    const seqA = [a(), a(), a()];
    const seqB = [b(), b(), b()];
    expect(seqA).toEqual(seqB);
  });

  it("returns values in [0,1)", () => {
    const r = makeRng(7);
    for (let i = 0; i < 100; i++) {
      const v = r();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it("differs for different seeds", () => {
    expect(makeRng(1)()).not.toBe(makeRng(2)());
  });
});

describe("lerp", () => {
  it("interpolates endpoints", () => {
    expect(lerp(10, 20, 0)).toBe(10);
    expect(lerp(10, 20, 1)).toBe(20);
    expect(lerp(10, 20, 0.5)).toBe(15);
  });
});

describe("pick", () => {
  it("picks deterministically by rng", () => {
    const r = makeRng(3);
    const items = ["a", "b", "c", "d"];
    const first = pick(items, r);
    const r2 = makeRng(3);
    expect(pick(items, r2)).toBe(first);
    expect(items).toContain(first);
  });
});
