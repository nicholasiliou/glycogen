import * as Tone from "tone";
import type { AudioEngine } from "../AudioEngine";
import type { Instrument, SonicParams } from "../types";
import { Voice, num } from "./util";

// ───────────────────────────── life -> drum kit ─────────────────────────────
export function createLifeDrums(engine: AudioEngine): Instrument {
  const voice = new Voice(engine, { reverb: 0.05 });
  const kick = new Tone.MembraneSynth({ pitchDecay: 0.03, octaves: 6 }).connect(voice.vca);
  const snareFilter = new Tone.Filter(1800, "bandpass").connect(voice.vca);
  const snare = new Tone.NoiseSynth({ noise: { type: "white" }, envelope: { attack: 0.001, decay: 0.16, sustain: 0 } }).connect(snareFilter);
  const hatGain = new Tone.Gain(0.16).connect(voice.vca);
  const hat = new Tone.MetalSynth({ harmonicity: 5.1, modulationIndex: 32, resonance: 5000, octaves: 1.4, envelope: { attack: 0.001, decay: 0.05, release: 0.01 } }).connect(hatGain);

  let energy = 0;
  let step = 0;
  const id = engine.transport.scheduleRepeat((time) => {
    const e = energy;
    if (step % 8 === 0 || (e > 0.55 && step % 8 === 4)) kick.triggerAttackRelease("C1", "8n", time, 0.9);
    if (step === 4 || step === 12) snare.triggerAttackRelease("16n", time, 0.6 + 0.3 * e);
    if (step % 4 === 2 || Math.random() < e * 0.8) hat.triggerAttackRelease(420, "32n", time, 0.3 + 0.4 * e);
    step = (step + 1) % 16;
  }, "16n");

  return {
    family: "drums",
    update(p: SonicParams) {
      // Population density + change drive how busy the kit is.
      energy = Math.max(p.energy, num(p.props, "density", 0.3));
      voice.applyGain(p.presence);
    },
    setLevel: (v) => voice.setLevel(v),
    setMuted: (m) => voice.setMuted(m),
    dispose() {
      engine.transport.clear(id);
      [kick, snare, snareFilter, hat, hatGain].forEach((n) => n.dispose());
      voice.dispose();
    },
  };
}
