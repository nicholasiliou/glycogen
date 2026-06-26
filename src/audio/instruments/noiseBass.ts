import * as Tone from "tone";
import type { AudioEngine } from "../AudioEngine";
import type { Instrument, SonicParams } from "../types";
import { Voice, num, norm, lerp } from "./util";

// ─────────────────────────── noise -> sub / bass ───────────────────────────
export function createNoiseBass(engine: AudioEngine): Instrument {
  const voice = new Voice(engine, { reverb: 0.04 });
  const filter = new Tone.Filter({ type: "lowpass", frequency: 200, Q: 2 }).connect(voice.vca);
  const synth = new Tone.MonoSynth({
    oscillator: { type: "sawtooth" },
    envelope: { attack: 0.02, decay: 0.3, sustain: 0.7, release: 0.5 },
    filterEnvelope: { attack: 0.02, decay: 0.2, sustain: 0.4, baseFrequency: 80, octaves: 2 },
    volume: -8,
  }).connect(filter);

  let b = 0;
  const id = engine.transport.scheduleRepeat((time) => {
    const root = engine.freqOfDegree(0) * 0.5;
    const fifth = engine.freqOfDegree(4) * 0.5;
    synth.triggerAttackRelease(b % 4 === 2 ? fifth : root, "2n", time, 0.85);
    b++;
  }, "2n");

  return {
    family: "bass",
    update(p: SonicParams) {
      const contrast = num(p.props, "contrast", 1);
      filter.frequency.rampTo(lerp(120, 1100, 0.6 * norm(contrast, 0.1, 6) + 0.4 * p.energy), 0.2);
      voice.applyGain(p.presence);
    },
    setLevel: (v) => voice.setLevel(v),
    setMuted: (m) => voice.setMuted(m),
    dispose() {
      engine.transport.clear(id);
      [synth, filter].forEach((n) => n.dispose());
      voice.dispose();
    },
  };
}
