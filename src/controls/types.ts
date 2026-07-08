/**
 * The abstract control surface every plugin binds against. A plugin never names a MIDI CC or a
 * device — it binds to a logical *slot* (`fader 0`, `knob 2`, `pad 5`…). The learn system maps
 * real hardware OR an on-screen controller widget onto those slots, so bindings survive a change
 * of controller.
 */

export type ControlKind = "fader" | "knob" | "encoder" | "button" | "pad" | "jog";

/** Stable address of one logical control, e.g. "fader:0". */
export type SlotId = `${ControlKind}:${number}`;

export function slotId(kind: ControlKind, index: number): SlotId {
  return `${kind}:${index}`;
}

/** Live state of one slot, fed by the {@link ControlBus} from hardware or on-screen widgets. */
export interface SlotLive {
  /** Last absolute position, normalised 0..1 (faders / knobs). */
  value: number;
  /** Last signed step (relative controls: encoders / jog). */
  delta: number;
  /** Whether the most recent input was relative. */
  relative: boolean;
  /** Current button/pad hold state. */
  pressed: boolean;
  /** Count of distinct press (rising) events — decouples buttons from the host's poll rate. */
  presses: number;
  /** Monotonic message counter so consumers can detect "moved since last tick". */
  hits: number;
  /** performance.now() of the last activity. */
  lastSeen: number;
}

/** A single push of activity into a slot. */
export interface DriveInput {
  /** Absolute position 0..1. */
  value?: number;
  /** Relative signed step. */
  delta?: number;
  relative?: boolean;
  /** Button/pad hold state. */
  pressed?: boolean;
}

export function emptySlotLive(): SlotLive {
  return { value: 0, delta: 0, relative: false, pressed: false, presses: 0, hits: 0, lastSeen: 0 };
}

export function clamp01(n: number): number {
  return n < 0 ? 0 : n > 1 ? 1 : n;
}
