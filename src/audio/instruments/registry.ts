import type { AudioEngine } from "../AudioEngine";
import type { Instrument, InstrumentFamily } from "../types";
import {
  createBoidsArp,
  createHarmonographLead,
  createLifeDrums,
  createNoiseBass,
  createPhysarumPad,
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
  // ── planned (renders now, sound coming) ──
  reactionDiffusion: { family: "texture", blurb: "FM texture — bubbling chemistry" },
  plant: { family: "pluck", blurb: "Kalimba plucks — branching melody" },
  landscape: { family: "pad", blurb: "Wide evolving pad — terrain as chords" },
  shape: { family: "chime", blurb: "Metallic FM bell" },
  slicer: { family: "stab", blurb: "Rhythmic chord stutter" },
  wire: { family: "lead", blurb: "Laser glide lead" },
  cloud: { family: "pad", blurb: "Airy noise wash" },
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

/** Display metadata per family (sundial colours / labels). */
export const FAMILY_META: Record<InstrumentFamily, { label: string; color: string }> = {
  drums: { label: "Drums", color: "#ff5500" },
  pad: { label: "Pad", color: "#3601fb" },
  lead: { label: "Lead", color: "#c0fc04" },
  bass: { label: "Bass", color: "#8a2be2" },
  arp: { label: "Arp", color: "#00d4ff" },
  pluck: { label: "Pluck", color: "#36d399" },
  texture: { label: "Texture", color: "#ea027e" },
  stab: { label: "Stab", color: "#ffd000" },
  chime: { label: "Chime", color: "#d6ffaa" },
};
