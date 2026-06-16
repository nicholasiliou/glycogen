# Simple Mode Interface Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ein zweiter, reduzierter „Simple Mode" als Default-Interface, der über eine prozedurale Rezept-Engine markengerechte Marathon-Visuals generiert; der bestehende volle Editor bleibt als umschaltbarer „Pro Mode" erhalten.

**Architecture:** Die Engine bleibt unverändert und modus-agnostisch. Ein neues, headless `src/generator/`-Modul trennt einen **reinen Planner** (`planScene`: Recipe → SceneSpec, deterministisch, ohne Engine/DOM) von einem **dünnen Applier** (`applyScene`: SceneSpec → echte Layer, in einer Undo-Transaktion). Der UI-Modus lebt in einem React-Context (localStorage-persistiert); `App.tsx` verzweigt zwischen `<SimpleApp/>` und `<ProApp/>` (= heutiges Layout). Das Recipe wird in `project.meta` mitserialisiert.

**Tech Stack:** Vite + React 18 + TypeScript + Tailwind v4 + Radix/Shadcn-Primitives + p5. Tests neu mit **Vitest** (+ jsdom).

**Scope dieser Iteration:** Volle Zwei-Modi-Infrastruktur + funktionierender Generator mit einem kuratierten Element-Satz **noise, boids, text** plus automatischem Marathon-Hausstil (`fx.colorLookup`). Weitere Element-Typen aus der Spec (plant, glyphScatter, harmonograph, …) werden später über denselben `ELEMENT_BUILDERS`-Seam ergänzt — bewusst nicht in dieser Iteration, um den ersten Durchstich klein und testbar zu halten.

---

## File Structure

**Neu (Generator, headless):**
- `src/generator/rng.ts` — deterministischer Seed-RNG + `lerp` / `pick`.
- `src/generator/recipe.ts` — `Recipe`, `ElementType`, `DEFAULT_RECIPE`, `MARATHON_PALETTE`, `MARATHON_BG`.
- `src/generator/plan.ts` — `SceneSpec`/`SceneLayerSpec`-Typen, `ELEMENT_BUILDERS`, `planScene()`.
- `src/generator/apply.ts` — `buildLayerFromSpec()`, `applyScene()`, `sceneHash()`.
- `src/generator/generate.ts` — `regenerate()`, `getRecipe()`, `isRecipeClean()`.

**Neu (UI):**
- `src/ui/mode/modeStorage.ts` — `loadMode()` / `saveMode()` (localStorage).
- `src/ui/mode/ModeProvider.tsx` — Mode-Context + `useMode()`.
- `src/ui/ProApp.tsx` — der heutige `App`-Inhalt, ausgelagert.
- `src/ui/SimpleApp.tsx` — Simple-Mode-Shell (Viewport links + Panels).
- `src/ui/panels/SimpleToolbar.tsx` — schlanke Top-Leiste mit Format-Quickpick, Play, Export, „Pro Mode ▸".
- `src/ui/panels/SimplePanel.tsx` — rechte Steuer-Sidebar (Element-Chips, Dynamik, Komplexität, Würfeln).

**Modifiziert:**
- `package.json` — Vitest-Devdeps + `test`-Script.
- `vitest.config.ts` — neu.
- `src/ui/App.tsx` — verzweigt nach Modus.
- `src/main.tsx` — `ModeProvider`, Default-Szene aus Recipe generieren.
- `src/ui/panels/Toolbar.tsx` — „◇ Simple"-Rückschalter.

**Tests:**
- `src/generator/rng.test.ts`, `src/generator/plan.test.ts`, `src/generator/apply.test.ts`, `src/generator/generate.test.ts`, `src/ui/mode/modeStorage.test.ts`.

---

## Task 1: Vitest-Tooling einrichten

**Files:**
- Modify: `package.json`
- Create: `vitest.config.ts`
- Create: `src/generator/smoke.test.ts` (Wegwerf-Sanity-Test)

- [ ] **Step 1: Devdeps installieren**

Run:
```bash
npm install -D vitest@^2.1.8 jsdom@^25.0.1
```
Expected: `package.json` listet `vitest` und `jsdom` unter `devDependencies`; Exit 0.

- [ ] **Step 2: `test`-Script ergänzen**

In `package.json` im `"scripts"`-Block diese Zeile hinzufügen (nach `"typecheck": "tsc --noEmit"`, mit Komma davor):
```json
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:watch": "vitest"
```

- [ ] **Step 3: Vitest-Config anlegen**

Create `vitest.config.ts`:
```ts
import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") },
  },
  test: {
    environment: "jsdom",
    globals: true,
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
  },
});
```

- [ ] **Step 4: Sanity-Test schreiben**

Create `src/generator/smoke.test.ts`:
```ts
import { describe, it, expect } from "vitest";

describe("vitest setup", () => {
  it("runs", () => {
    expect(1 + 1).toBe(2);
  });
});
```

- [ ] **Step 5: Test laufen lassen**

Run: `npm test`
Expected: PASS, 1 passed.

- [ ] **Step 6: Sanity-Test wieder löschen & committen**

```bash
rm src/generator/smoke.test.ts
git add package.json package-lock.json vitest.config.ts
git commit -m "chore: add vitest test tooling"
```

---

## Task 2: Seed-RNG-Modul

**Files:**
- Create: `src/generator/rng.ts`
- Test: `src/generator/rng.test.ts`

- [ ] **Step 1: Failing test schreiben**

Create `src/generator/rng.test.ts`:
```ts
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
```

- [ ] **Step 2: Test verifizieren (fail)**

Run: `npx vitest run src/generator/rng.test.ts`
Expected: FAIL — "Failed to resolve import './rng'".

- [ ] **Step 3: Implementierung schreiben**

Create `src/generator/rng.ts`:
```ts
/** Small fast deterministic PRNG (mulberry32) — same pattern the plugins use. */
export function makeRng(seed: number): () => number {
  let a = (seed | 0) ^ 0x9e3779b9;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Linear interpolation. */
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Deterministically pick one item using the given rng. */
export function pick<T>(items: readonly T[], rng: () => number): T {
  return items[Math.floor(rng() * items.length) % items.length];
}
```

- [ ] **Step 4: Test verifizieren (pass)**

Run: `npx vitest run src/generator/rng.test.ts`
Expected: PASS — alle 3 describe-Blöcke grün.

- [ ] **Step 5: Commit**

```bash
git add src/generator/rng.ts src/generator/rng.test.ts
git commit -m "feat: deterministic seeded rng helpers for the generator"
```

---

## Task 3: Recipe-Typen, Marathon-Palette & Defaults

**Files:**
- Create: `src/generator/recipe.ts`

(Reine Typen/Konstanten — wird in Task 4 durch die `plan`-Tests mitgetestet; kein eigener Test nötig.)

- [ ] **Step 1: Modul schreiben**

Create `src/generator/recipe.ts`:
```ts
import type { RGBA, ResolutionPreset } from "@/engine";

/** Element-Typen, die der Simple Mode dieser Iteration anbietet. */
export type ElementType = "noise" | "boids" | "text";

export const SIMPLE_ELEMENTS: { type: ElementType; label: string; icon: string }[] = [
  { type: "noise", label: "Noise", icon: "Cloudy" },
  { type: "boids", label: "Boids", icon: "Bird" },
  { type: "text", label: "Text", icon: "Type" },
];

export interface Recipe {
  /** Gewählte Element-Typen (Reihenfolge egal). */
  elements: ElementType[];
  /** 0..1 — Bewegungsintensität. */
  dynamic: number;
  /** 0..1 — Dichte & Detail. */
  complexity: number;
  /** "Würfeln" ändert nur das. */
  seed: number;
  /** Social-Format (Breite/Höhe der Komposition). */
  format: { label: string; width: number; height: number };
}

/** Marathon-Hausstil: dunkler Hintergrund + 6-Farben-Palette für fx.colorLookup. */
export const MARATHON_BG: RGBA = [12, 12, 16, 255];
export const MARATHON_PALETTE: RGBA[] = [
  [255, 90, 31, 255], // orange
  [234, 2, 126, 255], // magenta
  [0, 200, 180, 255], // teal
  [30, 20, 90, 255], // deep blue
  [12, 12, 16, 255], // near-black
  [235, 235, 240, 255], // off-white
];

/** Kurze, on-brand Phrasen, aus denen der Text-Layer per Seed eine wählt. */
export const MARATHON_TAGLINES = ["MARATHON", "RUN IT BACK", "NO ESCAPE", "RECLAIM", "SEVENTH COLUMN"];

export const DEFAULT_RECIPE: Recipe = {
  elements: ["noise", "boids"],
  dynamic: 0.5,
  complexity: 0.5,
  seed: 1,
  format: { label: "Instagram Story / Reel", width: 1080, height: 1920 },
};

/** Helper: ein ResolutionPreset auf das Recipe-Format reduzieren. */
export function formatFromPreset(p: ResolutionPreset): Recipe["format"] {
  return { label: p.label, width: p.width, height: p.height };
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: Exit 0 (keine Fehler).

- [ ] **Step 3: Commit**

```bash
git add src/generator/recipe.ts
git commit -m "feat: recipe types, marathon palette and defaults"
```

---

## Task 4: Reiner Planner (`planScene` + Element-Builder)

**Files:**
- Create: `src/generator/plan.ts`
- Test: `src/generator/plan.test.ts`

- [ ] **Step 1: Failing test schreiben**

Create `src/generator/plan.test.ts`:
```ts
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
    // amplitude (last arg of wiggle) larger when dynamic is higher
    const amp = (s: string) => Number(s.match(/wiggle\([^,]+,\s*([0-9.]+)\)/)![1]);
    expect(amp(textLively.expressions!.rotation!)).toBeGreaterThan(
      amp(textStill.expressions!.rotation!),
    );
  });
});
```

- [ ] **Step 2: Test verifizieren (fail)**

Run: `npx vitest run src/generator/plan.test.ts`
Expected: FAIL — "Failed to resolve import './plan'".

- [ ] **Step 3: Implementierung schreiben**

Create `src/generator/plan.ts`:
```ts
import type { PropertyValue, RGBA, Vec2 } from "@/engine";
import { makeRng, lerp, pick } from "./rng";
import {
  MARATHON_BG,
  MARATHON_PALETTE,
  MARATHON_TAGLINES,
  type ElementType,
  type Recipe,
} from "./recipe";

/** One layer the generator wants to create, described declaratively. */
export interface SceneLayerSpec {
  type: string;
  name: string;
  /** Overrides for schema-defined property defaults (by key). */
  props?: Record<string, PropertyValue>;
  /** Optional expression strings keyed by property key. */
  expressions?: Record<string, string>;
  /** Transform overrides (position/anchor/scale/rotation). */
  transform?: { position?: Vec2; anchor?: Vec2; scale?: Vec2; rotation?: number };
}

export interface SceneSpec {
  background: RGBA;
  /** Index 0 = top (renders on top), mirroring the composition's stack order. */
  layers: SceneLayerSpec[];
}

interface BuildCtx {
  dynamic: number;
  complexity: number;
  rng: () => number;
  width: number;
  height: number;
}

/** Each element type contributes exactly one content layer (this iteration). */
const ELEMENT_BUILDERS: Record<ElementType, (ctx: BuildCtx) => SceneLayerSpec> = {
  noise: (ctx) => ({
    type: "noise",
    name: "Noise Field",
    props: {
      seed: Math.floor(ctx.rng() * 99999),
      speed: round2(lerp(0.02, 1.5, ctx.dynamic)),
      scale: round2(lerp(2, 7, ctx.complexity)),
      octaves: Math.round(lerp(2, 7, ctx.complexity)),
      bands: Math.round(lerp(0, 8, ctx.complexity)),
      contrast: 1.4,
      colorLow: [12, 12, 16, 255] as RGBA,
      colorHigh: [255, 90, 31, 255] as RGBA,
    },
  }),
  boids: (ctx) => ({
    type: "boids",
    name: "Boids",
    props: {
      seed: Math.floor(ctx.rng() * 99999),
      count: Math.round(lerp(120, 2500, ctx.complexity)),
      maxSpeed: round2(lerp(1.0, 9, ctx.dynamic)),
      maxForce: round2(lerp(0.2, 0.8, ctx.dynamic)),
      trail: Math.round(lerp(0, 50, ctx.dynamic)),
      color: [235, 235, 240, 255] as RGBA,
      size: round2(lerp(5, 12, 1 - ctx.complexity)),
    },
  }),
  text: (ctx) => ({
    type: "text",
    name: "Headline",
    props: {
      text: pick(MARATHON_TAGLINES, ctx.rng),
      bold: true,
      tracking: 8,
      fontSize: Math.round(ctx.width * 0.12),
      color: [255, 90, 31, 255] as RGBA,
    },
    expressions: {
      // base value (0) + procedural rotation noise; amplitude grows with dynamic
      rotation: `wiggle(${round2(0.4 + ctx.dynamic * 1.6)}, ${round2(ctx.dynamic * 6)})`,
    },
    transform: { position: [ctx.width / 2, ctx.height * 0.2] },
  }),
};

/** The Marathon house-style pass: a colorLookup effect that snaps every colour below. */
function houseStyleLayer(): SceneLayerSpec {
  const props: Record<string, PropertyValue> = { count: 6, amount: 1 };
  MARATHON_PALETTE.forEach((c, i) => (props[`color${i}`] = c));
  return { type: "fx.colorLookup", name: "Marathon Look", props };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Pure, deterministic: a recipe + canvas size → a full SceneSpec. No engine, no DOM.
 * Element content layers are stacked under a single colorLookup house-style layer.
 */
export function planScene(recipe: Recipe, width: number, height: number): SceneSpec {
  const rng = makeRng(recipe.seed);
  const ctx: BuildCtx = {
    dynamic: clamp01(recipe.dynamic),
    complexity: clamp01(recipe.complexity),
    rng,
    width,
    height,
  };
  // Deterministic, de-duplicated element order.
  const chosen = (["noise", "boids", "text"] as ElementType[]).filter((t) =>
    recipe.elements.includes(t),
  );
  const content = chosen.map((t) => ELEMENT_BUILDERS[t](ctx));
  // Index 0 = top → house style first, then content (text above sims above noise).
  return { background: MARATHON_BG, layers: [houseStyleLayer(), ...content.reverse()] };
}

function clamp01(n: number): number {
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

export { ELEMENT_BUILDERS };
```

- [ ] **Step 4: Test verifizieren (pass)**

Run: `npx vitest run src/generator/plan.test.ts`
Expected: PASS — alle Tests grün.

> Hinweis: Die `rng`-Aufrufe in den Buildern bestimmen die Seed-Abhängigkeit. Weil `text` zuerst `pick` (1 rng-Aufruf) macht und `noise`/`boids` je `seed` ziehen, ist die Reihenfolge stabil (feste `chosen`-Reihenfolge). Daher ist der "changes with the seed"-Test erfüllt.

- [ ] **Step 5: Commit**

```bash
git add src/generator/plan.ts src/generator/plan.test.ts
git commit -m "feat: pure deterministic scene planner with element builders + marathon house style"
```

---

## Task 5: Applier (`applyScene` + `buildLayerFromSpec` + `sceneHash`)

**Files:**
- Create: `src/generator/apply.ts`
- Test: `src/generator/apply.test.ts`

- [ ] **Step 1: Failing test schreiben**

Create `src/generator/apply.test.ts`:
```ts
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
```

- [ ] **Step 2: Test verifizieren (fail)**

Run: `npx vitest run src/generator/apply.test.ts`
Expected: FAIL — "Failed to resolve import './apply'".

- [ ] **Step 3: Implementierung schreiben**

Create `src/generator/apply.ts`:
```ts
import { Layer, Property, type Engine, type Composition, type RGBA } from "@/engine";
import type { SceneLayerSpec, SceneSpec } from "./plan";

/** Build a real Layer from a SceneLayerSpec, using the registered type's schema. */
export function buildLayerFromSpec(engine: Engine, comp: Composition, spec: SceneLayerSpec): Layer {
  const def = engine.registry.get(spec.type);
  const size = def?.defaultSize?.(comp) ?? [comp.width, comp.height];
  const props = (def?.schema ?? []).map((s) => {
    const value = spec.props?.[s.key] ?? s.default;
    const prop = new Property({
      key: s.key,
      name: s.name,
      type: s.type,
      value,
      meta: s.meta,
      group: s.group,
      animatable: s.animatable,
    });
    const expr = spec.expressions?.[s.key];
    if (expr) prop.expression = expr;
    return prop;
  });
  return new Layer({
    type: spec.type,
    name: comp.uniqueLayerName(spec.name),
    size: size as [number, number],
    props,
    data: def?.defaultData?.() ?? {},
    transform: {
      anchor: spec.transform?.anchor ?? [size[0] / 2, size[1] / 2],
      position: spec.transform?.position ?? [comp.width / 2, comp.height / 2],
      scale: spec.transform?.scale,
      rotation: spec.transform?.rotation,
    },
  });
}

/** Replace the active composition's layers + background with the scene, atomically. */
export function applyScene(engine: Engine, spec: SceneSpec): void {
  const comp = engine.comp;
  const prevLayers = comp.layers;
  const prevBg = comp.background;
  const next = spec.layers.map((s) => buildLayerFromSpec(engine, comp, s));
  engine.history.execute({
    label: "Generate",
    do: () => {
      comp.layers = next;
      comp.background = spec.background as RGBA;
    },
    undo: () => {
      comp.layers = prevLayers;
      comp.background = prevBg;
    },
  });
  engine.clearSelection();
  engine.renderNow();
}

/** Stable djb2 hash of the composition's serialized layers + background. */
export function sceneHash(comp: Composition): string {
  const json = JSON.stringify({
    background: comp.background,
    layers: comp.layers.map((l) => l.toJSON()),
  });
  let h = 5381;
  for (let i = 0; i < json.length; i++) h = ((h << 5) + h + json.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}
```

- [ ] **Step 4: Test verifizieren (pass)**

Run: `npx vitest run src/generator/apply.test.ts`
Expected: PASS — beide describe-Blöcke grün.

> Falls `new Engine()` in jsdom an einem fehlenden Browser-API scheitert: in `vitest.config.ts` ist `environment: "jsdom"` gesetzt, das stellt `window`/`document`/`localStorage` bereit. Die Engine wird hier NICHT gemountet (kein Canvas-Rendering), daher genügt jsdom.

- [ ] **Step 5: Commit**

```bash
git add src/generator/apply.ts src/generator/apply.test.ts
git commit -m "feat: apply scene specs to the engine as one undoable transaction"
```

---

## Task 6: Generate-Orchestrator (`regenerate` / `getRecipe` / `isRecipeClean`)

**Files:**
- Create: `src/generator/generate.ts`
- Test: `src/generator/generate.test.ts`

- [ ] **Step 1: Failing test schreiben**

Create `src/generator/generate.test.ts`:
```ts
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
```

- [ ] **Step 2: Test verifizieren (fail)**

Run: `npx vitest run src/generator/generate.test.ts`
Expected: FAIL — "Failed to resolve import './generate'".

- [ ] **Step 3: Implementierung schreiben**

Create `src/generator/generate.ts`:
```ts
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
```

- [ ] **Step 4: Test verifizieren (pass)**

Run: `npx vitest run src/generator/generate.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/generator/generate.ts src/generator/generate.test.ts
git commit -m "feat: regenerate orchestrator with recipe persistence and clean-state tracking"
```

---

## Task 7: Mode-Persistenz (`modeStorage`)

**Files:**
- Create: `src/ui/mode/modeStorage.ts`
- Test: `src/ui/mode/modeStorage.test.ts`

- [ ] **Step 1: Failing test schreiben**

Create `src/ui/mode/modeStorage.test.ts`:
```ts
import { describe, it, expect, beforeEach } from "vitest";
import { loadMode, saveMode, type UiMode } from "./modeStorage";

describe("modeStorage", () => {
  beforeEach(() => localStorage.clear());

  it("defaults to simple when nothing is stored", () => {
    expect(loadMode()).toBe("simple");
  });

  it("round-trips a saved mode", () => {
    saveMode("pro");
    expect(loadMode()).toBe("pro");
  });

  it("falls back to simple on a corrupt value", () => {
    localStorage.setItem("marathon.uiMode", "garbage");
    const v: UiMode = loadMode();
    expect(v).toBe("simple");
  });
});
```

- [ ] **Step 2: Test verifizieren (fail)**

Run: `npx vitest run src/ui/mode/modeStorage.test.ts`
Expected: FAIL — "Failed to resolve import './modeStorage'".

- [ ] **Step 3: Implementierung schreiben**

Create `src/ui/mode/modeStorage.ts`:
```ts
export type UiMode = "simple" | "pro";

const KEY = "marathon.uiMode";

export function loadMode(): UiMode {
  try {
    const v = localStorage.getItem(KEY);
    return v === "pro" ? "pro" : "simple";
  } catch {
    return "simple";
  }
}

export function saveMode(mode: UiMode): void {
  try {
    localStorage.setItem(KEY, mode);
  } catch {
    /* ignore (private mode / SSR) */
  }
}
```

- [ ] **Step 4: Test verifizieren (pass)**

Run: `npx vitest run src/ui/mode/modeStorage.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/ui/mode/modeStorage.ts src/ui/mode/modeStorage.test.ts
git commit -m "feat: ui mode persistence in localStorage"
```

---

## Task 8: Mode-Context (`ModeProvider` + `useMode`)

**Files:**
- Create: `src/ui/mode/ModeProvider.tsx`

(UI-Wiring; verifiziert per typecheck. Die Logik dahinter ist in Task 7 getestet.)

- [ ] **Step 1: Provider schreiben**

Create `src/ui/mode/ModeProvider.tsx`:
```tsx
import * as React from "react";
import { createContext, useContext, useState, useCallback } from "react";
import { loadMode, saveMode, type UiMode } from "./modeStorage";

interface ModeContextValue {
  mode: UiMode;
  setMode: (mode: UiMode) => void;
}

const ModeContext = createContext<ModeContextValue | null>(null);

export function ModeProvider({ children }: { children: React.ReactNode }) {
  const [mode, setModeState] = useState<UiMode>(() => loadMode());
  const setMode = useCallback((next: UiMode) => {
    setModeState(next);
    saveMode(next);
  }, []);
  return <ModeContext.Provider value={{ mode, setMode }}>{children}</ModeContext.Provider>;
}

export function useMode(): ModeContextValue {
  const ctx = useContext(ModeContext);
  if (!ctx) throw new Error("useMode must be used within <ModeProvider>");
  return ctx;
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: Exit 0.

- [ ] **Step 3: Commit**

```bash
git add src/ui/mode/ModeProvider.tsx
git commit -m "feat: mode context provider and useMode hook"
```

---

## Task 9: App nach Modus verzweigen (`ProApp` auslagern)

**Files:**
- Create: `src/ui/ProApp.tsx`
- Modify: `src/ui/App.tsx`
- Modify: `src/main.tsx`

- [ ] **Step 1: Aktuellen App-Inhalt nach `ProApp` kopieren**

Create `src/ui/ProApp.tsx` mit dem HEUTIGEN Inhalt von `src/ui/App.tsx`, aber die Komponente in `ProApp` umbenennen. Voller Inhalt:
```tsx
import { useEffect } from "react";
import { useEngine } from "@/ui/engine/EngineProvider";
import { Toolbar } from "@/ui/panels/Toolbar";
import { Viewport } from "@/ui/panels/Viewport";
import { LayersPanel } from "@/ui/panels/LayersPanel";
import { Inspector } from "@/ui/panels/Inspector";
import { Timeline } from "@/ui/panels/Timeline";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/ui/components/ui/resizable";

function isTyping(): boolean {
  const el = document.activeElement as HTMLElement | null;
  return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable);
}

export function ProApp() {
  const engine = useEngine();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        e.shiftKey ? engine.history.redo() : engine.history.undo();
        return;
      }
      if (mod && e.key.toLowerCase() === "y") {
        e.preventDefault();
        engine.history.redo();
        return;
      }
      if (mod && e.key.toLowerCase() === "d" && engine.selection.length) {
        e.preventDefault();
        engine.duplicateLayers(engine.selection);
        return;
      }
      if (isTyping()) return;
      if (e.code === "Space") {
        e.preventDefault();
        engine.togglePlay();
      } else if (e.key === "Delete" || e.key === "Backspace") {
        if (engine.selection.length) {
          e.preventDefault();
          engine.removeLayers(engine.selection);
        }
      } else if (e.key === "ArrowRight") {
        engine.step(e.shiftKey ? 10 : 1);
      } else if (e.key === "ArrowLeft") {
        engine.step(e.shiftKey ? -10 : -1);
      } else if (e.key === "Home") {
        engine.seek(0);
      } else if (e.key === "End") {
        engine.seek(engine.comp.duration);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [engine]);

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden">
      <Toolbar />
      <ResizablePanelGroup direction="vertical" className="flex-1">
        <ResizablePanel defaultSize={66} minSize={30}>
          <ResizablePanelGroup direction="horizontal">
            <ResizablePanel defaultSize={18} minSize={12} className="border-r border-edge bg-panel">
              <LayersPanel />
            </ResizablePanel>
            <ResizableHandle />
            <ResizablePanel defaultSize={56} minSize={30}>
              <Viewport />
            </ResizablePanel>
            <ResizableHandle />
            <ResizablePanel defaultSize={26} minSize={16} className="border-l border-edge bg-panel">
              <Inspector />
            </ResizablePanel>
          </ResizablePanelGroup>
        </ResizablePanel>
        <ResizableHandle withHandle />
        <ResizablePanel defaultSize={34} minSize={12}>
          <Timeline />
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
}
```

- [ ] **Step 2: `App.tsx` auf eine Verzweigung reduzieren**

Replace the entire contents of `src/ui/App.tsx` with:
```tsx
import { useMode } from "@/ui/mode/ModeProvider";
import { ProApp } from "@/ui/ProApp";
import { SimpleApp } from "@/ui/SimpleApp";

export default function App() {
  const { mode } = useMode();
  return mode === "simple" ? <SimpleApp /> : <ProApp />;
}
```

> `SimpleApp` existiert erst nach Task 12 — der Typecheck in diesem Task wird daher den fehlenden Import melden. Das ist erwartet; Schritt 4 dieses Tasks legt einen temporären Stub an, damit der Build grün bleibt, bis Task 12 die echte Komponente liefert.

- [ ] **Step 3: `main.tsx` mit `ModeProvider` umschließen und Default-Szene generieren**

Replace the contents of `src/main.tsx` with:
```tsx
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import { Engine, Exporter, serializeProject } from "@/engine";
import { registerBuiltins } from "@/plugins";
import { EngineProvider } from "@/ui/engine/EngineProvider";
import { ModeProvider } from "@/ui/mode/ModeProvider";
import { regenerate } from "@/generator/generate";
import { DEFAULT_RECIPE } from "@/generator/recipe";
import App from "@/ui/App";

const engine = new Engine();
registerBuiltins(engine.registry);

// Open on a generated, on-brand scene so Simple Mode has something live from the start.
engine.setCompositionSettings({ width: DEFAULT_RECIPE.format.width, height: DEFAULT_RECIPE.format.height });
regenerate(engine, DEFAULT_RECIPE);
engine.history.clear();

engine.mount({
  offscreenContainer: document.getElementById("offscreen-host")!,
  pixelRatio: window.devicePixelRatio || 1,
});

if (import.meta.env.DEV) {
  (window as any).marathon = {
    engine,
    exporter: new Exporter(engine),
    serialize: () => serializeProject(engine.project),
  };
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ModeProvider>
      <EngineProvider engine={engine}>
        <App />
      </EngineProvider>
    </ModeProvider>
  </StrictMode>,
);
```

- [ ] **Step 4: Temporären SimpleApp-Stub anlegen (wird in Task 12 ersetzt)**

Create `src/ui/SimpleApp.tsx`:
```tsx
export function SimpleApp() {
  return <div className="p-4 text-sm text-ink">Simple Mode (Platzhalter)</div>;
}
```

- [ ] **Step 5: Typecheck + Tests**

Run: `npm run typecheck && npm test`
Expected: Exit 0; alle Tests weiterhin grün.

- [ ] **Step 6: Commit**

```bash
git add src/ui/App.tsx src/ui/ProApp.tsx src/ui/SimpleApp.tsx src/main.tsx
git commit -m "refactor: branch App between SimpleApp and ProApp; generate default scene"
```

---

## Task 10: `SimpleToolbar` (Format-Quickpick, Play, Export, Pro-Schalter)

**Files:**
- Create: `src/ui/panels/SimpleToolbar.tsx`

- [ ] **Step 1: Komponente schreiben**

Create `src/ui/panels/SimpleToolbar.tsx`:
```tsx
import { useMemo } from "react";
import { Pause, Play, Download, SlidersHorizontal } from "lucide-react";
import { Exporter, RESOLUTION_PRESETS, type ResolutionPreset } from "@/engine";
import { useEngine, useRevision, useTime } from "@/ui/engine/EngineProvider";
import { useMode } from "@/ui/mode/ModeProvider";
import { getRecipe, regenerate } from "@/generator/generate";
import { formatFromPreset } from "@/generator/recipe";
import { Button } from "@/ui/components/ui/button";
import { Separator } from "@/ui/components/ui/separator";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/ui/components/ui/select";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/ui/components/ui/dropdown-menu";

/** Curated social formats for Simple Mode. */
const SIMPLE_FORMATS: ResolutionPreset[] = RESOLUTION_PRESETS.filter((p) =>
  ["Instagram Story / Reel", "Instagram Post", "TikTok", "Square 1080", "YouTube Thumbnail"].includes(p.label),
);

export function SimpleToolbar() {
  const engine = useEngine();
  useRevision();
  const { playing } = useTime();
  const { setMode } = useMode();
  const exporter = useMemo(() => new Exporter(engine), [engine]);

  const current = `${engine.comp.width}x${engine.comp.height}`;
  const matched = SIMPLE_FORMATS.find((p) => `${p.width}x${p.height}` === current);

  const run = (fn: () => Promise<unknown>) => () =>
    fn().catch((err) => alert((err as Error).message));

  const onFormat = (value: string) => {
    const p = SIMPLE_FORMATS.find((f) => `${f.width}x${f.height}` === value);
    if (!p) return;
    engine.setCompositionSettings({ width: p.width, height: p.height });
    // Re-flow the current recipe into the new canvas size.
    const recipe = getRecipe(engine);
    if (recipe) regenerate(engine, { ...recipe, format: formatFromPreset(p) });
  };

  return (
    <div className="flex h-12 shrink-0 items-center gap-2 border-b border-edge bg-panel px-3">
      <span className="select-none px-1 text-sm font-semibold tracking-tight text-accent">◇ Marathon</span>
      <Separator orientation="vertical" className="mx-1 h-5" />

      <Select value={matched ? `${matched.width}x${matched.height}` : "custom"} onValueChange={onFormat}>
        <SelectTrigger className="w-52">
          <SelectValue placeholder="Format">{matched ? matched.label : "Custom"}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {SIMPLE_FORMATS.map((p) => (
            <SelectItem key={p.label} value={`${p.width}x${p.height}`}>
              {p.label} · {p.width}×{p.height}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Button size="icon-sm" variant={playing ? "accent" : "ghost"} onClick={() => engine.togglePlay()} title="Play / Pause">
        {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
      </Button>

      <div className="flex-1" />

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="sm" variant="accent"><Download className="h-3.5 w-3.5" /> Export</Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={run(() => exporter.still("png"))}>Bild (PNG)</DropdownMenuItem>
          <DropdownMenuItem onSelect={run(() => exporter.webm())}>Video (WebM)</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Separator orientation="vertical" className="mx-1 h-5" />
      <Button size="sm" variant="ghost" onClick={() => setMode("pro")} title="Alle Optionen anzeigen">
        <SlidersHorizontal className="h-3.5 w-3.5" /> Pro Mode ▸
      </Button>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: Exit 0.

> Falls `Button` die Variante `"accent"` oder Größe `"icon-sm"` nicht kennt, prüfe `src/ui/components/ui/button.tsx` und nutze die dort definierten Varianten (Toolbar.tsx verwendet exakt `variant="accent"`, `size="icon-sm"` und `size="sm"`, daher sind sie vorhanden).

- [ ] **Step 3: Commit**

```bash
git add src/ui/panels/SimpleToolbar.tsx
git commit -m "feat: simple-mode toolbar with format picker, export and pro toggle"
```

---

## Task 11: `SimplePanel` (Element-Chips, Dynamik, Komplexität, Würfeln)

**Files:**
- Create: `src/ui/panels/SimplePanel.tsx`

- [ ] **Step 1: Komponente schreiben**

Create `src/ui/panels/SimplePanel.tsx`:
```tsx
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
```

> Die Slider verwenden `onValueChange` für eine flüssige Anzeige (nur lokaler State) und `onValueCommit` zum tatsächlichen Generieren beim Loslassen — so wird nicht bei jedem Pixel neu generiert. Prüfe in `src/ui/components/ui/slider.tsx`, dass `onValueCommit` durchgereicht wird (Radix Slider unterstützt es nativ; das Shadcn-Wrapper-Pattern reicht alle Props per `{...props}` durch). Falls nicht, ergänze `onValueCommit` an der Prop-Weitergabe.

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: Exit 0.

- [ ] **Step 3: Commit**

```bash
git add src/ui/panels/SimplePanel.tsx
git commit -m "feat: simple-mode control panel (elements, dynamic, complexity, dice)"
```

---

## Task 12: `SimpleApp` zusammensetzen (ersetzt den Stub)

**Files:**
- Modify: `src/ui/SimpleApp.tsx`

- [ ] **Step 1: Stub durch echte Shell ersetzen**

Replace the entire contents of `src/ui/SimpleApp.tsx` with:
```tsx
import { useEffect } from "react";
import { useEngine } from "@/ui/engine/EngineProvider";
import { Viewport } from "@/ui/panels/Viewport";
import { SimpleToolbar } from "@/ui/panels/SimpleToolbar";
import { SimplePanel } from "@/ui/panels/SimplePanel";

function isTyping(): boolean {
  const el = document.activeElement as HTMLElement | null;
  return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable);
}

export function SimpleApp() {
  const engine = useEngine();

  // Minimal shortcut: space toggles playback (no editing shortcuts in simple mode).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping()) return;
      if (e.code === "Space") {
        e.preventDefault();
        engine.togglePlay();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [engine]);

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden">
      <SimpleToolbar />
      <div className="flex flex-1 overflow-hidden">
        <div className="flex-1">
          <Viewport />
        </div>
        <div className="w-72 shrink-0 border-l border-edge bg-panel">
          <SimplePanel />
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck + Tests + Build**

Run: `npm run typecheck && npm test && npm run build`
Expected: Exit 0; alle Tests grün; Production-Build erfolgreich.

- [ ] **Step 3: Commit**

```bash
git add src/ui/SimpleApp.tsx
git commit -m "feat: assemble SimpleApp shell (viewport + simple toolbar + panel)"
```

---

## Task 13: Pro→Simple-Rückschalter + manuelle Verifikation

**Files:**
- Modify: `src/ui/panels/Toolbar.tsx`

- [ ] **Step 1: „Simple"-Button in die Pro-Toolbar einbauen**

In `src/ui/panels/Toolbar.tsx`:

(a) Den `useMode`-Import ergänzen — direkt nach der bestehenden EngineProvider-Importzeile:
```tsx
import { useEngine, useRevision, useTime } from "@/ui/engine/EngineProvider";
import { useMode } from "@/ui/mode/ModeProvider";
```

(b) Eine Lucide-Icon-Import-Zeile erweitern — füge `LayoutGrid` zur bestehenden `lucide-react`-Importliste hinzu (alphabetisch z.B. nach `FolderOpen`).

(c) In der `Toolbar`-Funktion, direkt nach `const engine = useEngine();`, ergänzen:
```tsx
  const { setMode } = useMode();
```

(d) Den Rückschalter neben den Projektnamen setzen — direkt NACH der ersten `<Separator orientation="vertical" className="mx-1 h-5" />`-Zeile (der nach dem Projektnamen-Input), diesen Button einfügen:
```tsx
      <Button size="sm" variant="ghost" onClick={() => setMode("simple")} title="Zurück zum Simple Mode">
        <LayoutGrid className="h-3.5 w-3.5" /> Simple
      </Button>
```

- [ ] **Step 2: Typecheck + Tests**

Run: `npm run typecheck && npm test`
Expected: Exit 0; alle Tests grün.

- [ ] **Step 3: Manuelle Verifikation im Dev-Server**

Run: `npm run dev`
Im Browser unter http://localhost:5173 prüfen:
1. App öffnet im **Simple Mode** (große Vorschau links, schmale Sidebar rechts, schlanke Toolbar oben) und zeigt ein generiertes, eingefärbtes Visual.
2. **Element-Chips** togglen Layer (z.B. „Boids" an/aus) → Vorschau ändert sich.
3. **Dynamik**-Slider hochziehen und loslassen → mehr Bewegung. **Komplexität** hoch → dichter.
4. **Würfeln** → anderes Visual, gleiche Stilfarben.
5. **Format**-Quickpick wechseln (z.B. Square 1080) → Canvas-Format ändert sich, Szene re-flowt.
6. **Export → Bild (PNG)** lädt eine PNG herunter.
7. **„Pro Mode ▸"** → volles Interface (Layers/Inspector/Timeline) mit DERSELBEN Szene.
8. Im Pro Mode einen Layer-Namen/Property ändern, **„◇ Simple"** klicken, dann einen Slider bewegen → **Warn-Dialog** erscheint („manuelle Änderungen gehen verloren"). Abbrechen lässt die Szene unverändert; Bestätigen generiert neu.
9. Browser neu laden → Modus wird gemerkt (zuletzt gewählter Modus).

- [ ] **Step 4: Commit**

```bash
git add src/ui/panels/Toolbar.tsx
git commit -m "feat: add simple-mode return button to the pro toolbar"
```

---

## Self-Review (vom Autor durchgeführt)

**Spec-Coverage:**
- Generierungs-Modell „prozedurale Rezept-Engine" → Tasks 3–6 (Recipe + planScene + ELEMENT_BUILDERS + regenerate). ✓
- „Gleiche Komposition, nur anderer Editor" → Task 5 (applyScene baut echte Layer in `engine.comp`), Task 9 (App-Verzweigung, gemeinsame Engine). ✓
- Marathon-Hausstil automatisch → `houseStyleLayer()` + `MARATHON_PALETTE`/`MARATHON_BG` in Tasks 3–4. ✓
- Dynamik/Komplexität-Mappings → Task 4 (ELEMENT_BUILDERS) + Tests. ✓
- Recipe im Projekt gespeichert → Task 6 (`project.meta`), serialisiert via vorhandenem `Project.toJSON` (kein Code nötig). ✓
- Eine Undo-Stufe pro Generierung → Task 5 (`history.execute`) + Test „single undoable transaction". ✓
- UI Layout B (Viewport links, Sidebar rechts) → Tasks 10–12. ✓
- Social-Format-Quickpick, Export, Play, Pro-Schalter → Task 10. ✓
- Element-Chips, Dynamik/Komplexität-Slider, Würfeln → Task 11. ✓
- Modus-Persistenz (localStorage) → Tasks 7–8. ✓
- Simple↔Pro Übergang inkl. „dirty"-Warnung → Task 6 (`isRecipeClean`) + Task 11 (`window.confirm`) + Tasks 9/13 (Umschalter). ✓
- Testbarkeit (deterministischer Generator, Modus-Toggle-Logik) → Tasks 2,4,5,6,7. ✓

**Bewusst out-of-scope (laut Spec, „YAGNI"):** weitere Element-Typen über noise/boids/text hinaus; mehrere wählbare Paletten; Reverse-Engineering von Pro-Edits ins Recipe.

**Platzhalter-Scan:** keine TBD/TODO; jeder Code-Step enthält vollständigen Code. ✓

**Typ-Konsistenz:** `Recipe`, `ElementType`, `SceneSpec`/`SceneLayerSpec`, `regenerate/getRecipe/isRecipeClean`, `planScene`, `applyScene/sceneHash/buildLayerFromSpec`, `loadMode/saveMode/UiMode`, `useMode` durchgängig identisch benannt zwischen Definition (frühe Tasks) und Verwendung (UI-Tasks). ✓
