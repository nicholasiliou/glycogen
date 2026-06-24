import type { PropertyValue } from "@/engine";

/** Instrument family — pinned per plugin type so a plugin's sound never changes character. */
export type InstrumentFamily =
  | "drums"
  | "pad"
  | "lead"
  | "bass"
  | "arp"
  | "pluck"
  | "texture"
  | "stab"
  | "chime";

/** Per-frame state handed to an instrument: the same numbers that drive the visuals. */
export interface SonicParams {
  /** Evaluated visual props by key (exactly what the renderer drew with this frame). */
  props: Record<string, PropertyValue>;
  /** Overall activity/energy 0..1 (motion, population, reaction rate…). */
  energy: number;
  /** Stage presence 0..1 — layer opacity, used as a base level so fading out fades the sound. */
  presence: number;
  time: number;
}

/**
 * The contract every plugin's voice implements. An instrument owns its Tone nodes, reads
 * the latest {@link SonicParams} via `update` (called per visual frame) and — if rhythmic —
 * schedules its own events on the shared musical clock so it always stays in time.
 */
export interface Instrument {
  readonly family: InstrumentFamily;
  /** Push the latest visual-derived params. Cheap; called ~once per frame. */
  update(p: SonicParams): void;
  /** Voice level 0..1 (per-layer fader / mix). */
  setLevel(v: number): void;
  setMuted(m: boolean): void;
  /** Tear down nodes + any scheduled events. */
  dispose(): void;
}
