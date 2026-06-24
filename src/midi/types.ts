/**
 * Normalized MIDI model. We deliberately reduce the raw protocol to one load-bearing
 * distinction that the auto-mapper cares about: **continuous** controls (knobs, faders,
 * jog wheels, pitch-bend — anything that sweeps a range) vs **momentary** controls (pads,
 * keys, buttons — note on/off). Ranges can only be driven by continuous controls; toggles
 * and triggers by momentary ones. Everything else (the prettier knob/fader/pad label) is
 * cosmetic and user-overridable.
 */

export type ControlSubtype =
  | "knob"
  | "fader"
  | "jog"
  | "pad"
  | "key"
  | "button"
  | "pitchbend"
  | "unknown";

/**
 * The user-facing input *type* of a physical control — what the settings menu lets you pick
 * to correct a wrong auto-detection. Unlike {@link ControlSubtype} (a passive detection hint),
 * a `ControlKind` is authoritative: choosing it changes how the manager *interprets* the
 * control's messages (absolute vs relative, continuous vs momentary).
 *
 * - `fader`   absolute linear (CC sweeps 0..127)
 * - `knob`    absolute rotary potentiometer (CC sweeps 0..127)
 * - `encoder` endless relative rotary (CC reports signed steps)
 * - `jog`     jogwheel / platter (relative, like an encoder)
 * - `button`  momentary press (note on/off, or a CC used as a switch)
 */
export type ControlKind = "fader" | "knob" | "encoder" | "jog" | "button";

/**
 * Intrinsic behaviour of each kind — the single source of truth the manager uses to interpret
 * messages and that {@link KIND_META} reuses for its labels. `continuous`: sweeps a range vs. a
 * momentary press. `relative`: reports signed steps rather than an absolute position.
 */
export const KIND_BEHAVIOR: Record<ControlKind, { continuous: boolean; relative: boolean }> = {
  fader: { continuous: true, relative: false },
  knob: { continuous: true, relative: false },
  encoder: { continuous: true, relative: true },
  jog: { continuous: true, relative: true },
  button: { continuous: false, relative: false },
};

/** A user override pushed down onto the manager so retyping/renaming takes effect live. */
export interface ControlOverride {
  name?: string;
  kind?: ControlKind;
}

/** A single physical control on a connected device, learned by listening. */
export interface MidiControl {
  /** Stable key, e.g. "cc:0:7", "note:0:36", "pb:0". */
  id: string;
  /** Human label, e.g. "CC 7" — overridable for nice device maps. */
  label: string;
  /** The one thing the mapper branches on. */
  continuous: boolean;
  subtype: ControlSubtype;
  /** 0-based MIDI channel. */
  channel: number;
  /** CC number / note number (undefined for pitch-bend). */
  number?: number;
  /** Latest value, normalized 0..1 (held velocity for notes, 0 when released). */
  value: number;
  /** Last raw data byte (0..127, or 0..16383 for pitch-bend). */
  raw: number;
  /** For momentary controls: currently held. */
  pressed: boolean;
  /** Detected relative/endless encoder (e.g. a jog wheel or browse knob). */
  relative: boolean;
  /** Signed step from the last relative message (only meaningful when `relative`). */
  delta: number;
  /** Source input id + name (which device this came from). */
  deviceId: string;
  deviceName: string;
  /** Number of messages seen — used for relative detection & "most active" sorting. */
  hits: number;
  lastSeen: number;
}

export interface MidiDeviceInfo {
  id: string;
  name: string;
  manufacturer: string;
  state: string;
}

export type MidiStatus = "idle" | "unsupported" | "denied" | "ready";

/** Raw-ish event passed to listeners on every recognized message. */
export interface MidiEvent {
  control: MidiControl;
  /** "cc" | "noteon" | "noteoff" | "pitchbend". */
  kind: "cc" | "noteon" | "noteoff" | "pitchbend";
}

export interface MidiManagerEvents {
  status: MidiStatus;
  devices: MidiDeviceInfo[];
  /** A control id was seen for the first time. */
  discover: MidiControl;
  /** Any value change. */
  control: MidiEvent;
  /** Momentary press (note-on / button down) — the trigger signal. */
  trigger: MidiControl;
  /** Momentary release. */
  release: MidiControl;
}
