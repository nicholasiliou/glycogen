import * as Tone from "tone";
import type { AudioEngine } from "../AudioEngine";
import type { Instrument, SonicParams } from "../types";
import { Voice, num, norm, lerp } from "./util";

// ───────────────────────── landscape -> wide terrain pad ─────────────────────────
export function createLandscapePad(engine: AudioEngine): Instrument {
  const voice = new Voice(engine, { reverb: 0.85, delay: 0.2 });
  const filter = new Tone.Filter({ type: "lowpass", frequency: 700, Q: 0.8 }).connect(voice.vca);
  const synth = new Tone.PolySynth(Tone.Synth, {
    oscillator: { type: "sawtooth" },
    envelope: { attack: 3, decay: 2, sustain: 0.9, release: 7 },
    volume: -18,
  }).connect(filter);

  let cur: SonicParams | null = null;
  let bar = 0;
  const id = engine.transport.scheduleRepeat((time) => {
    const terrace = Math.round(num(cur?.props ?? {}, "terrace", 0));
    // Terraced terrain → tighter, coloured voicings; smooth terrain → open fifths.
    const base = terrace > 4 ? [0, 3, 7, 10] : terrace > 0 ? [0, 4, 7, 11] : [0, 7, 12];
    const oct = bar % 2 === 1 ? 7 : 0;
    synth.triggerAttackRelease(base.map((d) => engine.freqOfDegree(d + oct)), "2m", time, 0.4);
    bar++;
  }, "2m");

  return {
    family: "pad",
    update(p: SonicParams) {
      cur = p;
      const amp = num(p.props, "amplitude", 0.55);
      filter.frequency.rampTo(lerp(400, 3000, 0.6 * norm(amp, 0, 1.2) + 0.4 * p.energy), 0.4);
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
