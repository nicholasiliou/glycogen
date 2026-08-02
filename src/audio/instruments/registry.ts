import type { AudioEngine } from "../AudioEngine";
import type { Instrument, InstrumentFamily, PropertyValue } from "../types";
import { clamp01, norm, num } from "./util";
import {
  createBoidsArp,
  createCloudPad,
  createGlyphMallet,
  createHarmonographLead,
  createLandscapePad,
  createLifeDrums,
  createNoiseBass,
  createPhysarumPad,
  createPlantPluck,
  createShapeChime,
} from "./builtins";

export type InstrumentFactory = (engine: AudioEngine) => Instrument;

/** A plugin's live param values keyed by field name  -  the same numbers the renderer draws with. */
export type Props = Record<string, PropertyValue>;

export interface InstrumentSpec {
  family: InstrumentFamily;
  /** One-liner describing the sound  -  shown on the sundial. */
  blurb: string;
  /** Present once the voice is implemented; absent = visual only (silent) for now. */
  create?: InstrumentFactory;
  /**
   * Rough 0..1 "how active is this visual" from its live params, used to push the instrument
   * harder. Lives here, next to the voice, so the param names it reads stay with the plugin's
   * spec. Absent ⇒ a neutral 0.4.
   */
  energy?: (props: Props) => number;
}

/**
 * The single source of truth for "which plugin sounds like what". Family is pinned here so a
 * plugin never swaps instrument type. Entries without `create` are planned voices: the plugin
 * still appears on the sundial and renders, it just doesn't sound yet.
 */
export const INSTRUMENTS: Record<string, InstrumentSpec> = {
  // ── implemented (phase 1) ──
  gameOfLife: {
    family: "drums",
    blurb: "Drum machine  -  population drives the groove",
    create: createLifeDrums,
    energy: (p) => clamp01(0.6 * norm(num(p, "density", 0.32), 0.01, 0.9) + 0.4 * norm(num(p, "speed", 1), 1, 6)),
  },
  physarum: {
    family: "pad",
    blurb: "Ambient drone  -  slow organic wash",
    create: createPhysarumPad,
    energy: (p) => clamp01(0.5 * norm(num(p, "deposit", 1), 0.1, 5) + 0.5 * norm(num(p, "gain", 0.6), 0.1, 4)),
  },
  harmonograph: {
    family: "lead",
    blurb: "Harmonic lead  -  frequencies become intervals",
    create: createHarmonographLead,
    energy: (p) => clamp01(norm(num(p, "cycles", 12), 1, 60)),
  },
  boids: {
    family: "arp",
    blurb: "Flock arp  -  flock speed sets the note rate",
    create: createBoidsArp,
    energy: (p) => clamp01(0.7 * norm(num(p, "maxSpeed", 3.5), 0.2, 20) + 0.3 * norm(num(p, "count", 500), 1, 5000)),
  },
  noise: {
    family: "bass",
    blurb: "Sub bass  -  a low, evolving ground",
    create: createNoiseBass,
    energy: (p) => clamp01(0.5 * norm(Math.abs(num(p, "speed", 0.3)), 0, 4) + 0.5 * norm(num(p, "contrast", 1), 0.1, 6)),
  },
  plant: {
    family: "pluck",
    blurb: "Kalimba plucks  -  branching melody",
    create: createPlantPluck,
    energy: (p) => clamp01(0.6 * norm(num(p, "iterations", 4), 1, 6) + 0.4 * norm(Math.abs(num(p, "spinSpeed", 0.06)), 0, 0.5)),
  },
  landscape: {
    family: "pad",
    blurb: "Wide evolving pad  -  terrain as chords",
    create: createLandscapePad,
    energy: (p) => clamp01(0.6 * norm(num(p, "amplitude", 0.55), 0, 1.2) + 0.4 * norm(Math.abs(num(p, "speed", 0.15)), 0, 3)),
  },
  shape: {
    family: "chime",
    blurb: "FM bell + saw lead  -  each shape sounds different",
    create: createShapeChime,
    energy: (p) => clamp01(0.5 * norm(Math.abs(num(p, "spin", 24)), 0, 360) + 0.5 * norm(num(p, "resolution", 28), 8, 80)),
  },
  glyphScatter: {
    family: "stab",
    blurb: "Mallet grid  -  the glyph field plays marimba",
    create: createGlyphMallet,
    energy: (p) => clamp01(0.6 * (1 - num(p, "threshold", 0.5)) + 0.4 * norm(Math.abs(num(p, "speed", 0.2)), 0, 3)),
  },
  volumetricCloud: {
    family: "pad",
    blurb: "Airy noise wash  -  drifting cloud pad",
    create: createCloudPad,
    energy: (p) =>
      clamp01(0.5 * norm(num(p, "coverage", 0.5), 0.1, 0.9) + 0.3 * norm(num(p, "density", 1.4), 0.2, 4) + 0.2 * norm(Math.abs(num(p, "speed", 0.25)), 0, 3)),
  },
  // ── planned (renders now, sound coming) ──
  reactionDiffusion: { family: "texture", blurb: "FM texture  -  bubbling chemistry" },
  slicer: { family: "stab", blurb: "Rhythmic chord stutter" },
  wire: { family: "lead", blurb: "Laser glide lead" },
  model: { family: "pad", blurb: "Glassy pad" },
};

/** Build the instrument for a plugin type, or null if it has no voice yet. */
export function createInstrument(type: string, engine: AudioEngine): Instrument | null {
  const spec = INSTRUMENTS[type];
  return spec?.create ? spec.create(engine) : null;
}

export function instrumentSpec(type: string): InstrumentSpec | undefined {
  return INSTRUMENTS[type];
}

