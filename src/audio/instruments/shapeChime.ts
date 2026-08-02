import * as Tone from "tone";
import type { AudioEngine } from "../AudioEngine";
import type { Instrument, PropertyValue, SonicParams } from "../types";
import { Voice, num, norm, lerp } from "./util";

// ───────────────────────── shape -> metallic FM bell + saw lead ─────────────────────────
/**
 * Per-shape character. Each geometry gets its own arp, base octave, bell harmonicity and a
 * sawtooth-lead voicing  -  so switching the shape audibly switches the instrument's identity,
 * not just its pitch. Bell + saw lead play together: the bell rings the shape, the saw leads it.
 */
interface ShapeVoicing {
  /** Scale-degree arpeggio the bell rings through. */
  arp: number[];
  /** Octave offset (in scale degrees) shifting the whole voice up/down. */
  octave: number;
  /** FM bell partial ratio  -  the metallic colour. */
  harmonicity: number;
  /** Saw-lead chord (scale degrees), played as a sustained stack under the bell. */
  lead: number[];
  /** Saw lead filter cutoff in Hz  -  its brightness. */
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
  // Saw-lead chord swells across the bar  -  the shape's harmonic "body".
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
      // Spin energy opens the saw lead's filter  -  a fast-spinning shape sings brighter.
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
