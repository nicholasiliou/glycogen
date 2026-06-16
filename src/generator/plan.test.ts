import { describe, it, expect } from "vitest";
import { planScene } from "./plan";
import { DEFAULT_RECIPE, MARATHON_BG, type Recipe } from "./recipe";

const base: Recipe = { ...DEFAULT_RECIPE, elements: ["noise"], seed: 5 };

describe("planScene", () => {
  it("always appends the colorLookup house-style layer on top (index 0)", () => {
    const spec = planScene(base, 1080, 1920);
    expect(spec.layers[0].type).toBe("fx.colorLookup");
    expect(spec.background).toEqual(MARATHON_BG);
  });

  it("emits exactly the chosen element layers plus the house-style layer", () => {
    const spec = planScene({ ...base, elements: ["noise", "boids"] }, 1080, 1920);
    const types = spec.layers.map((l) => l.type).sort();
    expect(types).toEqual(["boids", "fx.colorLookup", "noise"]);
  });

  it("is deterministic for the same recipe + size", () => {
    const a = planScene(base, 1080, 1920);
    const b = planScene(base, 1080, 1920);
    expect(a).toEqual(b);
  });

  it("changes with the seed", () => {
    const a = planScene({ ...base, seed: 1 }, 1080, 1920);
    const b = planScene({ ...base, seed: 2 }, 1080, 1920);
    expect(a).not.toEqual(b);
  });

  it("maps higher dynamic to faster noise evolution", () => {
    const slow = planScene({ ...base, dynamic: 0 }, 1080, 1920);
    const fast = planScene({ ...base, dynamic: 1 }, 1080, 1920);
    const speedOf = (s: typeof slow) =>
      s.layers.find((l) => l.type === "noise")!.props!.speed as number;
    expect(speedOf(fast)).toBeGreaterThan(speedOf(slow));
  });

  it("maps higher complexity to more boids", () => {
    const r: Recipe = { ...base, elements: ["boids"] };
    const low = planScene({ ...r, complexity: 0 }, 1080, 1920);
    const high = planScene({ ...r, complexity: 1 }, 1080, 1920);
    const countOf = (s: typeof low) =>
      s.layers.find((l) => l.type === "boids")!.props!.count as number;
    expect(countOf(high)).toBeGreaterThan(countOf(low));
  });

  it("gives the text layer a rotation wiggle scaled by dynamic", () => {
    const still = planScene({ ...base, elements: ["text"], dynamic: 0 }, 1080, 1920);
    const lively = planScene({ ...base, elements: ["text"], dynamic: 1 }, 1080, 1920);
    const textStill = still.layers.find((l) => l.type === "text")!;
    const textLively = lively.layers.find((l) => l.type === "text")!;
    expect(textStill.expressions?.rotation).toContain("wiggle");
    expect(textLively.expressions?.rotation).toContain("wiggle");
    const amp = (s: string) => Number(s.match(/wiggle\([^,]+,\s*([0-9.]+)\)/)![1]);
    expect(amp(textLively.expressions!.rotation!)).toBeGreaterThan(
      amp(textStill.expressions!.rotation!),
    );
  });

  it("clamps out-of-range dynamic and complexity", () => {
    const clampedHigh = planScene({ ...base, dynamic: 5, complexity: 5 }, 1080, 1920);
    const atMax = planScene({ ...base, dynamic: 1, complexity: 1 }, 1080, 1920);
    expect(clampedHigh).toEqual(atMax);
    const clampedLow = planScene({ ...base, dynamic: -3, complexity: -3 }, 1080, 1920);
    const atMin = planScene({ ...base, dynamic: 0, complexity: 0 }, 1080, 1920);
    expect(clampedLow).toEqual(atMin);
  });
});
