/**
 * Musical scale helpers. The whole instrument layer snaps pitches into a shared key so any
 * mix of plugins is consonant. Pitches are expressed as scale *degrees* (integers, can go
 * negative or beyond an octave) which we resolve to MIDI note numbers then to Hz.
 */

export const SCALES: Record<string, number[]> = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
  lydian: [0, 2, 4, 6, 7, 9, 11],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  majorPentatonic: [0, 2, 4, 7, 9],
  minorPentatonic: [0, 3, 5, 7, 10],
  // Calm, ambient-friendly defaults:
  hirajoshi: [0, 2, 3, 7, 8],
};

export type ScaleName = keyof typeof SCALES;

export const SCALE_NAMES = Object.keys(SCALES) as ScaleName[];

/** Note names for the 12 pitch classes (root-relative display). */
const PITCH_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

export function midiToFreq(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

export function midiToName(midi: number): string {
  const m = Math.round(midi);
  return `${PITCH_NAMES[((m % 12) + 12) % 12]}${Math.floor(m / 12) - 1}`;
}

/**
 * Resolve a scale degree to a MIDI note. `degree` 0 is the root; 7 (for a 7-note scale) is
 * the root an octave up; negative degrees descend. Works for any scale length.
 */
export function degreeToMidi(rootMidi: number, scale: ScaleName, degree: number): number {
  const steps = SCALES[scale] ?? SCALES.major;
  const len = steps.length;
  const octave = Math.floor(degree / len);
  const idx = ((degree % len) + len) % len;
  return rootMidi + octave * 12 + steps[idx];
}

export function degreeToFreq(rootMidi: number, scale: ScaleName, degree: number): number {
  return midiToFreq(degreeToMidi(rootMidi, scale, degree));
}

/** Snap an arbitrary MIDI value to the nearest pitch in the key. */
export function snapToScale(rootMidi: number, scale: ScaleName, midi: number): number {
  const steps = SCALES[scale] ?? SCALES.major;
  const rel = midi - rootMidi;
  const octave = Math.floor(rel / 12);
  const within = ((rel % 12) + 12) % 12;
  let best = steps[0];
  let bestD = Infinity;
  for (const s of steps) {
    const d = Math.abs(s - within);
    if (d < bestD) {
      bestD = d;
      best = s;
    }
  }
  return rootMidi + octave * 12 + best;
}

/** Map a 0..1 value to a degree within `span` degrees — handy for visual params -> pitch. */
export function unitToDegree(unit: number, span: number, offset = 0): number {
  return Math.round(offset + clamp01(unit) * span);
}

export function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
