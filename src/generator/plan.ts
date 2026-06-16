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

/** Canonical stack order (bottom → top, before the final reverse).
 *  Update this when a new ElementType + builder is added. */
const ALL_ELEMENTS: ElementType[] = ["noise", "boids", "text"];

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
  const chosen = ALL_ELEMENTS.filter((t) => recipe.elements.includes(t));
  const content = chosen.map((t) => ELEMENT_BUILDERS[t](ctx));
  return { background: MARATHON_BG, layers: [houseStyleLayer(), ...content.reverse()] };
}

function clamp01(n: number): number {
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

export { ELEMENT_BUILDERS };
