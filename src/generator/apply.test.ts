import { describe, it, expect, beforeEach } from "vitest";
import { Engine } from "@/engine";
import { registerBuiltins } from "@/plugins";
import { planScene } from "./plan";
import { applyScene, sceneHash } from "./apply";
import { DEFAULT_RECIPE, type Recipe } from "./recipe";

function freshEngine(): Engine {
  const e = new Engine();
  registerBuiltins(e.registry);
  return e;
}

const recipe: Recipe = { ...DEFAULT_RECIPE, elements: ["noise", "boids"], seed: 9 };

describe("applyScene", () => {
  let engine: Engine;
  beforeEach(() => {
    engine = freshEngine();
  });

  it("replaces composition layers with the planned scene", () => {
    const spec = planScene(recipe, engine.comp.width, engine.comp.height);
    applyScene(engine, spec);
    const types = engine.comp.layers.map((l) => l.type).sort();
    expect(types).toEqual(["boids", "fx.colorLookup", "noise"]);
    expect(engine.comp.layers[0].type).toBe("fx.colorLookup");
  });

  it("applies planned property values onto the built layers", () => {
    const spec = planScene(recipe, engine.comp.width, engine.comp.height);
    const plannedSpeed = spec.layers.find((l) => l.type === "noise")!.props!.speed;
    applyScene(engine, spec);
    const noise = engine.comp.layers.find((l) => l.type === "noise")!;
    expect(noise.property("speed")!.value).toBe(plannedSpeed);
  });

  it("applies expressions when present", () => {
    const spec = planScene({ ...recipe, elements: ["text"] }, engine.comp.width, engine.comp.height);
    applyScene(engine, spec);
    const text = engine.comp.layers.find((l) => l.type === "text")!;
    expect(text.property("rotation")!.expression).toContain("wiggle");
  });

  it("is a single undoable transaction", () => {
    const before = engine.comp.layers.length;
    const spec = planScene(recipe, engine.comp.width, engine.comp.height);
    applyScene(engine, spec);
    expect(engine.history.canUndo).toBe(true);
    engine.history.undo();
    expect(engine.comp.layers.length).toBe(before);
  });
});

describe("sceneHash", () => {
  it("is stable for the same layers and changes after an edit", () => {
    const engine = freshEngine();
    applyScene(engine, planScene(recipe, engine.comp.width, engine.comp.height));
    const h1 = sceneHash(engine.comp);
    expect(sceneHash(engine.comp)).toBe(h1);
    engine.comp.layers[0].name = "changed";
    expect(sceneHash(engine.comp)).not.toBe(h1);
  });
});
