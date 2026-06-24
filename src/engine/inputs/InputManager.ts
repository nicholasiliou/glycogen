import { emptyInputSnapshot, type InputSnapshot } from "../core/types";

/**
 * Collects live runtime inputs and exposes them as an immutable per-frame snapshot.
 * The expression system reads this as `input.*`, so a property can be driven by the
 * mouse, scroll, audio or a sensor using the very same binding mechanism as a
 * keyframe track — timeline animation and interaction coexist by construction.
 */
export class InputManager {
  private snap: InputSnapshot = emptyInputSnapshot();
  private el: HTMLElement | null = null;
  private compSize: [number, number] = [1920, 1080];

  private rawX = this.snap.mouseX;
  private rawY = this.snap.mouseY;
  private lastX = this.snap.mouseX;
  private lastY = this.snap.mouseY;
  private rawScroll = 0;
  private lastScroll = 0;
  private lastUpdate = 0;

  private audio?: {
    ctx: AudioContext;
    analyser: AnalyserNode;
    freq: Uint8Array;
  };

  // Bound handlers (stable refs for add/removeEventListener).
  private onPointerMove = (e: PointerEvent) => {
    if (!this.el) return;
    const r = this.el.getBoundingClientRect();
    const nx = r.width ? (e.clientX - r.left) / r.width : 0.5;
    const ny = r.height ? (e.clientY - r.top) / r.height : 0.5;
    this.rawX = nx * this.compSize[0];
    this.rawY = ny * this.compSize[1];
  };
  private onPointerDown = () => (this.snap.mouseDown = true);
  private onPointerUp = () => (this.snap.mouseDown = false);
  private onWheel = (e: WheelEvent) => {
    this.rawScroll += e.deltaY;
  };
  private onKeyDown = (e: KeyboardEvent) => (this.snap.keys[e.key] = true);
  private onKeyUp = (e: KeyboardEvent) => (this.snap.keys[e.key] = false);
  private onOrientation = (e: DeviceOrientationEvent) => {
    this.snap.orientation = {
      alpha: e.alpha ?? 0,
      beta: e.beta ?? 0,
      gamma: e.gamma ?? 0,
    };
  };

  attach(el: HTMLElement): void {
    this.detach();
    this.el = el;
    el.addEventListener("pointermove", this.onPointerMove);
    el.addEventListener("pointerdown", this.onPointerDown);
    window.addEventListener("pointerup", this.onPointerUp);
    el.addEventListener("wheel", this.onWheel, { passive: true });
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    window.addEventListener("deviceorientation", this.onOrientation);
  }

  detach(): void {
    const el = this.el;
    if (el) {
      el.removeEventListener("pointermove", this.onPointerMove);
      el.removeEventListener("pointerdown", this.onPointerDown);
      el.removeEventListener("wheel", this.onWheel);
    }
    window.removeEventListener("pointerup", this.onPointerUp);
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    window.removeEventListener("deviceorientation", this.onOrientation);
    this.el = null;
  }

  setCompSize(width: number, height: number): void {
    this.compSize = [width, height];
    this.snap.width = width;
    this.snap.height = height;
  }

  /** Opt-in microphone analysis. Requires a user gesture in most browsers. */
  async enableAudio(): Promise<void> {
    if (this.audio) return;
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const ctx = new AudioContext();
    const source = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    analyser.smoothingTimeConstant = 0.8;
    source.connect(analyser);
    this.audio = { ctx, analyser, freq: new Uint8Array(analyser.frequencyBinCount) };
  }

  get audioEnabled(): boolean {
    return !!this.audio;
  }

  /** Recompute derived values (velocities, audio bands). Called once per frame. */
  update(now: number, compTime: number): void {
    const dt = this.lastUpdate ? Math.max(1e-3, (now - this.lastUpdate) / 1000) : 1 / 60;
    this.lastUpdate = now;

    this.snap.time = compTime;
    this.snap.mouseX = this.rawX;
    this.snap.mouseY = this.rawY;
    this.snap.mouseNX = this.rawX / this.compSize[0];
    this.snap.mouseNY = this.rawY / this.compSize[1];
    this.snap.mouseVX = (this.rawX - this.lastX) / dt;
    this.snap.mouseVY = (this.rawY - this.lastY) / dt;
    this.snap.mouseSpeed = Math.hypot(this.snap.mouseVX, this.snap.mouseVY);
    this.lastX = this.rawX;
    this.lastY = this.rawY;

    this.snap.scrollY = this.rawScroll;
    this.snap.scrollVelocity = (this.rawScroll - this.lastScroll) / dt;
    this.lastScroll = this.rawScroll;

    if (this.audio) {
      const { analyser, freq } = this.audio;
      analyser.getByteFrequencyData(freq as unknown as Uint8Array<ArrayBuffer>);
      const n = freq.length;
      const band = (a: number, b: number) => {
        let sum = 0;
        const lo = Math.floor(a * n);
        const hi = Math.floor(b * n);
        for (let i = lo; i < hi; i++) sum += freq[i];
        return hi > lo ? sum / (hi - lo) / 255 : 0;
      };
      this.snap.audioLow = band(0, 0.1);
      this.snap.audioMid = band(0.1, 0.4);
      this.snap.audioHigh = band(0.4, 1);
      this.snap.audioLevel = (this.snap.audioLow + this.snap.audioMid + this.snap.audioHigh) / 3;
    }
  }

  snapshot(): InputSnapshot {
    return this.snap;
  }

  dispose(): void {
    this.detach();
    this.audio?.ctx.close().catch(() => {});
    this.audio = undefined;
  }
}
