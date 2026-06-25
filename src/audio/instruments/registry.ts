import type { AudioEngine } from "../AudioEngine";
import type { Instrument, InstrumentFamily } from "../types";
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

export interface InstrumentSpec {
  family: InstrumentFamily;
  /** One-liner describing the sound — shown on the sundial. */
  blurb: string;
  /** Present once the voice is implemented; absent = visual only (silent) for now. */
  create?: InstrumentFactory;
}

/**
 * The single source of truth for "which plugin sounds like what". Family is pinned here so a
 * plugin never swaps instrument type. Entries without `create` are planned voices: the plugin
 * still appears on the sundial and renders, it just doesn't sound yet.
 */
export const INSTRUMENTS: Record<string, InstrumentSpec> = {
  // ── implemented (phase 1) ──
  life: { family: "drums", blurb: "Drum machine — population drives the groove", create: createLifeDrums },
  physarum: { family: "pad", blurb: "Ambient drone — slow organic wash", create: createPhysarumPad },
  harmonograph: { family: "lead", blurb: "Harmonic lead — frequencies become intervals", create: createHarmonographLead },
  boids: { family: "arp", blurb: "Flock arp — flock speed sets the note rate", create: createBoidsArp },
  noise: { family: "bass", blurb: "Sub bass — a low, evolving ground", create: createNoiseBass },
  plant: { family: "pluck", blurb: "Kalimba plucks — branching melody", create: createPlantPluck },
  landscape: { family: "pad", blurb: "Wide evolving pad — terrain as chords", create: createLandscapePad },
  shape: { family: "chime", blurb: "FM bell + saw lead — each shape sounds different", create: createShapeChime },
  glyphScatter: { family: "stab", blurb: "Mallet grid — the glyph field plays marimba", create: createGlyphMallet },
  cloud: { family: "pad", blurb: "Airy noise wash — drifting cloud pad", create: createCloudPad },
  // ── planned (renders now, sound coming) ──
  reactionDiffusion: { family: "texture", blurb: "FM texture — bubbling chemistry" },
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

