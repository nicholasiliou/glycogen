/**
 * A thin requestAnimationFrame wrapper. The Ticker is the ONLY thing tied to the
 * display refresh rate. It does not advance composition time directly — it simply
 * pumps the engine, which integrates the composition clock against wall time. This
 * separation is what lets export drive the very same engine frame-by-frame with no
 * Ticker at all (FPS-independent rendering).
 */
export class Ticker {
  private raf = 0;
  private running = false;

  constructor(private readonly onFrame: (now: number) => void) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    const loop = (now: number) => {
      if (!this.running) return;
      this.onFrame(now);
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }
}
