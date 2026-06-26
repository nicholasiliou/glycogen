import * as Tone from "tone";
import type { AudioEngine } from "../AudioEngine";
import type { Instrument, SonicParams } from "../types";
import { Voice, num, clamp01 } from "./util";

// ───────────────────────── glyphScatter -> mallet grid ─────────────────────────
export function createGlyphMallet(engine: AudioEngine): Instrument {
  const voice = new Voice(engine, { reverb: 0.25, delay: 0.25 });
  const synth = new Tone.PolySynth(Tone.Synth, {
    oscillator: { type: "triangle" },
    envelope: { attack: 0.002, decay: 0.22, sustain: 0, release: 0.25 },
    volume: -16,
  }).connect(voice.vca);

  const chord = [0, 2, 4, 7];
  let cur: SonicParams | null = null;
  let step = 0;
  const id = engine.transport.scheduleRepeat((time) => {
    const present = (cur?.presence ?? 0) > 0.03;
    // A sparser field (high threshold) plays fewer mallet hits.
    const density = clamp01(1 - num(cur?.props ?? {}, "threshold", 0.5));
    if (present && step % 2 === 0 && Math.random() < 0.25 + 0.7 * density) {
      const deg = chord[step % chord.length] + (step % 8 >= 4 ? 7 : 0);
      synth.triggerAttackRelease(engine.freqOfDegree(deg), "16n", time, 0.4 + 0.4 * density);
    }
    step = (step + 1) % 16;
  }, "16n");

  return {
    family: "stab",
    update(p: SonicParams) {
      cur = p;
      voice.applyGain(p.presence);
    },
    setLevel: (v) => voice.setLevel(v),
    setMuted: (m) => voice.setMuted(m),
    dispose() {
      engine.transport.clear(id);
      synth.dispose();
      voice.dispose();
    },
  };
}
