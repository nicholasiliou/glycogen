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

/**
 * One parameter knob, scaled within [lo, hi] by either the `dynamic` or `complexity`
 * axis. For an INVERSE relationship (higher axis → lower value, e.g. smaller cells =
 * denser), simply set `lo > hi` — `lerp` handles it.
 */
interface Knob {
  key: string;
  lo: number;
  hi: number;
  axis: "dynamic" | "complexity";
  /** Round to an integer (for count/octaves/resolution-style props). */
  round?: boolean;
}

/**
 * Declarative tuning for one element type. The generic builder turns this into a
 * SceneLayerSpec: it randomises the `seed` prop (if `seed`), applies any static `set`
 * overrides, scales each knob within its safe range, and attaches `expressions`/
 * `transform`. Colours are deliberately left at each plugin's defaults — the Marathon
 * colorLookup house-style pass remaps every colour anyway, so output stays on-brand.
 *
 * This table IS the extension seam: adding a new visual layer type means adding its id
 * to `ElementType`, an entry here, and listing it in `ALL_ELEMENTS` below.
 */
interface ElementTuning {
  label: string;
  /** Randomise the plugin's `seed` prop from the recipe rng. */
  seed?: boolean;
  /** Static, non-scaled prop overrides (may read ctx, e.g. the headline text). */
  set?: (ctx: BuildCtx) => Record<string, PropertyValue>;
  knobs?: Knob[];
  /** Expression strings keyed by prop key (e.g. a procedural wiggle). */
  expressions?: (ctx: BuildCtx) => Record<string, string>;
  transform?: (ctx: BuildCtx) => SceneLayerSpec["transform"];
}

const ELEMENT_TUNING: Record<ElementType, ElementTuning> = {
  solid: {
    label: "Solid",
  },
  noise: {
    label: "Noise Field",
    seed: true,
    set: () => ({ contrast: 1.4 }),
    knobs: [
      { key: "speed", lo: 0.02, hi: 1.5, axis: "dynamic" },
      { key: "scale", lo: 2, hi: 7, axis: "complexity" },
      { key: "octaves", lo: 2, hi: 7, axis: "complexity", round: true },
      { key: "bands", lo: 0, hi: 8, axis: "complexity", round: true },
    ],
  },
  cloud: {
    label: "Cloud",
    knobs: [
      { key: "speed", lo: 0.05, hi: 1.2, axis: "dynamic" },
      { key: "coverage", lo: 0.35, hi: 0.7, axis: "complexity" },
      { key: "density", lo: 0.8, hi: 2.2, axis: "complexity" },
      { key: "octaves", lo: 3, hi: 6, axis: "complexity", round: true },
    ],
  },
  reactionDiffusion: {
    label: "Reaction–Diffusion",
    seed: true,
    knobs: [
      { key: "iterations", lo: 4, hi: 24, axis: "dynamic", round: true },
      { key: "resolution", lo: 0.15, hi: 0.4, axis: "complexity" },
    ],
  },
  physarum: {
    label: "Slime Mold",
    seed: true,
    knobs: [
      { key: "speed", lo: 1, hi: 4, axis: "dynamic", round: true },
      { key: "count", lo: 2000, hi: 12000, axis: "complexity", round: true },
      { key: "resolution", lo: 0.25, hi: 0.5, axis: "complexity" },
    ],
  },
  landscape: {
    label: "Landscape",
    knobs: [
      { key: "speed", lo: 0.05, hi: 1.2, axis: "dynamic" },
      { key: "spin", lo: 2, hi: 40, axis: "dynamic" },
      { key: "resolution", lo: 24, hi: 90, axis: "complexity", round: true },
      { key: "octaves", lo: 3, hi: 7, axis: "complexity", round: true },
      { key: "amplitude", lo: 0.35, hi: 0.8, axis: "complexity" },
    ],
  },
  glyphScatter: {
    label: "Glyph Scatter",
    seed: true,
    knobs: [
      { key: "speed", lo: 0.05, hi: 1.5, axis: "dynamic" },
      { key: "cell", lo: 120, hi: 28, axis: "complexity", round: true }, // inverse: denser
      { key: "jitter", lo: 0, hi: 0.5, axis: "complexity" },
    ],
  },
  life: {
    label: "Game of Life",
    seed: true,
    knobs: [
      { key: "speed", lo: 1, hi: 6, axis: "dynamic", round: true },
      { key: "cellSize", lo: 24, hi: 6, axis: "complexity", round: true }, // inverse: denser
      { key: "density", lo: 0.15, hi: 0.5, axis: "complexity" },
    ],
  },
  plant: {
    label: "Plant",
    seed: true,
    set: () => ({ autoEvolve: true }),
    knobs: [
      { key: "spinSpeed", lo: 0, hi: 0.3, axis: "dynamic" },
      { key: "evolutionSpeed", lo: 0.1, hi: 6, axis: "dynamic" },
      { key: "iterations", lo: 2, hi: 6, axis: "complexity", round: true },
    ],
  },
  shape: {
    label: "3D Shape",
    knobs: [
      { key: "spin", lo: 4, hi: 80, axis: "dynamic" },
      { key: "resolution", lo: 16, hi: 70, axis: "complexity", round: true },
    ],
  },
  harmonograph: {
    label: "Harmonograph",
    knobs: [
      { key: "points", lo: 2000, hi: 16000, axis: "complexity", round: true },
      { key: "cycles", lo: 6, hi: 40, axis: "complexity", round: true },
    ],
    expressions: (ctx) => ({
      phase: `wiggle(${round2(0.3 + ctx.dynamic * 1.2)}, ${round2(ctx.dynamic * 40)})`,
    }),
  },
  wire: {
    label: "Wire / Arrow",
    knobs: [
      { key: "spin", lo: 0, hi: 120, axis: "dynamic" },
      { key: "resolution", lo: 16, hi: 200, axis: "complexity", round: true },
    ],
  },
  boids: {
    label: "Boids",
    seed: true,
    knobs: [
      { key: "maxSpeed", lo: 1.0, hi: 9, axis: "dynamic" },
      { key: "maxForce", lo: 0.2, hi: 0.8, axis: "dynamic" },
      { key: "trail", lo: 0, hi: 50, axis: "dynamic", round: true },
      { key: "count", lo: 120, hi: 2500, axis: "complexity", round: true },
      { key: "size", lo: 12, hi: 5, axis: "complexity" }, // inverse: smaller as it gets busier
    ],
  },
  glyph: {
    label: "Glyph",
    knobs: [{ key: "gap", lo: 0.04, hi: 0.4, axis: "complexity" }],
  },
  text: {
    label: "Headline",
    set: (ctx) => ({
      text: pick(MARATHON_TAGLINES, ctx.rng),
      bold: true,
      tracking: 8,
      fontSize: Math.round(ctx.width * 0.12),
    }),
    expressions: (ctx) => ({
      rotation: `wiggle(${round2(0.4 + ctx.dynamic * 1.6)}, ${round2(ctx.dynamic * 6)})`,
    }),
    transform: (ctx) => ({ position: [ctx.width / 2, ctx.height * 0.2] as Vec2 }),
  },
};

/** Build one content layer from its declarative tuning entry. */
function buildElement(type: ElementType, ctx: BuildCtx): SceneLayerSpec {
  const t = ELEMENT_TUNING[type];
  const props: Record<string, PropertyValue> = { ...(t.set?.(ctx) ?? {}) };
  if (t.seed) props.seed = Math.floor(ctx.rng() * 99999);
  for (const k of t.knobs ?? []) {
    const axisVal = k.axis === "dynamic" ? ctx.dynamic : ctx.complexity;
    const v = lerp(k.lo, k.hi, axisVal);
    props[k.key] = k.round ? Math.round(v) : round2(v);
  }
  return {
    type,
    name: t.label,
    props,
    expressions: t.expressions?.(ctx),
    transform: t.transform?.(ctx),
  };
}

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
 * Canonical stack order (bottom → top, before the final reverse): flat fills and fields
 * at the bottom, simulations and geometry above them, the headline on top. Update this
 * (and `ELEMENT_TUNING` + the `ElementType` union) when a new element type is added.
 */
const ALL_ELEMENTS: ElementType[] = [
  "solid",
  "noise",
  "cloud",
  "reactionDiffusion",
  "physarum",
  "landscape",
  "glyphScatter",
  "life",
  "plant",
  "shape",
  "harmonograph",
  "wire",
  "boids",
  "glyph",
  "text",
];

/**
 * Pure, deterministic: a recipe + canvas size → a full SceneSpec. No engine, no DOM.
 * Element content layers are stacked (in canonical order) under a single colorLookup
 * house-style layer.
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
  const chosen = ALL_ELEMENTS.filter((t) => recipe.elements.includes(t));
  const content = chosen.map((t) => buildElement(t, ctx));
  return { background: MARATHON_BG, layers: [houseStyleLayer(), ...content.reverse()] };
}

function clamp01(n: number): number {
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

export { ELEMENT_TUNING, ALL_ELEMENTS };
