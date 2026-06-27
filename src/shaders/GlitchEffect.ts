import type { LayerTypeDefinition } from "../engine/plugins/Registry";
import type { LayerRenderer, RenderFrame } from "../engine/render/types";

function num(v: unknown, f: number): number {
  return typeof v === "number" ? v : f;
}
function arr(v: unknown, f: number[]): number[] {
  return Array.isArray(v) ? (v as number[]) : f;
}

// Deterministic per-(frame,salt) PRNG. Same frame → same glitch, every time — which is
// what keeps scrubbing and export reproducible. We never touch Math.random.
function rng(frame: number, salt: number) {
  let a = (frame * 2654435761 + salt * 40503 + 0x9e3779b9) | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Glitch / corrupted-monitor effect — an `effect` layer, so it receives everything
 * composited beneath it as `frame.backdrop` and returns a re-mangled full frame. The
 * usual cyberpunk stack: RGB channel split (chromatic aberration), horizontal slice
 * displacement (the "torn signal" tearing), block/datamosh corruption, scanlines and a
 * vignette. Every effect is driven by a seeded PRNG keyed on frame.frame, so a given
 * frame always glitches identically — fully seekable, no Math.random.
 */
class GlitchEffectRenderer implements LayerRenderer {
  private canvas = document.createElement("canvas");
  private ctx = this.canvas.getContext("2d")!;
  // tint buffer for the channel-split passes
  private tint = document.createElement("canvas");
  private tctx = this.tint.getContext("2d")!;
  // scanline pattern, rebuilt only when spacing changes
  private scan = document.createElement("canvas");
  private sctx = this.scan.getContext("2d")!;
  private scanKey = "";

  resize(w: number, h: number): void {
    this.canvas.width = Math.max(1, Math.round(w));
    this.canvas.height = Math.max(1, Math.round(h));
  }

  /** Draw `src` recoloured to a single channel via multiply, offset by (dx,dy). */
  private channel(src: CanvasImageSource, w: number, h: number, color: string, dx: number, dy: number): void {
    const tc = this.tctx;
    if (this.tint.width !== w || this.tint.height !== h) {
      this.tint.width = w;
      this.tint.height = h;
    }
    tc.globalCompositeOperation = "source-over";
    tc.clearRect(0, 0, w, h);
    tc.drawImage(src, 0, 0, w, h);
    // keep only this channel: multiply by a pure-channel colour
    tc.globalCompositeOperation = "multiply";
    tc.fillStyle = color;
    tc.fillRect(0, 0, w, h);
    // restore alpha from the source so transparent areas stay transparent
    tc.globalCompositeOperation = "destination-in";
    tc.drawImage(src, 0, 0, w, h);
    tc.globalCompositeOperation = "source-over";
    // add the tinted, offset copy onto the main canvas
    this.ctx.globalCompositeOperation = "lighter";
    this.ctx.drawImage(this.tint, dx, dy, w, h);
  }

  private buildScanlines(w: number, h: number, spacing: number, strength: number): void {
    const key = `${w}x${h}|${spacing}|${strength}`;
    if (key === this.scanKey) return;
    this.scan.width = w;
    this.scan.height = h;
    const s = this.sctx;
    s.clearRect(0, 0, w, h);
    s.fillStyle = `rgba(0,0,0,${strength})`;
    for (let y = 0; y < h; y += spacing) {
      s.fillRect(0, y, w, Math.max(1, Math.floor(spacing / 2)));
    }
    this.scanKey = key;
  }

  render(frame: RenderFrame): HTMLCanvasElement {
    const w = frame.width;
    const h = frame.height;
    if (this.canvas.width !== w || this.canvas.height !== h) this.resize(w, h);

    const ctx = this.ctx;
    ctx.globalCompositeOperation = "source-over";
    ctx.clearRect(0, 0, w, h);

    const src = frame.backdrop;
    if (!src) return this.canvas; // nothing beneath us to mangle

    const pr = frame.props;
    const intensity = Math.max(0, Math.min(1, num(pr.intensity, 0.6)));
    if (intensity <= 0) {
      ctx.drawImage(src, 0, 0, w, h);
      return this.canvas;
    }

    // ── how often the screen "breaks up". burstRate is glitches-per-100-frames; we
    //    derive a per-frame boolean so calm stretches alternate with violent bursts. ──
    const burstRate = Math.max(0, Math.min(1, num(pr.burstRate, 0.35)));
    const rBurst = rng(Math.floor(frame.frame / Math.max(1, Math.round(num(pr.burstHold, 3)))), 999);
    const bursting = rBurst() < burstRate;
    const amp = intensity * (bursting ? 1 : 0.25); // baseline shimmer even when not bursting

    // ─────────────────────────────────────────────────────────────────────────
    // 1) horizontal slice displacement — cut the image into bands and shove each
    //    sideways. This is the core "torn transmission" look.
    // ─────────────────────────────────────────────────────────────────────────
    const sliceCount = Math.max(1, Math.round(num(pr.slices, 14)));
    const maxShift = num(pr.sliceShift, 40) * amp;
    const rSlice = rng(Math.floor(frame.frame), 1);
    // draw the clean image first as the base, then overdraw shifted bands
    ctx.drawImage(src, 0, 0, w, h);
    const bandH = h / sliceCount;
    for (let i = 0; i < sliceCount; i++) {
      // only some bands glitch each frame; the rest stay put
      if (rSlice() > 0.5 * amp + 0.12) continue;
      const sy = Math.floor(i * bandH);
      const bh = Math.ceil(bandH) + 1;
      const shift = (rSlice() * 2 - 1) * maxShift;
      // clear the band then redraw it offset, so we don't double-expose
      ctx.clearRect(0, sy, w, bh);
      ctx.drawImage(src, 0, sy, w, bh, shift, sy, w, bh);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 2) RGB channel split (chromatic aberration) — re-draw R and B offset, added
    //    over the green-ish base. Subtle when calm, wide during bursts.
    // ─────────────────────────────────────────────────────────────────────────
    const aberration = num(pr.aberration, 6) * amp;
    if (aberration > 0.1) {
      const rChan = rng(Math.floor(frame.frame), 2);
      const ax = aberration * (0.6 + rChan() * 0.8);
      // snapshot current canvas (the displaced image) as the channel source
      const snap = this.tint; // reuse not safe here; take a fresh draw from src instead
      void snap;
      // We split the *original* src so colours stay crisp; offsets sell the effect.
      this.channel(src, w, h, "#ff0000", -ax, (rChan() * 2 - 1) * aberration * 0.3);
      this.channel(src, w, h, "#00ffff",  ax, (rChan() * 2 - 1) * aberration * 0.3);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 3) block / datamosh corruption — copy random rectangles from one spot to
    //    another. Only fires during bursts; this is the "decoded-wrong" garbage.
    // ─────────────────────────────────────────────────────────────────────────
    if (bursting) {
      const blocks = Math.round(num(pr.blocks, 6) * intensity);
      const rBlk = rng(Math.floor(frame.frame), 3);
      ctx.globalCompositeOperation = "source-over";
      for (let b = 0; b < blocks; b++) {
        const bw = (0.08 + rBlk() * 0.3) * w;
        const bh2 = (0.01 + rBlk() * 0.06) * h;
        const sx = rBlk() * (w - bw);
        const syb = rBlk() * (h - bh2);
        const dx = sx + (rBlk() * 2 - 1) * maxShift * 1.5;
        const dy = syb + (rBlk() * 2 - 1) * bh2 * 2;
        ctx.drawImage(src, sx, syb, bw, bh2, dx, dy, bw, bh2);
      }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 4) scanlines + 5) vignette — the static CRT/monitor overlay.
    // ─────────────────────────────────────────────────────────────────────────
    const scanStrength = Math.max(0, Math.min(1, num(pr.scanlines, 0.18)));
    if (scanStrength > 0) {
      const spacing = Math.max(2, Math.round(num(pr.scanSpacing, 3)));
      this.buildScanlines(w, h, spacing, scanStrength);
      ctx.globalCompositeOperation = "source-over";
      ctx.drawImage(this.scan, 0, 0);
    }

    const vignette = Math.max(0, Math.min(1, num(pr.vignette, 0.25)));
    if (vignette > 0) {
      const g = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.35, w / 2, h / 2, Math.max(w, h) * 0.75);
      g.addColorStop(0, "rgba(0,0,0,0)");
      g.addColorStop(1, `rgba(0,0,0,${vignette})`);
      ctx.globalCompositeOperation = "source-over";
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 6) optional colour tint — push the whole thing toward a neon cast.
    // ─────────────────────────────────────────────────────────────────────────
    const [tr, tg, tb, ta] = arr(pr.tint, [0, 0, 0, 0]);
    if (ta > 0) {
      ctx.globalCompositeOperation = "overlay";
      ctx.fillStyle = `rgba(${tr},${tg},${tb},${ta / 255})`;
      ctx.fillRect(0, 0, w, h);
    }

    ctx.globalCompositeOperation = "source-over";
    return this.canvas;
  }

  dispose(): void {
    this.canvas.width = this.canvas.height = 0;
    this.tint.width = this.tint.height = 0;
    this.scan.width = this.scan.height = 0;
  }
}

export const glitchEffectLayerType: LayerTypeDefinition = {
  type: "glitchEffect",
  kind: "effect", // ← receives frame.backdrop (everything composited below) and returns a full frame
  label: "Glitch / CRT",
  category: "Effect",
  icon: "MonitorX",
  description: "Corrupted-monitor effect: RGB split, slice displacement, datamosh blocks, scanlines & vignette. Layer it over anything. Deterministic & seekable.",
  defaultSize: (comp) => [comp.width, comp.height],
  schema: [
    { key: "intensity", name: "Intensity", type: "percent", default: 0.6, group: "Glitch", meta: { min: 0, max: 1, step: 0.01 } },
    { key: "burstRate", name: "Burst Rate", type: "percent", default: 0.35, group: "Glitch", meta: { min: 0, max: 1, step: 0.01 } },
    { key: "burstHold", name: "Burst Hold (frames)", type: "number", default: 3, group: "Glitch", meta: { min: 1, max: 30, step: 1 } },
    { key: "slices", name: "Slice Count", type: "number", default: 14, group: "Displace", meta: { min: 1, max: 60, step: 1 } },
    { key: "sliceShift", name: "Slice Shift (px)", type: "number", default: 40, group: "Displace", meta: { min: 0, max: 200, step: 1 } },
    { key: "blocks", name: "Datamosh Blocks", type: "number", default: 6, group: "Displace", meta: { min: 0, max: 30, step: 1 } },
    { key: "aberration", name: "Chromatic Aberration", type: "number", default: 6, group: "Color", meta: { min: 0, max: 40, step: 0.5 } },
    { key: "tint", name: "Neon Tint", type: "color", default: [0, 0, 0, 0], group: "Color" },
    { key: "scanlines", name: "Scanline Strength", type: "percent", default: 0.18, group: "Monitor", meta: { min: 0, max: 1, step: 0.01 } },
    { key: "scanSpacing", name: "Scanline Spacing", type: "number", default: 3, group: "Monitor", animatable: false, meta: { min: 2, max: 12, step: 1 } },
    { key: "vignette", name: "Vignette", type: "percent", default: 0.25, group: "Monitor", meta: { min: 0, max: 1, step: 0.01 } },
  ],
  createRenderer: () => new GlitchEffectRenderer(),
};