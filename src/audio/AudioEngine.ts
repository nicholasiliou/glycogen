import * as Tone from "tone";
import {
  degreeToFreq,
  midiToName,
  snapToScale,
  type ScaleName,
} from "./scale";

/**
 * Owns the single AudioContext, the master bus and the shared musical clock + key. Every
 * instrument connects its dry signal to {@link out} and optional sends to {@link reverbSend}
 * / {@link delaySend}, and schedules rhythmic events on {@link transport} — so the whole
 * ensemble shares one tempo and one key and always sounds intentional together.
 *
 * Nothing here depends on the visual engine; the LivePerformer is what bridges the two.
 */
export class AudioEngine {
  private _started = false;
  private rootMidi = 48; // C3
  private _scale: ScaleName = "minorPentatonic";

  // Master chain (built on start()).
  private masterGain!: Tone.Gain;
  private limiter!: Tone.Limiter;
  private reverb!: Tone.Reverb;
  private delay!: Tone.FeedbackDelay;
  /** Instrument dry-signal destination. */
  out!: Tone.Gain;
  /** Reverb send input — instruments connect a send gain here. */
  reverbSend!: Tone.Gain;
  /** Delay send input. */
  delaySend!: Tone.Gain;

  get started(): boolean {
    return this._started;
  }

  /** The shared musical transport (Tone). Rhythmic instruments schedule against it. */
  get transport() {
    return Tone.getTransport();
  }

  get now(): number {
    return Tone.now();
  }

  /** Resume the context (must be called from a user gesture) and build the master bus. */
  async start(): Promise<void> {
    if (this._started) return;
    await Tone.start();

    this.limiter = new Tone.Limiter(-2).toDestination();
    this.masterGain = new Tone.Gain(0.9).connect(this.limiter);
    this.out = new Tone.Gain(1).connect(this.masterGain);

    this.reverb = new Tone.Reverb({ decay: 6, preDelay: 0.02, wet: 1 }).connect(this.masterGain);
    this.delay = new Tone.FeedbackDelay({ delayTime: "8n.", feedback: 0.32, wet: 1 }).connect(this.masterGain);
    this.reverbSend = new Tone.Gain(0).connect(this.reverb);
    this.delaySend = new Tone.Gain(0).connect(this.delay);

    const t = this.transport;
    t.bpm.value = 110;
    t.swing = 0.08;
    t.swingSubdivision = "16n";
    t.start();
    this._started = true;
  }

  // ── master / clock ──
  get bpm(): number {
    return this._started ? this.transport.bpm.value : 110;
  }
  setBpm(v: number): void {
    if (this._started) this.transport.bpm.rampTo(Math.max(40, Math.min(200, v)), 0.1);
  }
  setMasterLevel(v: number): void {
    if (this._started) this.masterGain.gain.rampTo(Math.max(0, Math.min(1, v)), 0.05);
  }

  // ── key ──
  get scale(): ScaleName {
    return this._scale;
  }
  get root(): number {
    return this.rootMidi;
  }
  setKey(rootMidi: number, scale: ScaleName): void {
    this.rootMidi = rootMidi;
    this._scale = scale;
  }
  /** Root note name, e.g. "C3". */
  get keyLabel(): string {
    return `${midiToName(this.rootMidi)} ${this._scale}`;
  }

  /** Scale degree -> Hz, in the current key. */
  freqOfDegree(degree: number): number {
    return degreeToFreq(this.rootMidi, this._scale, degree);
  }
  /** Snap an arbitrary MIDI note into the current key, return Hz. */
  freqSnapped(midi: number): number {
    return 440 * Math.pow(2, (snapToScale(this.rootMidi, this._scale, midi) - 69) / 12);
  }

  dispose(): void {
    if (!this._started) return;
    this.transport.stop();
    this.transport.cancel();
    [this.out, this.reverbSend, this.delaySend, this.reverb, this.delay, this.masterGain, this.limiter].forEach(
      (n) => n?.dispose(),
    );
    this._started = false;
  }
}
