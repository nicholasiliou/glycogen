import * as Tone from "tone";
import type { PropertyValue } from "@/engine";
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

// ───────────────────────── shape -> metallic FM bell + saw lead ─────────────────────────
/**
 * Per-shape character. Each geometry gets its own arp, base octave, bell harmonicity and a
 * sawtooth-lead voicing — so switching the shape audibly switches the instrument's identity,
 * not just its pitch. Bell + saw lead play together: the bell rings the shape, the saw leads it.
 */
interface ShapeVoicing {
  /** Scale-degree arpeggio the bell rings through. */
  arp: number[];
  /** Octave offset (in scale degrees) shifting the whole voice up/down. */
  octave: number;
  /** FM bell partial ratio — the metallic colour. */
  harmonicity: number;
  /** Saw-lead chord (scale degrees), played as a sustained stack under the bell. */
  lead: number[];
  /** Saw lead filter cutoff in Hz — its brightness. */
  cutoff: number;
}

const SHAPE_VOICINGS: Record<string, ShapeVoicing> = {
  sphere: { arp: [0, 4, 7], octave: 0, harmonicity: 2.0, lead: [0, 7], cutoff: 1400 },
  torus: { arp: [0, 3, 7, 10], octave: 0, harmonicity: 3.5, lead: [0, 3, 7], cutoff: 1800 },
  box: { arp: [0, 5, 7], octave: -7, harmonicity: 1.5, lead: [0, 5], cutoff: 900 },
  cylinder: { arp: [0, 2, 7, 9], octave: 0, harmonicity: 2.5, lead: [0, 4, 7], cutoff: 1600 },
  cone: { arp: [0, 4, 9, 11], octave: 7, harmonicity: 4.0, lead: [0, 4, 9], cutoff: 2400 },
  torusKnot: { arp: [0, 4, 7, 11, 14], octave: 0, harmonicity: 5.0, lead: [0, 4, 7, 11], cutoff: 2200 },
  supershape: { arp: [0, 2, 5, 9, 11], octave: 7, harmonicity: 6.0, lead: [0, 2, 5, 9], cutoff: 3000 },
};
const SHAPE_FALLBACK = SHAPE_VOICINGS.sphere;

function shapeVoicing(props: Record<string, PropertyValue>): ShapeVoicing {
  const s = typeof props.shape === "string" ? props.shape : "sphere";
  return SHAPE_VOICINGS[s] ?? SHAPE_FALLBACK;
}

export function createShapeChime(engine: AudioEngine): Instrument {
  const voice = new Voice(engine, { reverb: 0.6, delay: 0.35 });

  // The bell: rings the shape's arp.
  const bell = new Tone.PolySynth(Tone.FMSynth, {
    harmonicity: 3.01,
    modulationIndex: 12,
    oscillator: { type: "sine" },
    modulation: { type: "square" },
    envelope: { attack: 0.002, decay: 1.6, sustain: 0, release: 1.8 },
    modulationEnvelope: { attack: 0.01, decay: 0.4, sustain: 0, release: 0.4 },
    volume: -20,
  }).connect(voice.vca);

  // The saw lead: a sustained, slowly-detuned stack that gives each shape a body under the bell.
  const leadFilter = new Tone.Filter({ type: "lowpass", frequency: 1600, Q: 1.2 }).connect(voice.vca);
  const lead = new Tone.PolySynth(Tone.Synth, {
    oscillator: { type: "fatsawtooth", count: 3, spread: 22 },
    envelope: { attack: 0.6, decay: 0.4, sustain: 0.7, release: 1.4 },
    volume: -24,
  }).connect(leadFilter);

  let cur: SonicParams | null = null;
  let i = 0;
  let bar = 0;
  // Bell arp on the half note.
  const bellId = engine.transport.scheduleRepeat((time) => {
    if ((cur?.presence ?? 0) <= 0.03) return;
    const v = shapeVoicing(cur?.props ?? {});
    const res = Math.round(num(cur?.props ?? {}, "resolution", 28));
    const oct = v.octave + (res > 50 ? 7 : 0); // denser mesh rings an octave higher
    bell.triggerAttackRelease(engine.freqOfDegree(v.arp[i % v.arp.length] + oct), "2n", time, 0.5);
    i++;
  }, "2n");
  // Saw-lead chord swells across the bar — the shape's harmonic "body".
  const leadId = engine.transport.scheduleRepeat((time) => {
    if ((cur?.presence ?? 0) <= 0.03) return;
    const v = shapeVoicing(cur?.props ?? {});
    const oct = v.octave + (bar % 2 === 1 ? 7 : 0);
    lead.triggerAttackRelease(v.lead.map((d) => engine.freqOfDegree(d + oct)), "1m", time, 0.32);
    bar++;
  }, "1m");

  return {
    family: "chime",
    update(p: SonicParams) {
      cur = p;
      const v = shapeVoicing(p.props);
      // The shape sets the bell's metallic colour; knot/super complexity nudges it brighter.
      const complexity = num(p.props, "knotP", 0) + num(p.props, "knotQ", 0) + num(p.props, "superM", 0);
      bell.set({ harmonicity: v.harmonicity + lerp(0, 2, norm(complexity, 0, 32)) });
      // Spin energy opens the saw lead's filter — a fast-spinning shape sings brighter.
      leadFilter.frequency.rampTo(lerp(v.cutoff * 0.5, v.cutoff, p.energy), 0.3);
      voice.applyGain(p.presence);
    },
    setLevel: (v) => voice.setLevel(v),
    setMuted: (m) => voice.setMuted(m),
    dispose() {
      engine.transport.clear(bellId);
      engine.transport.clear(leadId);
      [bell, lead, leadFilter].forEach((n) => n.dispose());
      voice.dispose();
    },
  };
}

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
