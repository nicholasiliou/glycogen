import {
  type ControlOverride,
  type MidiControl,
  type MidiDeviceInfo,
  type MidiManagerEvents,
  type MidiStatus,
} from "./types";
import type { RequestMIDIAccess, WMAccess, WMInput, WMMessageEvent, WMOutput } from "./webMidiTypes";
import { parseMidiMessage } from "./MidiMessageParser";
import { ControlLearner, type LearnResult } from "./ControlLearner";

/**
 * Wraps the Web MIDI API into a normalized, framework-agnostic stream of controls. Like
 * the engine's InputManager it just collects state and emits events; the UI and the
 * audio/mapping layers consume it. The actual "learning"  -  turning every CC/note into a
 * {@link MidiControl} the first time it is touched  -  lives in {@link ControlLearner}; this class
 * owns the device connection, decodes bytes via {@link parseMidiMessage}, and emits the events.
 */
export class MidiManager {
  private access?: WMAccess;
  /** In-flight enable() promise, so concurrent calls share one requestMIDIAccess instead of each
   * acquiring a *separate* access object (which would bind onmidimessage twice → every physical
   * message fires twice). This bites under React StrictMode's mount→unmount→mount double-invoke. */
  private enabling?: Promise<void>;
  private learner = new ControlLearner();
  private listeners: { [K in keyof MidiManagerEvents]: Set<(v: MidiManagerEvents[K]) => void> } = {
    status: new Set(),
    devices: new Set(),
    discover: new Set(),
    control: new Set(),
    trigger: new Set(),
    release: new Set(),
  };
  private boundInputs = new Set<WMInput>();
  private _status: MidiStatus = "idle";

  get status(): MidiStatus {
    return this._status;
  }

  get supported(): boolean {
    return typeof navigator !== "undefined" && "requestMIDIAccess" in navigator;
  }

  /** Snapshot of all controls discovered so far, most-recently-active first. */
  list(): MidiControl[] {
    return this.learner.list();
  }

  /** Drop learned controls (keeps device binding + overrides) so the layout can be re-captured. */
  forget(): void {
    this.learner.forget();
  }

  get(id: string): MidiControl | undefined {
    return this.learner.get(id);
  }

  /** Replace the whole override set (e.g. when a preset loads or is switched). */
  applyOverrides(map: Record<string, ControlOverride>): void {
    this.learner.applyOverrides(map);
  }

  /** Set/clear a single control's override; reflects immediately on the learned control. */
  setOverride(id: string, ov: ControlOverride | null): void {
    this.learner.setOverride(id, ov);
  }

  on<K extends keyof MidiManagerEvents>(ev: K, fn: (v: MidiManagerEvents[K]) => void): () => void {
    this.listeners[ev].add(fn as never);
    return () => this.listeners[ev].delete(fn as never);
  }

  private emit<K extends keyof MidiManagerEvents>(ev: K, v: MidiManagerEvents[K]): void {
    this.listeners[ev].forEach((fn) => (fn as (x: MidiManagerEvents[K]) => void)(v));
  }

  private setStatus(s: MidiStatus): void {
    console.warn("[midi] setStatus", this._status, "->", s);
    this._status = s;
    this.emit("status", s);
  }

  /** Request access (needs a secure context; Chrome/Edge support it best). */
  enable(): Promise<void> {
    console.warn("[midi] enable() called; access?", !!this.access, "enabling?", !!this.enabling, "status", this._status);
    if (this.access) return Promise.resolve();
    // Coalesce concurrent calls: a second enable() while the first is still awaiting
    // requestMIDIAccess must NOT start its own request. Two requests yield two *distinct* access
    // objects for the same physical port, and binding onmidimessage on both makes every message
    // fire twice  -  which silently no-ops toggle actions (a toggle flips twice → back to start).
    // This is exactly what React StrictMode's mount→unmount→mount double-invoke triggers.
    if (this.enabling) return this.enabling;
    if (!this.supported) {
      this.setStatus("unsupported");
      return Promise.resolve();
    }
    this.enabling = (async () => {
      try {
        const req = (navigator as unknown as { requestMIDIAccess: RequestMIDIAccess }).requestMIDIAccess;
        const access = await req.call(navigator, { sysex: false });
        this.access = access;
        access.onstatechange = () => this.bindInputs();
        this.bindInputs();
        this.setStatus("ready");
      } catch (err) {
        // requestMIDIAccess rejects for two very different reasons that we must not conflate:
        // a genuine permission refusal (SecurityError / NotAllowedError  -  user blocked it or an
        // insecure origin) vs. the MIDI backend failing to initialize (e.g. Linux/Chromium with no
        // ALSA sequencer). Only the former is really "denied"; blaming the permission for the latter
        // sends people to re-grant an already-granted permission. See the Ubuntu snd-seq case.
        console.warn("[midi] REJECTED:", err instanceof DOMException ? `${err.name}: ${err.message}` : err, "| inIframe:", window.self !== window.top);
        const name = err instanceof DOMException ? err.name : "";
        const denied = name === "SecurityError" || name === "NotAllowedError";
        this.setStatus(denied ? "denied" : "unavailable");
      } finally {
        this.enabling = undefined;
      }
    })();
    return this.enabling;
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
    this.emit("devices", this.devices());
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
    const msg = parseMidiMessage(e.data);
    if (!msg) return;
    const now = performance.now();
    const result =
      msg.kind === "cc" || msg.kind === "pitchbend"
        ? this.learner.learnControl(input, msg, now)
        : this.learner.learnNote(input, msg, now);
    if (result) this.emitLearned(result);
  }

  /** Fan a learning result out to the discover/control/trigger/release listeners. */
  private emitLearned(r: LearnResult): void {
    if (r.isNew) this.emit("discover", r.control);
    this.emit("control", { control: r.control, kind: r.kind });
    if (r.edge === "press") this.emit("trigger", r.control);
    else if (r.edge === "release") this.emit("release", r.control);
  }

  /** All connected MIDI outputs. */
  outputs(): WMOutput[] {
    if (!this.access) return [];
    return [...this.access.outputs.values()];
  }

  /** Send a Note On to a specific output (defaults to first output). Velocity 0 = LED off. */
  sendNote(channel: number, note: number, velocity: number, outputId?: string): void {
    const out = this.resolveOutput(outputId);
    if (!out) return;
    const status = 0x90 | (channel & 0x0f);
    out.send([status, note & 0x7f, velocity & 0x7f]);
  }

  /** Send a CC message to a specific output (defaults to first output). */
  sendCC(channel: number, cc: number, value: number, outputId?: string): void {
    const out = this.resolveOutput(outputId);
    if (!out) return;
    const status = 0xb0 | (channel & 0x0f);
    out.send([status, cc & 0x7f, value & 0x7f]);
  }

  /** Turn off every LED on every output by sending Note Off across all notes and channels. */
  allLedsOff(): void {
    for (const out of this.outputs()) {
      for (let ch = 0; ch < 16; ch++) {
        for (let n = 0; n < 128; n++) {
          out.send([0x90 | ch, n, 0]);
        }
      }
    }
  }

  private resolveOutput(outputId?: string): WMOutput | undefined {
    if (!this.access) return undefined;
    if (outputId) return this.access.outputs.get(outputId);
    return this.access.outputs.values().next().value;
  }

  dispose(): void {
    for (const input of this.boundInputs) input.onmidimessage = null;
    this.boundInputs.clear();
    if (this.access) this.access.onstatechange = null;
    // Drop the access handle so a later enable() re-binds (matters under React StrictMode's
    // mount→unmount→mount, where the same manager is disposed then reused).
    this.access = undefined;
    this.learner.clear();
    // Keep the learner's overrides: the provider re-applies them after re-enable, but not clearing
    // avoids a flash of un-skinned controls during StrictMode's mount→unmount→mount.
    this._status = "idle";
  }
}
