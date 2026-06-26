import * as Tone from "tone";
import type { AudioEngine } from "../AudioEngine";
import type { Instrument, SonicParams } from "../types";
import { Voice, num, norm, lerp, clamp01 } from "./util";

// ───────────────────────── cloud -> airy noise wash ─────────────────────────
/**
 * A breathy, evolving pad for the volumetric cloud: a soft saw/triangle stack washed through a
 * slow filter and heavy reverb, plus a bed of filtered noise. Drift speed sets the chord rate,
 * coverage/density open the filter and noise bed — denser, faster cloud = thicker, brighter wash.
 */
export function createCloudPad(engine: AudioEngine): Instrument {
  const voice = new Voice(engine, { reverb: 0.9, delay: 0.25 });

  const filter = new Tone.Filter({ type: "lowpass", frequency: 600, Q: 0.6 }).connect(voice.vca);
  const chorus = new Tone.Chorus(0.18, 6, 0.5).connect(filter).start();
  const pad = new Tone.PolySynth(Tone.Synth, {
    oscillator: { type: "fattriangle", count: 3, spread: 30 },
    envelope: { attack: 4, decay: 2, sustain: 0.9, release: 8 },
    volume: -16,
  }).connect(chorus);

  // A whispering noise bed under the chord — the "air" of the cloud.
  const noiseFilter = new Tone.Filter({ type: "bandpass", frequency: 1200, Q: 0.7 }).connect(voice.vca);
  const noiseGain = new Tone.Gain(0).connect(noiseFilter);
  const noise = new Tone.Noise("pink").connect(noiseGain).start();

  let cur: SonicParams | null = null;
  let bar = 0;
  const id = engine.transport.scheduleRepeat((time) => {
    if ((cur?.presence ?? 0) <= 0.03) return;
    const e = cur?.energy ?? 0.3;
    // Open, drifting voicings; thicker cloud (more energy) adds the higher colour tones.
    const chord = e > 0.5 ? [0, 4, 7, 11] : [0, 7, 12];
    const oct = bar % 2 === 1 ? 7 : 0;
    pad.triggerAttackRelease(chord.map((d) => engine.freqOfDegree(d + oct)), "2m", time, 0.4);
    bar++;
  }, "2m");

  return {
    family: "pad",
    update(p: SonicParams) {
      cur = p;
      const coverage = num(p.props, "coverage", 0.5);
      const density = num(p.props, "density", 1.4);
      // Coverage + density brighten the wash; drift speed adds a touch of motion-energy.
      const open = 0.5 * norm(coverage, 0.1, 0.9) + 0.3 * norm(density, 0.2, 4) + 0.2 * p.energy;
      filter.frequency.rampTo(lerp(350, 3200, open), 0.6);
      noiseFilter.frequency.rampTo(lerp(700, 3500, open), 0.6);
      // The noise bed swells with coverage so a fuller sky breathes louder.
      noiseGain.gain.rampTo(lerp(0.0, 0.05, norm(coverage, 0.1, 0.9)) * clamp01(p.presence), 0.4);
      voice.applyGain(p.presence);
    },
    setLevel: (v) => voice.setLevel(v),
    setMuted: (m) => voice.setMuted(m),
    dispose() {
      engine.transport.clear(id);
      noise.stop();
      [pad, chorus, filter, noise, noiseGain, noiseFilter].forEach((n) => n.dispose());
      voice.dispose();
    },
  };
}
