import { ParamDriver } from "@/controls/adapters";
import type { ControlBus } from "@/controls/ControlBus";
import { clamp01 } from "@/controls/types";
import { fillerBindings } from "@/db/filler";
import { actionBindings, paramBindings, params } from "@/db/schema";
import type { FieldFn, Frame, Plugin } from "@/plugins/Plugin";
import { TextLayer } from "@/plugins/TextLayer";
import { cropRect, getBarcode, getWatermark, WATERMARK_PAD, WATERMARK_SIZE, watermarkOrigin } from "@/runtime/watermark";

/** One layer: a generator plugin plus an optional per-layer effect ("shader") on its output. */
export interface BankState {
  plugin: Plugin | null;
  shader: Plugin | null;
}
/** Which half of the focused bank the controller is currently driving. */
export type FocusPart = "plugin" | "shader";

export const BANK_COUNT = 6;

/**
 * The runtime host and compositor: one flat row of {@link BANK_COUNT} banks. Each bank holds a
 * generator plugin with an optional per-layer shader on its output, and every loaded bank is
 * composited in order — each at its plugin's own `opacity` (the factory param that replaced the
 * deck crossfade). One bank is *active* (focused): each frame the bus drives that bank's plugin
 * — or its shader, per {@link focusPart} — then all banks render and composite to the output.
 */
export class Stage {
  readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private buffer = document.createElement("canvas");
  private bctx = this.buffer.getContext("2d")!;
  // Scratch surfaces for the per-layer recolor pass: the layer's dry+wet mix is folded into
  // layerBuf, then luminance×preset recolored into tintBuf (only touched when a tint is active).
  private layerBuf = document.createElement("canvas");
  private lctx = this.layerBuf.getContext("2d")!;
  private tintBuf = document.createElement("canvas");
  private tctx = this.tintBuf.getContext("2d")!;

  readonly banks: BankState[] = Array.from({ length: BANK_COUNT }, () => ({ plugin: null, shader: null }));
  active = 0;
  focusPart: FocusPart = "plugin";
  /** Bake the QR watermark into the output canvas (so exports carry it by default). */
  watermark = true;
  /** Export aspect (w/h), synced from the export panel — the watermark anchors inside its crop. */
  exportRatio = 16 / 9;

  private raf = 0;
  private startT = 0;
  private lastT = 0;

  /** Per-plugin binding runtime, rebuilt lazily when the paramBindings table changes. */
  private drivers = new WeakMap<Plugin, { at: number; list: ParamDriver[] }>();

  constructor(private bus: ControlBus, canvas?: HTMLCanvasElement) {
    this.canvas = canvas ?? document.createElement("canvas");
    this.ctx = this.canvas.getContext("2d")!;
  }

  // ── composition ──────────────────────────────────────────────────────────────────────────────

  /** The plugin the controller drives right now: the focused bank's generator or its shader. */
  managed(): Plugin | null {
    const bank = this.banks[this.active];
    return this.focusPart === "shader" ? bank.shader : bank.plugin;
  }

  /** Every currently-loaded plugin (all bank generators + their shaders), for live param ticks. */
  private loaded(): Plugin[] {
    const out: Plugin[] = [];
    for (const bank of this.banks) {
      if (bank.plugin) out.push(bank.plugin);
      if (bank.shader) out.push(bank.shader);
    }
    return out;
  }

  loadBank(index: number, plugin: Plugin): void {
    const bank = this.banks[index];
    bank.plugin?.dispose();
    plugin.resize(this.canvas.width, this.canvas.height);
    bank.plugin = plugin;
    bank.shader?.onAttach?.(plugin); // a kept layer shader re-adopts the new host's defaults
    this.active = index;
    this.focusPart = "plugin";
  }

  selectBank(index: number): void {
    if (this.banks[index].plugin) {
      this.active = index;
      this.focusPart = "plugin";
    }
  }

  /** Reorder banks: move `from` to position `to` (composite order = bank order). The active
   *  selection follows its content, so the focused layer stays focused wherever it lands. */
  moveBank(from: number, to: number): void {
    if (from === to || !this.banks[from] || !this.banks[to]) return;
    const [bank] = this.banks.splice(from, 1);
    this.banks.splice(to, 0, bank);
    if (this.active === from) this.active = to;
    else if (from < this.active && to >= this.active) this.active--;
    else if (from > this.active && to <= this.active) this.active++;
  }

  clearBank(index = this.active): void {
    const bank = this.banks[index];
    bank.plugin?.dispose();
    bank.shader?.dispose();
    bank.plugin = null;
    bank.shader = null;
  }

  /** Put a shader on a bank's output (or clear it with null). */
  setShader(index: number, shader: Plugin | null): void {
    const bank = this.banks[index];
    if (bank.shader && bank.shader !== shader) bank.shader.dispose();
    bank.shader = shader;
    if (shader) {
      shader.resize(this.canvas.width, this.canvas.height);
      if (bank.plugin) shader.onAttach?.(bank.plugin);
    }
  }

  /** While a video export locks the render size, viewport resizes are deferred until release. */
  private sizeLocked = false;
  private deferredSize: { w: number; h: number } | null = null;

  resize(w: number, h: number): void {
    if (this.sizeLocked) {
      this.deferredSize = { w, h };
      return;
    }
    this.canvas.width = this.buffer.width = w;
    this.canvas.height = this.buffer.height = h;
    for (const p of this.loaded()) p.resize(w, h);
  }

  /**
   * Render at an explicit pixel size until {@link unlockRenderSize}: a video export records the
   * true output resolution instead of upscaling the viewport-sized canvas. The previous size (or
   * any viewport resize that arrives while locked) is restored on unlock.
   */
  lockRenderSize(w: number, h: number): void {
    const prev = { w: this.canvas.width, h: this.canvas.height };
    this.unlockRenderSize();
    this.resize(w, h);
    this.sizeLocked = true;
    this.deferredSize = prev;
  }

  unlockRenderSize(): void {
    if (!this.sizeLocked) return;
    this.sizeLocked = false;
    if (this.deferredSize) this.resize(this.deferredSize.w, this.deferredSize.h);
    this.deferredSize = null;
  }

  // ── loop ─────────────────────────────────────────────────────────────────────────────────────
  start(): void {
    if (this.raf) return;
    this.startT = this.lastT = nowSec();
    const loop = () => {
      this.tick();
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop(): void {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  /**
   * The text field for sims to react to, sourced from *any* loaded TextLayer anywhere on the stage.
   * A stage-wide field is what makes text interaction (fill/attract) reachable from any bank — it
   * restores the old "text sits below everything" behaviour. A TextLayer in an earlier bank still
   * overrides this for later banks (see the threading in {@link tick}).
   */
  private stageTextField(): FieldFn | null {
    for (const bank of this.banks) {
      const f = bank.plugin?.exportField?.();
      if (f) return f;
    }
    return null;
  }

  /**
   * The focused plugin's binding rows as live drivers. Cached per plugin instance against the
   * table version, so remaps/preset loads apply next frame and steady-state frames pay one
   * comparison. Driver press/hit baselines reset naturally on rebuild.
   */
  private resolveDrivers(plugin: Plugin): ParamDriver[] {
    // Filler bindings depend on actionBindings too (an action frees/occupies widgets), so the cache
    // key folds both table versions — a remap on either re-derives next frame.
    const version = paramBindings.version + actionBindings.version;
    const cached = this.drivers.get(plugin);
    if (cached && cached.at === version) return cached.list;
    const byName = new Map(plugin.params.map((p) => [p.name, p]));
    const list: ParamDriver[] = [];
    for (const row of paramBindings.by("plugin", plugin.id)) {
      const param = params.get(row.paramId);
      const target = param && byName.get(param.name);
      if (target) list.push(new ParamDriver(row.widgetId, target, row.adapter));
    }
    // Exhibition fillers: every widget left empty for this plugin drives one of its own params, so
    // no control is dead. Computed, never persisted; can't collide (real/action/reserved skipped).
    for (const filler of fillerBindings(plugin.id)) {
      const target = byName.get(filler.param.name);
      if (target) list.push(new ParamDriver(filler.widgetId, target, filler.adapter));
    }
    this.drivers.set(plugin, { at: version, list });
    return list;
  }

  /** Advance one frame. Exposed (with an injectable clock) for headless tests. */
  tick(now = nowSec()): void {
    const dt = now - this.lastT;
    this.lastT = now;

    // Drive only the focused plugin's (or shader's) params from the bus, so the controller drives
    // one layer at a time. Param state is retained on each plugin instance, so a setting made while
    // a layer is focused persists after focus moves elsewhere.
    const managed = this.managed();
    if (managed) for (const d of this.resolveDrivers(managed)) d.apply(this.bus.get(d.widgetId));
    // Every loaded param ticks every frame: smoothing keeps easing and queued UI presses land
    // even while the plugin is unfocused.
    for (const plugin of this.loaded()) for (const p of plugin.params) p.tick();

    const w = this.canvas.width, h = this.canvas.height;
    const frame: Frame = { width: w, height: h, time: now - this.startT, dt, input: null, textField: this.stageTextField() };

    // Composite every loaded bank in order, each at its plugin's own opacity. frame.input threads
    // the composite-so-far, and a TextLayer in an earlier bank overrides the stage-wide field for
    // the banks above it.
    this.bctx.clearRect(0, 0, w, h);
    let drawnAny = false;
    let textField: FieldFn | null = frame.textField;
    for (const bank of this.banks) {
      const plugin = bank.plugin;
      if (!plugin) continue;
      const out = plugin.render({ ...frame, input: drawnAny ? this.buffer : null, textField });
      if (plugin.exportField) textField = plugin.exportField();
      if (!out) continue;

      const alpha = clamp01(plugin.opacity.value);
      if (alpha <= 0) continue;

      // Per-layer shader: blend dry (plugin) and wet (shader) by the shader's own opacity — at the
      // default 1 the shader fully replaces the layer's output, matching the old global slot.
      const shaded = bank.shader ? bank.shader.render({ ...frame, input: out, textField: null }) : null;
      const wet = bank.shader ? clamp01(bank.shader.opacity.value) : 0;
      // The layer's factory color (independent of the shader slot) recolors the *final* layer
      // output — dry+wet are folded into a scratch first so shader and tint stack.
      const tint = plugin.tintHex();
      if (tint) {
        const l = this.lctx;
        if (this.layerBuf.width !== w || this.layerBuf.height !== h) { this.layerBuf.width = w; this.layerBuf.height = h; }
        l.clearRect(0, 0, w, h);
        if (shaded) {
          if (wet < 1) { l.globalAlpha = 1 - wet; l.drawImage(out, 0, 0, w, h); }
          if (wet > 0) { l.globalAlpha = wet; l.drawImage(shaded, 0, 0, w, h); }
          l.globalAlpha = 1;
        } else {
          l.drawImage(out, 0, 0, w, h);
        }
        this.bctx.globalAlpha = alpha;
        this.bctx.drawImage(this.recolor(this.layerBuf, tint, w, h), 0, 0, w, h);
      } else if (shaded) {
        if (wet < 1) {
          this.bctx.globalAlpha = alpha * (1 - wet);
          this.bctx.drawImage(out, 0, 0, w, h);
        }
        if (wet > 0) {
          this.bctx.globalAlpha = alpha * wet;
          this.bctx.drawImage(shaded, 0, 0, w, h);
        }
      } else {
        this.bctx.globalAlpha = alpha;
        this.bctx.drawImage(out, 0, 0, w, h);
      }
      drawnAny = true;
    }
    this.bctx.globalAlpha = 1;

    this.ctx.clearRect(0, 0, w, h);
    this.ctx.fillStyle = "#000";
    this.ctx.fillRect(0, 0, w, h);
    this.ctx.drawImage(this.buffer, 0, 0, w, h);

    // The watermark lives on the output canvas itself, so stills and video pick it up for free.
    // Anchored to the mask's bottom edge INSIDE the export crop (the framed region the guide
    // shows and exports capture) — not the arbitrary-aspect canvas bottom.
    const wm = this.watermark ? getWatermark() : null;
    if (wm) {
      const crop = cropRect(w, h, this.exportRatio);
      const { x, y } = watermarkOrigin(crop.w, crop.h);
      this.ctx.drawImage(wm, crop.x + x, crop.y + y, WATERMARK_SIZE, WATERMARK_SIZE);
      const bc = getBarcode();
      if (bc) {
        const bcW = WATERMARK_SIZE * (bc.width / bc.height);
        this.ctx.drawImage(bc, crop.x + x + WATERMARK_SIZE + WATERMARK_PAD, crop.y + y, bcW, WATERMARK_SIZE);
      }
    }
  }

  /** Luminance × preset hex (the old Color shader's math): white → the color, black stays black,
   *  and the source's own alpha clips the fill back out of transparent regions. */
  private recolor(src: HTMLCanvasElement, hex: string, w: number, h: number): HTMLCanvasElement {
    const c = this.tintBuf, ctx = this.tctx;
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
    ctx.globalCompositeOperation = "source-over";
    ctx.clearRect(0, 0, w, h);
    ctx.filter = "grayscale(1)";
    ctx.drawImage(src, 0, 0, w, h);
    ctx.filter = "none";
    ctx.globalCompositeOperation = "multiply";
    ctx.fillStyle = hex;
    ctx.fillRect(0, 0, w, h);
    ctx.globalCompositeOperation = "destination-in";
    ctx.drawImage(src, 0, 0, w, h);
    ctx.globalCompositeOperation = "source-over";
    return c;
  }
}

function nowSec(): number {
  return (typeof performance !== "undefined" ? performance.now() : Date.now()) / 1000;
}
