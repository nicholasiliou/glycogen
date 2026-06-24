import {
  KIND_BEHAVIOR,
  type ControlKind,
  type ControlOverride,
  type ControlSubtype,
  type MidiControl,
  type MidiDeviceInfo,
  type MidiManagerEvents,
  type MidiStatus,
} from "./types";

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

// ── minimal Web MIDI typings (not guaranteed present in lib.dom across TS versions) ──
interface WMMessageEvent {
  data: Uint8Array | null;
}
interface WMInput {
  id: string;
  name: string | null;
  manufacturer: string | null;
  state: string;
  onmidimessage: ((e: WMMessageEvent) => void) | null;
}
interface WMAccess {
  inputs: Map<string, WMInput>;
  onstatechange: ((e: unknown) => void) | null;
}
type RequestMIDIAccess = (opts?: { sysex?: boolean }) => Promise<WMAccess>;

/**
 * Wraps the Web MIDI API into a normalized, framework-agnostic stream of controls. Like
 * the engine's InputManager it just collects state and emits events; the UI and the
 * audio/mapping layers consume it. It "learns" the device by listening: every CC/note
 * becomes a {@link MidiControl} the first time it is touched, which is exactly what makes
 * the on-screen monitor able to capture an unknown controller's layout.
 */
export class MidiManager {
  private access?: WMAccess;
  private controls = new Map<string, MidiControl>();
  private listeners: { [K in keyof MidiManagerEvents]: Set<(v: MidiManagerEvents[K]) => void> } = {
    status: new Set(),
    devices: new Set(),
    discover: new Set(),
    control: new Set(),
    trigger: new Set(),
    release: new Set(),
  };
  private boundInputs = new Set<WMInput>();
  /** User overrides (name + kind) keyed by control id — the saved preset, pushed down here so
   * retyping a control actually changes how its messages are interpreted, not just its label. */
  private overrides = new Map<string, ControlOverride>();
  private _status: MidiStatus = "idle";

  get status(): MidiStatus {
    return this._status;
  }

  get supported(): boolean {
    return typeof navigator !== "undefined" && "requestMIDIAccess" in navigator;
  }

  /** Snapshot of all controls discovered so far, most-recently-active first. */
  list(): MidiControl[] {
    return [...this.controls.values()].sort((a, b) => b.lastSeen - a.lastSeen);
  }

  /** Drop learned controls (keeps device binding + overrides) so the layout can be re-captured. */
  forget(): void {
    this.controls.clear();
  }

  get(id: string): MidiControl | undefined {
    return this.controls.get(id);
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

  on<K extends keyof MidiManagerEvents>(ev: K, fn: (v: MidiManagerEvents[K]) => void): () => void {
    this.listeners[ev].add(fn as never);
    return () => this.listeners[ev].delete(fn as never);
  }

  private emit<K extends keyof MidiManagerEvents>(ev: K, v: MidiManagerEvents[K]): void {
    this.listeners[ev].forEach((fn) => (fn as (x: MidiManagerEvents[K]) => void)(v));
  }

  private setStatus(s: MidiStatus): void {
    this._status = s;
    this.emit("status", s);
  }

  /** Request access (needs a secure context; Chrome/Edge support it best). */
  async enable(): Promise<void> {
    if (this.access) return;
    if (!this.supported) {
      this.setStatus("unsupported");
      return;
    }
    try {
      const req = (navigator as unknown as { requestMIDIAccess: RequestMIDIAccess }).requestMIDIAccess;
      this.access = await req.call(navigator, { sysex: false });
      this.access.onstatechange = () => this.bindInputs();
      this.bindInputs();
      this.setStatus("ready");
    } catch {
      this.setStatus("denied");
    }
  }

  private bindInputs(): void {
    if (!this.access) return;
    for (const input of this.access.inputs.values()) {
      if (this.boundInputs.has(input)) continue;
      input.onmidimessage = (e) => this.onMessage(input, e);
      this.boundInputs.add(input);
    }
    this.emitDevices();
  }

  private emitDevices(): void {
    if (!this.access) return;
    const devices: MidiDeviceInfo[] = [...this.access.inputs.values()].map((i) => ({
      id: i.id,
      name: i.name ?? "Unknown",
      manufacturer: i.manufacturer ?? "",
      state: i.state,
    }));
    this.emit("devices", devices);
  }

  devices(): MidiDeviceInfo[] {
    if (!this.access) return [];
    return [...this.access.inputs.values()].map((i) => ({
      id: i.id,
      name: i.name ?? "Unknown",
      manufacturer: i.manufacturer ?? "",
      state: i.state,
    }));
  }

  private onMessage(input: WMInput, e: WMMessageEvent): void {
    const data = e.data;
    if (!data || data.length < 2) return;
    const status = data[0];
    const type = status & 0xf0;
    const channel = status & 0x0f;
    const d1 = data[1];
    const d2 = data.length > 2 ? data[2] : 0;
    const now = performance.now();

    if (type === 0xb0) {
      // Control change
      this.handleControl(input, `cc:${channel}:${d1}`, "knob", true, channel, d1, d2, now, "cc");
    } else if (type === 0x90 && d2 > 0) {
      // Note on
      this.handleNote(input, channel, d1, d2, now, true);
    } else if (type === 0x80 || (type === 0x90 && d2 === 0)) {
      // Note off
      this.handleNote(input, channel, d1, d2, now, false);
    } else if (type === 0xe0) {
      // Pitch bend (14-bit)
      const raw14 = (d2 << 7) | d1;
      this.handleControl(input, `pb:${channel}`, "pitchbend", true, channel, undefined, raw14, now, "pitchbend", 16383);
    }
  }

  private ensure(
    id: string,
    init: () => MidiControl,
  ): { ctl: MidiControl; isNew: boolean } {
    let ctl = this.controls.get(id);
    if (ctl) return { ctl, isNew: false };
    ctl = init();
    this.controls.set(id, ctl);
    return { ctl, isNew: true };
  }

  private handleControl(
    input: WMInput,
    id: string,
    subtype: ControlSubtype,
    continuous: boolean,
    channel: number,
    number: number | undefined,
    raw: number,
    now: number,
    msgKind: "cc" | "pitchbend",
    rawMax = 127,
  ): void {
    if (this.overrides.get(id)?.disabled) return; // faulty control — drop its messages
    const { ctl, isNew } = this.ensure(id, () => ({
      id,
      label: number === undefined ? `Pitch ch${channel + 1}` : `CC ${number}`,
      continuous,
      subtype,
      channel,
      number,
      value: raw / rawMax,
      raw,
      pressed: false,
      relative: false,
      delta: 0,
      deviceId: input.id,
      deviceName: input.name ?? "Unknown",
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
      if (msgKind === "cc") {
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
    if (isNew) this.emit("discover", ctl);
    this.emit("control", { control: ctl, kind: msgKind });
    if (edge === "press") this.emit("trigger", ctl);
    else if (edge === "release") this.emit("release", ctl);
  }

  private handleNote(
    input: WMInput,
    channel: number,
    note: number,
    velocity: number,
    now: number,
    on: boolean,
  ): void {
    const id = `note:${channel}:${note}`;
    if (this.overrides.get(id)?.disabled) return; // faulty control — drop its messages
    const { ctl, isNew } = this.ensure(id, () => ({
      id,
      label: `Note ${note}`,
      continuous: false,
      subtype: "pad",
      channel,
      number: note,
      value: 0,
      raw: 0,
      pressed: false,
      relative: false,
      delta: 0,
      deviceId: input.id,
      deviceName: input.name ?? "Unknown",
      hits: 0,
      lastSeen: now,
    }));
    const ov = this.overrides.get(id);
    if (ov?.name) ctl.label = ov.name;
    ctl.pressed = on;
    ctl.raw = velocity;
    ctl.value = on ? velocity / 127 : 0;
    // A note that always arrives at full velocity behaves like a button; varying velocity = a pad.
    if (!ov?.kind && on && velocity > 0 && velocity < 127) ctl.subtype = "pad";
    ctl.hits++;
    ctl.lastSeen = now;
    if (isNew) this.emit("discover", ctl);
    this.emit("control", { control: ctl, kind: on ? "noteon" : "noteoff" });
    this.emit(on ? "trigger" : "release", ctl);
  }

  dispose(): void {
    for (const input of this.boundInputs) input.onmidimessage = null;
    this.boundInputs.clear();
    if (this.access) this.access.onstatechange = null;
    // Drop the access handle so a later enable() re-binds (matters under React StrictMode's
    // mount→unmount→mount, where the same manager is disposed then reused).
    this.access = undefined;
    this.controls.clear();
    // Keep `overrides`: the provider re-applies them after re-enable, but not clearing avoids a
    // flash of un-skinned controls during StrictMode's mount→unmount→mount.
    this._status = "idle";
  }
}
