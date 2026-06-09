import type { FrameContext, InputSnapshot, PropertyValue } from "../core/types";
import { Evaluator } from "../properties/expression";
import { BLEND_TO_COMPOSITE, Layer } from "../scene/Layer";
import type { Composition } from "../scene/Composition";
import type { Registry } from "../plugins/Registry";
import type { CanvasSource, LayerRenderer, RenderFrame, RenderHost } from "./types";

function num(v: PropertyValue, fallback = 0): number {
  return typeof v === "number" ? v : Array.isArray(v) ? (v[0] as number) : fallback;
}
function vec(v: PropertyValue, fx = 0, fy = 0): [number, number] {
  if (Array.isArray(v)) return [v[0] ?? fx, v[1] ?? fy];
  if (typeof v === "number") return [v, v];
  return [fx, fy];
}

interface EvaluatedTransform {
  position: [number, number];
  anchor: [number, number];
  scale: [number, number];
  rotation: number;
  opacity: number;
}

/**
 * The Compositor owns the output canvas and is the only place layers are drawn. It
 * evaluates each layer's transform against the composition clock, walks the parent
 * chain to build a world matrix, asks the layer's renderer for a surface, and blits
 * it with the right opacity & blend mode. Layer renderers know nothing about
 * transforms — that separation is what keeps new visual systems trivial to add.
 */
export class Compositor {
  readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private renderers = new Map<string, { renderer: LayerRenderer; type: string }>();

  constructor(
    private registry: Registry,
    private host: RenderHost,
  ) {
    this.canvas = document.createElement("canvas");
    this.canvas.width = 1920;
    this.canvas.height = 1080;
    const ctx = this.canvas.getContext("2d", { alpha: true });
    if (!ctx) throw new Error("2D canvas context unavailable");
    this.ctx = ctx;
  }

  resize(width: number, height: number): void {
    if (this.canvas.width === width && this.canvas.height === height) return;
    this.canvas.width = width;
    this.canvas.height = height;
    for (const { renderer } of this.renderers.values()) renderer.resize?.(width, height);
  }

  private rendererFor(layer: Layer): LayerRenderer | null {
    const existing = this.renderers.get(layer.id);
    if (existing && existing.type === layer.type) return existing.renderer;
    if (existing) existing.renderer.dispose(); // type changed → rebuild
    const def = this.registry.get(layer.type);
    if (!def) return null;
    const renderer = def.createRenderer(layer, this.host);
    renderer.resize?.(this.canvas.width, this.canvas.height);
    this.renderers.set(layer.id, { renderer, type: layer.type });
    return renderer;
  }

  /** Dispose renderers whose layers no longer exist in the composition. */
  syncRenderers(comp: Composition): void {
    const live = new Set(comp.layers.map((l) => l.id));
    for (const [id, entry] of [...this.renderers]) {
      if (!live.has(id)) {
        entry.renderer.dispose();
        this.renderers.delete(id);
      }
    }
  }

  private evalTransform(layer: Layer, ev: Evaluator): EvaluatedTransform {
    const get = (key: string, fx = 0, fy = 0) => {
      const p = layer.transform(key as any);
      return ev.evaluate(p, layer) ?? [fx, fy];
    };
    return {
      anchor: vec(get("anchor")),
      position: vec(get("position")),
      scale: vec(get("scale", 100, 100), 100, 100),
      rotation: num(get("rotation")),
      opacity: num(get("opacity"), 100),
    };
  }

  private localMatrix(t: EvaluatedTransform): DOMMatrix {
    const m = new DOMMatrix();
    m.translateSelf(t.position[0], t.position[1]);
    m.rotateSelf(t.rotation);
    m.scaleSelf(t.scale[0] / 100, t.scale[1] / 100);
    m.translateSelf(-t.anchor[0], -t.anchor[1]);
    return m;
  }

  private worldMatrix(comp: Composition, layer: Layer, ev: Evaluator): DOMMatrix {
    const chain = [layer, ...comp.ancestry(layer)]; // self, parent, grandparent…
    let m = new DOMMatrix();
    for (let i = chain.length - 1; i >= 0; i--) {
      m = m.multiply(this.localMatrix(this.evalTransform(chain[i], ev)));
    }
    return m;
  }

  /**
   * Render one frame of `comp` to the output canvas. `frame` carries the composition
   * clock; `input` the live runtime inputs; `globals` the project variables. Pure
   * w.r.t. wall time — call it from a Ticker for preview or in a tight loop for
   * export and you get identical output for identical `frame.time`.
   */
  render(
    comp: Composition,
    frame: FrameContext,
    input: InputSnapshot,
    globals: Record<string, unknown>,
  ): void {
    this.resize(comp.width, comp.height);
    this.syncRenderers(comp);
    const ctx = this.ctx;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
    if (comp.background) {
      const [r, g, b, a] = comp.background;
      ctx.fillStyle = `rgba(${r},${g},${b},${a / 255})`;
      ctx.fillRect(0, 0, comp.width, comp.height);
    } else {
      ctx.clearRect(0, 0, comp.width, comp.height);
    }

    const ev = new Evaluator(comp, frame, input, globals);
    const hasSolo = comp.layers.some((l) => l.solo && l.enabled);

    // Bottom (last index) to top (index 0).
    for (let i = comp.layers.length - 1; i >= 0; i--) {
      const layer = comp.layers[i];
      if (!layer.isVisibleAt(frame.time)) continue;
      if (hasSolo && !layer.solo) continue;

      const renderer = this.rendererFor(layer);
      if (!renderer) continue;

      const props: Record<string, PropertyValue> = {};
      for (const p of layer.allProperties()) props[p.key] = ev.evaluate(p, layer);

      const rf: RenderFrame = { ...frame, props, evaluator: ev, input, layer };
      let source: CanvasSource | null = null;
      try {
        source = renderer.render(rf);
      } catch (err) {
        console.error(`[compositor] renderer for "${layer.name}" threw`, err);
      }
      if (!source) continue;

      const t = this.evalTransform(layer, ev);
      const m = this.worldMatrix(comp, layer, ev);
      ctx.save();
      ctx.setTransform(m.a, m.b, m.c, m.d, m.e, m.f);
      ctx.globalAlpha = Math.max(0, Math.min(1, t.opacity / 100));
      ctx.globalCompositeOperation = BLEND_TO_COMPOSITE[layer.blendMode];
      try {
        ctx.drawImage(source as CanvasImageSource, 0, 0);
      } catch {
        /* source not yet ready (e.g. async image) — skip this frame */
      }
      ctx.restore();
    }
  }

  dispose(): void {
    for (const { renderer } of this.renderers.values()) renderer.dispose();
    this.renderers.clear();
  }
}
