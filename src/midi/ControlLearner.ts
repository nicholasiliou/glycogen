import {
  KIND_BEHAVIOR,
  type ControlKind,
  type ControlOverride,
  type ControlSubtype,
  type MidiControl,
} from "./types";
import type { CCMessage, NoteMessage, PitchBendMessage } from "./MidiMessageParser";

/** The detection hint a chosen kind implies (encoder & jog both read as a "jog" subtype). */
function subtypeForKind(kind: ControlKind): ControlSubtype {
  switch (kind) {
    case "fader":
      return "fader";
    case "knob":
      return "knob";
    case "encoder":
    case "jog":
      return "jog";
    case "button":
      return "button";
  }
}

/** Identifies the source device for a learned control (a thin slice of the Web MIDI input). */
export interface ControlSource {
  id: string;
  name: string | null;
}

/**
 * What a learning pass produced: the (possibly new) control plus the events the manager should
 * emit. Keeping emission in the manager keeps the learner a pure state machine over the
 * controls/overrides maps — easy to reason about and test.
 */
export interface LearnResult {
  control: MidiControl;
  isNew: boolean;
  kind: "cc" | "noteon" | "noteoff" | "pitchbend";
  edge: "press" | "release" | null;
}

/**
 * Owns the learned-control map and the user overrides, and turns decoded messages into updated
 * {@link MidiControl}s. This is the part of the old MidiManager that "learns the device by
 * listening": every CC/note becomes a control the first time it is touched, relative encoders are
 * auto-detected, and overrides re-interpret a control's messages live.
 */
export class ControlLearner {
  private controls = new Map<string, MidiControl>();
  /** User overrides (name + kind) keyed by control id — the saved preset, pushed down here so
   * retyping a control actually changes how its messages are interpreted, not just its label. */
  private overrides = new Map<string, ControlOverride>();

  /** Snapshot of all controls discovered so far, most-recently-active first. */
  list(): MidiControl[] {
    return [...this.controls.values()].sort((a, b) => b.lastSeen - a.lastSeen);
  }

  get(id: string): MidiControl | undefined {
    return this.controls.get(id);
  }

  /** Drop learned controls (keeps overrides) so the layout can be re-captured. */
  forget(): void {
    this.controls.clear();
  }

  /** Replace the whole override set (e.g. when a preset loads or is switched). */
  applyOverrides(map: Record<string, ControlOverride>): void {
    this.overrides = new Map(Object.entries(map));
    for (const [id, ov] of this.overrides) {
      const ctl = this.controls.get(id);
      if (ctl) this.reskin(ctl, ov);
    }
  }

  /** Set/clear a single control's override; reflects immediately on the learned control. */
  setOverride(id: string, ov: ControlOverride | null): void {
    if (!ov || (ov.kind === undefined && ov.name === undefined)) this.overrides.delete(id);
    else this.overrides.set(id, ov);
    const ctl = this.controls.get(id);
    if (ctl) this.reskin(ctl, this.overrides.get(id));
  }

  /** Re-derive a learned control's label/type from its override so the monitor updates live. */
  private reskin(ctl: MidiControl, ov?: ControlOverride): void {
    if (ov?.name) ctl.label = ov.name;
    if (ov?.kind) {
      ctl.subtype = subtypeForKind(ov.kind);
      ctl.continuous = KIND_BEHAVIOR[ov.kind].continuous;
      ctl.relative = KIND_BEHAVIOR[ov.kind].relative;
    }
  }

  private ensure(id: string, init: () => MidiControl): { ctl: MidiControl; isNew: boolean } {
    let ctl = this.controls.get(id);
    if (ctl) return { ctl, isNew: false };
    ctl = init();
    this.controls.set(id, ctl);
    return { ctl, isNew: true };
  }

  /** Learn / update a CC or pitch-bend control. Returns null when the control is disabled. */
  learnControl(src: ControlSource, msg: CCMessage | PitchBendMessage, now: number): LearnResult | null {
    const isCC = msg.kind === "cc";
    const id = isCC ? `cc:${msg.channel}:${msg.number}` : `pb:${msg.channel}`;
    if (this.overrides.get(id)?.disabled) return null; // faulty control — drop its messages

    const raw = isCC ? msg.raw : msg.raw14;
    const rawMax = isCC ? 127 : 16383;
    const number = isCC ? msg.number : undefined;
    const subtype: ControlSubtype = isCC ? "knob" : "pitchbend";

    const { ctl, isNew } = this.ensure(id, () => ({
      id,
      label: number === undefined ? `Pitch ch${msg.channel + 1}` : `CC ${number}`,
      continuous: true,
      subtype,
      channel: msg.channel,
      number,
      value: raw / rawMax,
      raw,
      pressed: false,
      relative: false,
      delta: 0,
      deviceId: src.id,
      deviceName: src.name ?? "Unknown",
      hits: 0,
      lastSeen: now,
    }));

    const ov = this.overrides.get(id);
    if (ov?.name) ctl.label = ov.name;
    let edge: "press" | "release" | null = null;

    if (ov?.kind) {
      // User-authoritative interpretation — overrides the auto-detection entirely.
      const beh = KIND_BEHAVIOR[ov.kind];
      ctl.subtype = subtypeForKind(ov.kind);
      ctl.continuous = beh.continuous;
      ctl.relative = beh.relative;
      if (beh.continuous) {
        ctl.delta = beh.relative ? (raw < 64 ? raw : raw - 128) : 0;
        ctl.value = raw / rawMax;
        ctl.pressed = false;
      } else {
        // A CC used as a switch: rising/falling edge → trigger/release.
        const pressedNow = raw > 0;
        if (pressedNow && !ctl.pressed) edge = "press";
        else if (!pressedNow && ctl.pressed) edge = "release";
        ctl.pressed = pressedNow;
        ctl.value = pressedNow ? 1 : 0;
        ctl.delta = 0;
      }
      ctl.raw = raw;
    } else {
      // Relative-encoder detection: endless knobs / jog wheels report small signed steps
      // (values clustered near 0 and near 127) rather than sweeping the whole 0..127 range.
      if (isCC) {
        const signed = raw < 64 ? raw : raw - 128; // two's-complement-ish around 0
        ctl.delta = signed;
        if (!ctl.relative && ctl.hits > 2 && (raw <= 8 || raw >= 120) && Math.abs(signed) <= 8) {
          ctl.relative = true;
          ctl.subtype = "jog";
          ctl.label = `Jog/Enc ${number}`;
        }
      }
      ctl.raw = raw;
      ctl.value = raw / rawMax;
    }

    ctl.hits++;
    ctl.lastSeen = now;
    return { control: ctl, isNew, kind: msg.kind, edge };
  }

  /** Learn / update a note control. Returns null when the control is disabled. */
  learnNote(src: ControlSource, msg: NoteMessage, now: number): LearnResult | null {
    const on = msg.kind === "noteon";
    const id = `note:${msg.channel}:${msg.note}`;
    if (this.overrides.get(id)?.disabled) return null; // faulty control — drop its messages

    const { ctl, isNew } = this.ensure(id, () => ({
      id,
      label: `Note ${msg.note}`,
      continuous: false,
      subtype: "pad",
      channel: msg.channel,
      number: msg.note,
      value: 0,
      raw: 0,
      pressed: false,
      relative: false,
      delta: 0,
      deviceId: src.id,
      deviceName: src.name ?? "Unknown",
      hits: 0,
      lastSeen: now,
    }));

    const ov = this.overrides.get(id);
    if (ov?.name) ctl.label = ov.name;
    ctl.pressed = on;
    ctl.raw = msg.velocity;
    ctl.value = on ? msg.velocity / 127 : 0;
    // A note that always arrives at full velocity behaves like a button; varying velocity = a pad.
    if (!ov?.kind && on && msg.velocity > 0 && msg.velocity < 127) ctl.subtype = "pad";
    ctl.hits++;
    ctl.lastSeen = now;
    return { control: ctl, isNew, kind: msg.kind, edge: on ? "press" : "release" };
  }

  /** Drop all learned controls (overrides are retained — see MidiManager.dispose). */
  clear(): void {
    this.controls.clear();
  }
}
