import * as Tone from "tone";
import type { AudioEngine } from "../AudioEngine";
import type { Instrument, SonicParams } from "../types";
import { Voice, num } from "./util";

// ─────────────────────────── plant -> kalimba plucks ───────────────────────────
export function createPlantPluck(engine: AudioEngine): Instrument {
  const voice = new Voice(engine, { reverb: 0.4, delay: 0.3 });
  const out = new Tone.Gain(0.5).connect(voice.vca);
  const synth = new Tone.PluckSynth({ attackNoise: 0.8, dampening: 3800, resonance: 0.92 }).connect(out);

  // A branching arpeggio whose density and pitch shift with the plant's depth + seed.
  const pattern = [0, 2, 4, 7, 9, 11, 9, 7, 4, 2];
  let cur: SonicParams | null = null;
  let i = 0;
  let step = 0;
  const id = engine.transport.scheduleRepeat((time) => {
    const props = cur?.props ?? {};
    const present = (cur?.presence ?? 0) > 0.03;
    const iter = Math.round(num(props, "iterations", 4));
    const div = iter >= 5 ? 1 : iter >= 3 ? 2 : 4; // deeper plant = busier melody
    if (present && step % div === 0) {
      const seedShift = Math.round(num(props, "seed", 1)) % 5;
      synth.triggerAttackRelease(engine.freqOfDegree(pattern[i % pattern.length] + seedShift), "8n", time, 0.7);
      i++;
    }
    step = (step + 1) % 16;
  }, "8n");

  return {
    family: "pluck",
    update(p: SonicParams) {
      cur = p;
      voice.applyGain(p.presence);
    },
    setLevel: (v) => voice.setLevel(v),
    setMuted: (m) => voice.setMuted(m),
    dispose() {
      engine.transport.clear(id);
      [synth, out].forEach((n) => n.dispose());
      voice.dispose();
    },
  };
}
