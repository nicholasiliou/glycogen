/**
 * Pure decoder for the raw MIDI byte stream. It does no learning and holds no state — it just
 * recognizes the four message shapes the manager cares about (CC, note-on, note-off, pitch-bend)
 * and returns a tidy discriminated union. {@link MidiManager} feeds it bytes and routes the result
 * into the {@link ControlLearner}.
 */

export interface CCMessage {
  kind: "cc";
  channel: number;
  /** CC number. */
  number: number;
  /** Raw value byte 0..127. */
  raw: number;
}

export interface NoteMessage {
  kind: "noteon" | "noteoff";
  channel: number;
  note: number;
  velocity: number;
}

export interface PitchBendMessage {
  kind: "pitchbend";
  channel: number;
  /** 14-bit value 0..16383. */
  raw14: number;
}

export type ParsedMidiMessage = CCMessage | NoteMessage | PitchBendMessage;

/** Decode one MIDI message; returns null for anything we don't model. */
export function parseMidiMessage(data: Uint8Array | null): ParsedMidiMessage | null {
  if (!data || data.length < 2) return null;
  const status = data[0];
  const type = status & 0xf0;
  const channel = status & 0x0f;
  const d1 = data[1];
  const d2 = data.length > 2 ? data[2] : 0;

  if (type === 0xb0) {
    return { kind: "cc", channel, number: d1, raw: d2 };
  }
  if (type === 0x90 && d2 > 0) {
    return { kind: "noteon", channel, note: d1, velocity: d2 };
  }
  if (type === 0x80 || (type === 0x90 && d2 === 0)) {
    return { kind: "noteoff", channel, note: d1, velocity: d2 };
  }
  if (type === 0xe0) {
    return { kind: "pitchbend", channel, raw14: (d2 << 7) | d1 };
  }
  return null;
}
