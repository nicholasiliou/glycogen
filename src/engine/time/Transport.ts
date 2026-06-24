/**
 * The composition clock. Owns playback state for the active composition and is the
 * single source of truth for "what time is it". Time is integrated from wall-clock
 * deltas while playing, but can equally be set explicitly (scrub / seek) or stepped
 * frame-by-frame (export). Supports reverse playback via negative `rate`.
 *
 * Crucially: nothing here speeds up or slows down any sketch loop. It only reports a
 * time value; every layer evaluates itself against that value.
 */
export class Transport {
  time = 0; // seconds, composition-local
  rate = 1; // 1 = realtime, <0 = reverse, 0.5 = half-speed, etc.
  playing = false;
  loop = true;

  duration = 10;
  fps = 30;

  /** Loop region (seconds). Looping wraps within [workIn, workOut]. */
  workIn = 0;
  workOut = 10;

  private lastWall: number | null = null;
  private lastTime = 0;

  get frame(): number {
    return Math.round(this.time * this.fps);
  }

  get totalFrames(): number {
    return Math.max(1, Math.round(this.duration * this.fps));
  }

  configure(opts: { duration?: number; fps?: number; workIn?: number; workOut?: number }): void {
    if (opts.duration !== undefined) this.duration = Math.max(0.1, opts.duration);
    if (opts.fps !== undefined) this.fps = Math.max(1, opts.fps);
    if (opts.workIn !== undefined) this.workIn = clamp(opts.workIn, 0, this.duration);
    if (opts.workOut !== undefined) this.workOut = clamp(opts.workOut, 0, this.duration);
    this.time = clamp(this.time, 0, this.duration);
  }

  play(): void {
    this.playing = true;
    this.lastWall = null; // reset integration so we don't jump
  }

  pause(): void {
    this.playing = false;
  }

  toggle(): void {
    this.playing ? this.pause() : this.play();
  }

  seek(time: number): void {
    this.time = clamp(time, 0, this.duration);
    this.lastTime = this.time;
  }

  seekFrame(frame: number): void {
    this.seek(frame / this.fps);
  }

  stepFrames(n: number): void {
    this.seekFrame(this.frame + n);
  }

  /**
   * Advance the clock from wall-clock time. Returns true if `time` changed.
   * Only meaningful during live preview; export bypasses this entirely.
   */
  advance(wallNow: number): boolean {
    if (!this.playing) {
      this.lastWall = wallNow;
      return false;
    }
    if (this.lastWall === null) {
      this.lastWall = wallNow;
      return false;
    }
    const dt = ((wallNow - this.lastWall) / 1000) * this.rate;
    this.lastWall = wallNow;
    let next = this.time + dt;

    if (this.loop) {
      // Loop within the work area (falls back to full duration if degenerate).
      const lo = this.workIn;
      const hi = this.workOut > this.workIn + 1e-3 ? this.workOut : this.duration;
      const span = hi - lo || this.duration;
      next = lo + ((((next - lo) % span) + span) % span); // wrap, handles reverse too
    } else {
      if (next >= this.duration) {
        next = this.duration;
        this.playing = false;
      } else if (next <= 0) {
        next = 0;
        this.playing = false;
      }
    }
    this.lastTime = this.time;
    this.time = next;
    return this.time !== this.lastTime;
  }
}

function clamp(x: number, min: number, max: number): number {
  return x < min ? min : x > max ? max : x;
}
