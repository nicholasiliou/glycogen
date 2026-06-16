import { useState } from "react";
import { Dices } from "lucide-react";
import { useEngine } from "@/ui/engine/EngineProvider";
import { getRecipe, isRecipeClean, regenerate } from "@/generator/generate";
import {
  DEFAULT_RECIPE, SIMPLE_ELEMENTS, type ElementType, type Recipe,
} from "@/generator/recipe";
import { Button } from "@/ui/components/ui/button";
import { Slider } from "@/ui/components/ui/slider";
import { cn } from "@/ui/lib/cn";

export function SimplePanel() {
  const engine = useEngine();
  const [recipe, setRecipe] = useState<Recipe>(() => getRecipe(engine) ?? DEFAULT_RECIPE);

  /** Apply a recipe change, warning first if the user hand-edited the scene in Pro. */
  const apply = (next: Recipe) => {
    if (!isRecipeClean(engine)) {
      const ok = window.confirm(
        "Diese Szene wurde im Pro Mode manuell bearbeitet. Beim Neugenerieren gehen diese Änderungen verloren. Fortfahren?",
      );
      if (!ok) return;
    }
    setRecipe(next);
    regenerate(engine, next);
  };

  const toggleElement = (type: ElementType) => {
    const has = recipe.elements.includes(type);
    const elements = has ? recipe.elements.filter((e) => e !== type) : [...recipe.elements, type];
    apply({ ...recipe, elements });
  };

  const roll = () => apply({ ...recipe, seed: Math.floor(Math.random() * 99999) });

  return (
    <div className="flex h-full flex-col gap-5 overflow-y-auto p-4">
      <section>
        <h3 className="mb-2 text-[10px] uppercase tracking-wide text-ink-dim">Elemente</h3>
        <div className="flex flex-wrap gap-1.5">
          {SIMPLE_ELEMENTS.map((el) => {
            const on = recipe.elements.includes(el.type);
            return (
              <button
                key={el.type}
                onClick={() => toggleElement(el.type)}
                className={cn(
                  "rounded-full border px-3 py-1 text-xs transition-colors",
                  on ? "border-accent bg-accent/15 text-accent" : "border-edge text-ink-dim hover:text-ink",
                )}
              >
                {el.label}
              </button>
            );
          })}
        </div>
      </section>

      <section>
        <div className="mb-1 flex items-center justify-between text-[10px] uppercase tracking-wide text-ink-dim">
          <span>Dynamik</span><span className="tabular-nums">{Math.round(recipe.dynamic * 100)}</span>
        </div>
        <Slider
          min={0} max={1} step={0.01} value={[recipe.dynamic]}
          onValueChange={([v]) => setRecipe((r) => ({ ...r, dynamic: v }))}
          onValueCommit={([v]) => apply({ ...recipe, dynamic: v })}
        />
      </section>

      <section>
        <div className="mb-1 flex items-center justify-between text-[10px] uppercase tracking-wide text-ink-dim">
          <span>Komplexität</span><span className="tabular-nums">{Math.round(recipe.complexity * 100)}</span>
        </div>
        <Slider
          min={0} max={1} step={0.01} value={[recipe.complexity]}
          onValueChange={([v]) => setRecipe((r) => ({ ...r, complexity: v }))}
          onValueCommit={([v]) => apply({ ...recipe, complexity: v })}
        />
      </section>

      <Button variant="accent" className="mt-2 w-full" onClick={roll}>
        <Dices className="h-4 w-4" /> Würfeln
      </Button>
    </div>
  );
}
