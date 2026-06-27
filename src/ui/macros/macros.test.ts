import { describe, it, expect } from "vitest";
import type { PropertySchema } from "@/engine";
import { accumulate, centeredCurve, growthCurve, linearCurve, macroMapFor } from "./macros";

describe("curves", () => {
  it("growthCurve is exponential between min and max", () => {
    expect(growthCurve(0, 1, 40000)).toBeCloseTo(1);
    expect(growthCurve(1, 1, 40000)).toBeCloseTo(40000);
    expect(growthCurve(0.5, 1, 40000)).toBeCloseTo(200); // sqrt(40000)
  });

  it("centeredCurve puts the default at 12 o'clock", () => {
    expect(centeredCurve(0, 0, 100, 30)).toBe(0);
    expect(centeredCurve(0.5, 0, 100, 30)).toBe(30);
    expect(centeredCurve(1, 0, 100, 30)).toBe(100);
    expect(centeredCurve(0.25, 0, 100, 30)).toBe(15);
  });

  it("linearCurve and clamping", () => {
    expect(linearCurve(0.5, 0, 10)).toBe(5);
    expect(linearCurve(2, 0, 10)).toBe(10); // clamped
    expect(linearCurve(-1, 0, 10)).toBe(0);
  });

  it("accumulate nudges by signed delta and clamps", () => {
    expect(accumulate(50, 1, 0, 100, 2)).toBe(52);
    expect(accumulate(50, -3, 0, 100, 2)).toBe(44);
    expect(accumulate(99, 5, 0, 100, 2)).toBe(100);
    expect(accumulate(1, -5, 0, 100, 2)).toBe(0);
  });
});

describe("macro maps", () => {
  it("returns the curated map for known plugins", () => {
    expect(macroMapFor("physarum", []).amount?.key).toBe("count");
    expect(macroMapFor("boids", []).amount?.key).toBe("count");
    expect(macroMapFor("life", []).amount?.key).toBe("density");
  });

  it("derives a generic map from an unknown plugin's schema", () => {
    const schema: PropertySchema[] = [
      { key: "count", name: "Count", type: "number", default: 100, meta: { min: 1, max: 1000 } },
      { key: "speed", name: "Speed", type: "number", default: 1, meta: { min: 0, max: 5 } },
      { key: "hue", name: "Hue", type: "number", default: 0.5, meta: { min: 0, max: 1 } },
      { key: "gain", name: "Gain", type: "number", default: 1, meta: { min: 0, max: 4 } },
      { key: "seed", name: "Seed", type: "number", default: 1, animatable: false, meta: { min: 0, max: 99999 } },
      { key: "wrap", name: "Wrap", type: "boolean", default: true },
    ];
    const map = macroMapFor("totally-unknown", schema);
    expect(map.amount?.key).toBe("count");
    expect(map.evolveX?.key).toBe("speed");
    expect(map.toneX?.key).toBe("gain");
    expect(map.trigger?.key).toBe("seed");
    expect(map.toggle?.key).toBe("wrap");
  });
});
