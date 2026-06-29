import * as Tone from "tone";
import type { AudioEngine } from "../AudioEngine";
import type { PropertyValue } from "../types";
import type { SonicParams } from "../types";

/** Read a numeric prop with a fallback (props can be any PropertyValue). */
export function num(props: Record<string, PropertyValue>, key: string, fallback: number): number {
  const v = props[key];
  return typeof v === "number" ? v : fallback;
}

export function bool(props: Record<string, PropertyValue>, key: string, fallback = false): boolean {
  const v = props[key];
  return typeof v === "boolean" ? v : fallback;
}

export const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * clamp01(t);
/** Normalize v in [a,b] to 0..1. */
export const norm = (v: number, a: number, b: number): number => clamp01((v - a) / (b - a || 1));

/**
 * Shared per-voice output: a VCA the instrument runs its signal through, plus an optional
 * reverb/delay send. Handles level/mute/presence so every instrument doesn't re-implement
 * the mix. `applyGain` is called each frame with the latest presence.
 */
export class Voice {
  readonly vca: Tone.Gain;
  readonly reverbGain: Tone.Gain;
  readonly delayGain: Tone.Gain;
  private level = 0.8;
  private muted = false;
  private presence = 1;

  constructor(
    readonly engine: AudioEngine,
    opts?: { reverb?: number; delay?: number },
  ) {
    this.vca = new Tone.Gain(0).connect(engine.out);
    this.reverbGain = new Tone.Gain(opts?.reverb ?? 0).connect(engine.reverbSend);
    this.delayGain = new Tone.Gain(opts?.delay ?? 0).connect(engine.delaySend);
    this.vca.connect(this.reverbGain);
    this.vca.connect(this.delayGain);
  }

  setLevel(v: number): void {
    this.level = clamp01(v);
  }
  setMuted(m: boolean): void {
    this.muted = m;
  }
  /** Call once per frame with stage presence (opacity); ramps the VCA smoothly. */
  applyGain(presence: number): void {
    this.presence = clamp01(presence);
    const g = this.muted ? 0 : this.level * (0.25 + 0.75 * this.presence);
    this.vca.gain.rampTo(g, 0.06);
  }
  dispose(): void {
    this.vca.dispose();
    this.reverbGain.dispose();
    this.delayGain.dispose();
  }
}

/** Overall activity 0..1 from a layer's params, when no instrument-specific energy is given. */
export function defaultEnergy(p: SonicParams): number {
  return clamp01(p.energy);
}
