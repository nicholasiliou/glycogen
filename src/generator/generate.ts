import type { Engine } from "@/engine";
import { planScene } from "./plan";
import { applyScene, sceneHash } from "./apply";
import type { Recipe } from "./recipe";

const RECIPE_KEY = "recipe";
const HASH_KEY = "recipeSceneHash";

/** Plan + apply a recipe, then record it (and the clean-hash) on project.meta. */
export function regenerate(engine: Engine, recipe: Recipe): void {
  const spec = planScene(recipe, engine.comp.width, engine.comp.height);
  applyScene(engine, spec);
  engine.project.meta[RECIPE_KEY] = recipe;
  engine.project.meta[HASH_KEY] = sceneHash(engine.comp);
}

/** The recipe last used to generate this project, or null if none. */
export function getRecipe(engine: Engine): Recipe | null {
  const r = engine.project.meta[RECIPE_KEY];
  return r ? (r as Recipe) : null;
}

/** True when the current scene is exactly what the stored recipe produced. */
export function isRecipeClean(engine: Engine): boolean {
  const stored = engine.project.meta[HASH_KEY];
  if (typeof stored !== "string") return false;
  return stored === sceneHash(engine.comp);
}
