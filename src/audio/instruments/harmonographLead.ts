import * as Tone from "tone";
import type { AudioEngine } from "../AudioEngine";
import type { Instrument, SonicParams } from "../types";
import { Voice, num, norm, lerp } from "./util";

// ─────────────────────── harmonograph -> harmonic lead ───────────────────────
export function createHarmonographLead(engine: AudioEngine): Instrument {
  const voice = new Voice(engine, { reverb: 0.3, delay: 0.3 });
  const vib = new Tone.Vibrato(5, 0.05).connect(voice.vca);
  const synth = new Tone.PolySynth(Tone.Synth, {
    oscillator: { type: "sine" },
    envelope: { attack: 0.7, decay: 0.5, sustain: 0.6, release: 2.5 },
    volume: -14,
  }).connect(vib);

  let cur: SonicParams | null = null;
  let bar = 0;
  const id = engine.transport.scheduleRepeat((time) => {
    const props = cur?.props ?? {};
    const dx1 = Math.round(num(props, "freqX1", 3));
    const dy1 = Math.round(num(props, "freqY1", 2));
    const notes = [engine.freqOfDegree(dx1 - 1), engine.freqOfDegree(dy1 + 2)];
    if (bar % 2 === 1) notes.push(engine.freqOfDegree(Math.round(num(props, "freqX2", 5)) + 4));
    synth.triggerAttackRelease(notes, "1n", time, 0.4);
    bar++;
  }, "1n");

  return {
    family: "lead",
    update(p: SonicParams) {
      cur = p;
      vib.depth.rampTo(lerp(0.02, 0.18, norm(num(p.props, "damping", 0.6), 0, 2)), 0.2);
      voice.applyGain(p.presence);
    },
    setLevel: (v) => voice.setLevel(v),
    setMuted: (m) => voice.setMuted(m),
    dispose() {
      engine.transport.clear(id);
      [synth, vib].forEach((n) => n.dispose());
      voice.dispose();
    },
  };
}
