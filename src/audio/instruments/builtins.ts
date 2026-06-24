import * as Tone from "tone";
import type { AudioEngine } from "../AudioEngine";
import type { Instrument, SonicParams } from "../types";
import { Voice, num, norm, lerp, clamp01 } from "./util";

/**
 * Phase-1 instrument voices. Each is a distinct synth design pinned to one plugin type, so
 * the plugin always sounds like itself. Rhythmic voices schedule on the shared Tone transport
 * (so they stay locked to tempo) and read the latest visual params at trigger time; tonal
 * voices snap pitch into the shared key via `engine.freqOfDegree`.
 */

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

  let cur: SonicParams | null = null;
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
      cur = p;
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

// ───────────────────────── shape -> metallic FM bell ─────────────────────────
export function createShapeChime(engine: AudioEngine): Instrument {
  const voice = new Voice(engine, { reverb: 0.6, delay: 0.35 });
  const synth = new Tone.PolySynth(Tone.FMSynth, {
    harmonicity: 3.01,
    modulationIndex: 12,
    oscillator: { type: "sine" },
    modulation: { type: "square" },
    envelope: { attack: 0.002, decay: 1.6, sustain: 0, release: 1.8 },
    modulationEnvelope: { attack: 0.01, decay: 0.4, sustain: 0, release: 0.4 },
    volume: -20,
  }).connect(voice.vca);

  const arp = [0, 4, 7, 11];
  let cur: SonicParams | null = null;
  let i = 0;
  const id = engine.transport.scheduleRepeat((time) => {
    if ((cur?.presence ?? 0) <= 0.03) return;
    const res = Math.round(num(cur?.props ?? {}, "resolution", 28));
    const oct = res > 50 ? 7 : 0; // denser mesh rings higher
    synth.triggerAttackRelease(engine.freqOfDegree(arp[i % arp.length] + oct), "2n", time, 0.5);
    i++;
  }, "2n");

  return {
    family: "chime",
    update(p: SonicParams) {
      cur = p;
      // Knot complexity detunes the bell's partials — a different shape rings differently.
      const knot = num(p.props, "knotP", 2) + num(p.props, "knotQ", 3);
      synth.set({ harmonicity: lerp(1.5, 6, norm(knot, 2, 24)) });
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
