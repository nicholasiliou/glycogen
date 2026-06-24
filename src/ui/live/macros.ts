/**
 * Hand-crafted "macro" maps: each plugin declares how the small set of semantic control slots
 * (Amount/Growth, Evolve, Tone, Trigger, Toggle) drive its own parameters, so the *same*
 * physical control does the musically/visually sensible thing on whatever plugin is loaded —
 * the gain fader grows agents on physarum, the flock on boids, the cells on life… A generic
 * fallback derives slots from any plugin's schema so nothing is silent.
 *
 * The curve helpers are pure (unit-tested); the apply fns route a curve onto a live param via
 * the engine. MIDI drives visuals only — audio follows indirectly through the LivePerformer.
 */
import type { Engine, Layer, PropertySchema } from "@/engine";
import type { MidiControl } from "@/midi/types";
import type { Slot } from "@/midi/preset";

// ── curves (pure) ────────────────────────────────────────────────────────────────────────────

export const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
export const clamp01 = (v: number) => clamp(v, 0, 1);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Exponential "more of it" feel: bottom of the fader = a few, top = many (great for counts). */
export function growthCurve(unit: number, min: number, max: number): number {
  const u = clamp01(unit);
  if (min > 0 && max > 0) return min * Math.pow(max / min, u);
  return lerp(min, max, u);
}

/** Centre-detent potentiometer: 0→min, 0.5→the param's default, 1→max. */
export function centeredCurve(unit: number, min: number, max: number, def: number): number {
  const u = clamp01(unit);
  return u <= 0.5 ? lerp(min, def, u / 0.5) : lerp(def, max, (u - 0.5) / 0.5);
}

export function linearCurve(unit: number, min: number, max: number): number {
  return lerp(min, max, clamp01(unit));
}

/** Endless encoder: nudge the current value by a signed step, clamped to range. */
export function accumulate(current: number, delta: number, min: number, max: number, step: number): number {
  return clamp(current + delta * step, min, max);
}

// ── macro maps ────────────────────────────────────────────────────────────────────────────────

export type Curve = "growth" | "centered" | "linear";
export interface ContinuousSlot {
  key: string;
  curve: Curve;
  /** Per-tick size for relative (encoder) control; defaults to range/100. */
  step?: number;
}
export interface TriggerSlot {
  key: string;
  /** "reseed" → a new random seed; "bump" → +1. */
  action: "reseed" | "bump";
}
export interface ToggleSlot {
  key: string;
}
export interface MacroMap {
  amount?: ContinuousSlot;
  evolveX?: ContinuousSlot;
  evolveY?: ContinuousSlot;
  toneX?: ContinuousSlot;
  toneY?: ContinuousSlot;
  trigger?: TriggerSlot;
  toggle?: ToggleSlot;
}

const g = (key: string, curve: Curve = "growth"): ContinuousSlot => ({ key, curve });

/** Curated maps for the plugins whose params we know well. Keys verified against each schema. */
export const MACRO_MAPS: Record<string, MacroMap> = {
  physarum: {
    amount: g("count"),
    evolveX: { key: "sensorAngle", curve: "linear" },
    evolveY: { key: "turnAngle", curve: "linear" },
    toneX: { key: "gain", curve: "centered" },
    toneY: { key: "decay", curve: "centered" },
    trigger: { key: "seed", action: "reseed" },
    toggle: { key: "smooth" },
  },
  reactionDiffusion: {
    amount: g("iterations"),
    evolveX: { key: "feed", curve: "linear" },
    evolveY: { key: "kill", curve: "linear" },
    toneX: { key: "gain", curve: "centered" },
    trigger: { key: "seed", action: "reseed" },
    toggle: { key: "smooth" },
  },
  boids: {
    amount: g("count"),
    evolveX: { key: "alignment", curve: "linear" },
    evolveY: { key: "cohesion", curve: "linear" },
    toneX: { key: "maxSpeed", curve: "centered" },
    toneY: { key: "trail", curve: "centered" },
    trigger: { key: "seed", action: "reseed" },
    toggle: { key: "wrap" },
  },
  life: {
    amount: g("density", "linear"),
    evolveX: { key: "speed", curve: "linear" },
    evolveY: { key: "cellSize", curve: "linear" },
    toneX: { key: "trail", curve: "centered" },
    toneY: { key: "gap", curve: "centered" },
    trigger: { key: "seed", action: "reseed" },
    toggle: { key: "wrap" },
  },
  noise: {
    amount: g("octaves", "linear"),
    evolveX: { key: "scale", curve: "linear" },
    evolveY: { key: "contrast", curve: "linear" },
    toneX: { key: "speed", curve: "centered" },
    toneY: { key: "bands", curve: "linear" },
    trigger: { key: "seed", action: "reseed" },
    toggle: { key: "smooth" },
  },
  plant: {
    amount: g("iterations", "linear"),
    evolveX: { key: "spinSpeed", curve: "linear" },
    evolveY: { key: "evolutionSpeed", curve: "linear" },
    toneX: { key: "cameraScale", curve: "centered" },
    trigger: { key: "seed", action: "reseed" },
    toggle: { key: "autoEvolve" },
  },
  harmonograph: {
    amount: g("cycles", "linear"),
    evolveX: { key: "phase", curve: "linear" },
    evolveY: { key: "damping", curve: "linear" },
    toneX: { key: "lineWidth", curve: "centered" },
    toggle: { key: "glow" },
  },
};

const QUANTITY_KEYS = ["count", "density", "iterations", "octaves", "cycles", "points", "cells"];
const TONE_KEYS = ["gain", "contrast", "decay", "trail", "maxSpeed", "lineWidth", "damping"];
const CONTINUOUS_TYPES = new Set(["number", "angle", "percent"]);

/**
 * Generic fallback for plugins with no curated map: pick a quantity-ish number for Amount, the
 * next continuous ranges for Evolve/Tone, `seed` for Trigger, and the first boolean for Toggle.
 */
export function genericMacroMap(schema: PropertySchema[]): MacroMap {
  const ranges = schema.filter((s) => CONTINUOUS_TYPES.has(s.type) && s.animatable !== false);
  const used = new Set<string>();
  const next = (prefer: string[] = []): string | undefined => {
    const pick =
      ranges.find((s) => !used.has(s.key) && prefer.includes(s.key)) ?? ranges.find((s) => !used.has(s.key));
    if (pick) used.add(pick.key);
    return pick?.key;
  };
  const map: MacroMap = {};
  const amount = next(QUANTITY_KEYS);
  if (amount) map.amount = { key: amount, curve: "growth" };
  const ex = next();
  if (ex) map.evolveX = { key: ex, curve: "linear" };
  const ey = next();
  if (ey) map.evolveY = { key: ey, curve: "linear" };
  const tx = next(TONE_KEYS);
  if (tx) map.toneX = { key: tx, curve: "centered" };
  const ty = next(TONE_KEYS);
  if (ty) map.toneY = { key: ty, curve: "centered" };
  if (schema.some((s) => s.key === "seed")) map.trigger = { key: "seed", action: "reseed" };
  const toggle = schema.find((s) => s.type === "boolean");
  if (toggle) map.toggle = { key: toggle.key };
  return map;
}

export function macroMapFor(type: string, schema: PropertySchema[]): MacroMap {
  return MACRO_MAPS[type] ?? genericMacroMap(schema);
}

// ── apply ───────────────────────────────────────────────────────────────────────────────────

function bounds(ps: PropertySchema): { min: number; max: number; def: number } {
  let min = ps.meta?.min;
  let max = ps.meta?.max;
  if (min === undefined || max === undefined) {
    if (ps.type === "angle") [min, max] = [0, 360];
    else if (ps.type === "percent") [min, max] = [0, 1];
    else [min, max] = [0, 1];
  }
  const def = typeof ps.default === "number" ? ps.default : (min + max) / 2;
  return { min, max, def };
}

/**
 * Drive a continuous slot. Relative controls (encoders/jogs) accumulate — fixing the "jams to
 * 0/1" bug; absolute controls (faders/knobs) apply the slot's curve (growth / centered / linear).
 */
export function driveContinuousSlot(
  engine: Engine,
  layer: Layer,
  schema: PropertySchema[],
  spec: ContinuousSlot,
  ctl: Pick<MidiControl, "relative" | "value" | "delta">,
): void {
  const ps = schema.find((s) => s.key === spec.key);
  const prop = layer.property(spec.key);
  if (!ps || !prop) return;
  const { min, max, def } = bounds(ps);

  let value: number;
  if (ctl.relative) {
    const cur = Number(prop.valueAt(engine.transport.time));
    const step = spec.step ?? (max - min) / 100;
    value = accumulate(Number.isFinite(cur) ? cur : def, ctl.delta, min, max, step);
  } else {
    value =
      spec.curve === "growth"
        ? growthCurve(ctl.value, min, max)
        : spec.curve === "centered"
          ? centeredCurve(ctl.value, min, max, def)
          : linearCurve(ctl.value, min, max);
  }
  const step = ps.meta?.step;
  if (step && step >= 1) value = Math.round(value / step) * step;
  engine.setPropertyValue(layer.id, prop.id, value, true);
}

/** Fire a momentary slot (Trigger reseeds / bumps; Toggle flips a boolean). Call on press. */
export function fireMomentarySlot(
  engine: Engine,
  layer: Layer,
  schema: PropertySchema[],
  slot: Extract<Slot, "trigger" | "toggle">,
  spec: TriggerSlot | ToggleSlot,
): void {
  const prop = layer.property(spec.key);
  const ps = schema.find((s) => s.key === spec.key);
  if (!prop || !ps) return;
  if (slot === "toggle") {
    const cur = prop.valueAt(engine.transport.time);
    engine.setPropertyValue(layer.id, prop.id, typeof cur === "boolean" ? !cur : true);
    return;
  }
  const { min, max } = bounds(ps);
  const action = (spec as TriggerSlot).action;
  const next =
    action === "bump"
      ? clamp(Number(prop.valueAt(engine.transport.time)) + 1, min, max)
      : Math.floor(min + Math.random() * (max - min));
  engine.setPropertyValue(layer.id, prop.id, next);
}
