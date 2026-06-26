import * as Tone from "tone";
import type { AudioEngine } from "../AudioEngine";
import type { Instrument, SonicParams } from "../types";
import { Voice, num, lerp } from "./util";

// ───────────────────────────── boids -> flock arp ─────────────────────────────
export function createBoidsArp(engine: AudioEngine): Instrument {
  const voice = new Voice(engine, { reverb: 0.12, delay: 0.45 });
  const filter = new Tone.Filter(1800, "lowpass").connect(voice.vca);
  const synth = new Tone.Synth({
    oscillator: { type: "sawtooth" },
    envelope: { attack: 0.005, decay: 0.18, sustain: 0.04, release: 0.2 },
    volume: -16,
  }).connect(filter);

  const pattern = [0, 2, 4, 7, 9, 7, 4, 2];
  let cur: SonicParams | null = null;
  let i = 0;
  let step = 0;
  const id = engine.transport.scheduleRepeat((time) => {
    const sp = num(cur?.props ?? {}, "maxSpeed", 3.5);
    const div = sp > 10 ? 1 : sp > 4 ? 2 : 4; // faster flock = faster arp
    const present = (cur?.presence ?? 0) > 0.03;
    if (present && step % div === 0) {
      const deg = pattern[i % pattern.length];
      synth.triggerAttackRelease(engine.freqOfDegree(deg + 7), "16n", time, 0.5);
      i++;
    }
    step = (step + 1) % 16;
  }, "16n");

  return {
    family: "arp",
    update(p: SonicParams) {
      cur = p;
      filter.frequency.rampTo(lerp(600, 4500, p.energy), 0.15);
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
