import * as Tone from "tone";
import type { AudioEngine } from "../AudioEngine";
import type { Instrument, SonicParams } from "../types";
import { Voice, num, norm, lerp } from "./util";

// ────────────────────────── physarum -> ambient pad ──────────────────────────
export function createPhysarumPad(engine: AudioEngine): Instrument {
  const voice = new Voice(engine, { reverb: 0.7, delay: 0.15 });
  const filter = new Tone.Filter({ type: "lowpass", frequency: 500, Q: 1 }).connect(voice.vca);
  const chorus = new Tone.Chorus(0.3, 4, 0.6).connect(filter).start();
  const synth = new Tone.PolySynth(Tone.Synth, {
    oscillator: { type: "triangle" },
    envelope: { attack: 2.5, decay: 1.5, sustain: 0.85, release: 6 },
    volume: -12,
  }).connect(chorus);

  let cur: SonicParams | null = null;
  const id = engine.transport.scheduleRepeat((time) => {
    const e = cur?.energy ?? 0.3;
    const oct = e > 0.6 ? 7 : 0;
    const chord = [0, 2, 4, 7].map((d) => engine.freqOfDegree(d + oct));
    synth.triggerAttackRelease(chord, "2m", time, 0.45);
  }, "2m");

  return {
    family: "pad",
    update(p: SonicParams) {
      cur = p;
      const gain = num(p.props, "gain", 0.6);
      const cutoff = lerp(300, 3200, 0.5 * norm(gain, 0.1, 4) + 0.5 * p.energy);
      filter.frequency.rampTo(cutoff, 0.3);
      voice.applyGain(p.presence);
    },
    setLevel: (v) => voice.setLevel(v),
    setMuted: (m) => voice.setMuted(m),
    dispose() {
      engine.transport.clear(id);
      [synth, chorus, filter].forEach((n) => n.dispose());
      voice.dispose();
    },
  };
}
