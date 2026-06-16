import { describe, it, expect } from "vitest";
import { Engine } from "@/engine";
import { registerBuiltins } from "@/plugins";
import { regenerate, getRecipe, isRecipeClean } from "./generate";
import { DEFAULT_RECIPE, type Recipe } from "./recipe";

function freshEngine(): Engine {
  const e = new Engine();
  registerBuiltins(e.registry);
  return e;
}

const recipe: Recipe = { ...DEFAULT_RECIPE, elements: ["noise"], seed: 3 };

describe("regenerate", () => {
  it("builds the scene and stores the recipe on project.meta", () => {
    const engine = freshEngine();
    regenerate(engine, recipe);
    expect(engine.comp.layers.some((l) => l.type === "noise")).toBe(true);
    expect(getRecipe(engine)).toEqual(recipe);
  });

  it("reports the scene as recipe-clean right after generating", () => {
    const engine = freshEngine();
    regenerate(engine, recipe);
    expect(isRecipeClean(engine)).toBe(true);
  });

  it("reports dirty after a manual layer edit", () => {
    const engine = freshEngine();
    regenerate(engine, recipe);
    engine.comp.layers[0].name = "hand-edited";
    expect(isRecipeClean(engine)).toBe(false);
  });

  it("reports dirty when no recipe was ever generated", () => {
    const engine = freshEngine();
    expect(isRecipeClean(engine)).toBe(false);
    expect(getRecipe(engine)).toBeNull();
  });
});
