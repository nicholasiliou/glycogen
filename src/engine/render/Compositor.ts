import type { FrameContext, InputSnapshot, PropertyValue } from "../core/types";
import { Evaluator } from "../properties/expression";
import { BLEND_TO_COMPOSITE, Layer } from "../scene/Layer";
import type { Composition } from "../scene/Composition";
import type { Registry } from "../plugins/Registry";
import type { BelowSource, CanvasSource, LayerRenderer, RenderFrame, RenderHost } from "./types";

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

interface Buffer {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
}

/**
 * The Compositor owns the output canvas. It composites layers recursively:
 *  - "content" layers draw their surface with their world transform/opacity/blend.
 *  - "group" layers composite their children into an isolated buffer first, then draw
 *    that buffer — so blend modes & effects between children stay scoped to the group.
 *  - "effect" layers post-process the backdrop (everything below them in their
 *    container), e.g. a fisheye or ASCII shader distorting the layers beneath.
 *
 * It stays pure w.r.t. wall time: identical `frame.time` → identical output, which is
 * what makes scrubbing and export work.
 */
export class Compositor {
  readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private renderers = new Map<string, { renderer: LayerRenderer; type: string }>();
  private groupBuffers: Buffer[] = [];
  private backdropBuffers: Buffer[] = [];

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
    for (const b of [...this.groupBuffers, ...this.backdropBuffers]) {
      b.canvas.width = width;
      b.canvas.height = height;
    }
  }

  private buffer(pool: Buffer[], index: number): Buffer {
    let b = pool[index];
    if (!b) {
      const canvas = document.createElement("canvas");
      canvas.width = this.canvas.width;
      canvas.height = this.canvas.height;
      b = { canvas, ctx: canvas.getContext("2d")! };
      pool[index] = b;
    }
    if (b.canvas.width !== this.canvas.width || b.canvas.height !== this.canvas.height) {
      b.canvas.width = this.canvas.width;
      b.canvas.height = this.canvas.height;
    }
    return b;
  }

  private kindOf(layer: Layer): "content" | "effect" | "group" | "layout" {
    return this.registry.get(layer.type)?.kind ?? "content";
  }

  private isContainer(layer: Layer): boolean {
    const k = this.kindOf(layer);
    return k === "group" || k === "layout";
  }

  private rendererFor(layer: Layer): LayerRenderer | null {
    const existing = this.renderers.get(layer.id);
    if (existing && existing.type === layer.type) return existing.renderer;
    if (existing) existing.renderer.dispose();
    const def = this.registry.get(layer.type);
    if (!def) return null;
    const renderer = def.createRenderer(layer, this.host);
    renderer.resize?.(this.canvas.width, this.canvas.height);
    this.renderers.set(layer.id, { renderer, type: layer.type });
    return renderer;
  }

  syncRenderers(comp: Composition): void {
    const live = new Set(comp.layers.map((l) => l.id));
    for (const [id, entry] of [...this.renderers]) {
      if (!live.has(id)) {
        entry.renderer.dispose();
        this.renderers.delete(id);
      }
    }
  }

  /** The nearest ancestor of `layer` that is a container (group/layout), or null (top). */
  private nearestGroupId(comp: Composition, layer: Layer): string | null {
    const seen = new Set<string>([layer.id]);
    let cur = layer.parentId ? comp.find(layer.parentId) : undefined;
    while (cur && !seen.has(cur.id)) {
      if (this.isContainer(cur)) return cur.id;
      seen.add(cur.id);
      cur = cur.parentId ? comp.find(cur.parentId) : undefined;
    }
    return null;
  }

  private evalTransform(layer: Layer, ev: Evaluator): EvaluatedTransform {
    const get = (key: string) => ev.evaluate(layer.transform(key as never), layer);
    return {
      anchor: vec(get("anchor")),
      position: vec(get("position")),
      scale: vec(get("scale"), 100, 100),
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

  /** World matrix composing locals from `layer` up to (but excluding) `stopId`. */
  private worldMatrixWithin(comp: Composition, layer: Layer, stopId: string | null, ev: Evaluator): DOMMatrix {
    const chain: Layer[] = [];
    const seen = new Set<string>();
    let cur: Layer | undefined = layer;
    while (cur && cur.id !== stopId && !seen.has(cur.id)) {
      chain.push(cur);
      seen.add(cur.id);
      cur = cur.parentId ? comp.find(cur.parentId) : undefined;
    }
    let m = new DOMMatrix();
    for (let i = chain.length - 1; i >= 0; i--) m = m.multiply(this.localMatrix(this.evalTransform(chain[i], ev)));
    return m;
  }

  render(comp: Composition, frame: FrameContext, input: InputSnapshot, globals: Record<string, unknown>): void {
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

    // Solo: any soloed layer hides non-soloed siblings, but groups containing a soloed
    // layer still render.
    const hasSolo = comp.layers.some((l) => l.solo && l.enabled);
    const soloContainers = new Set<string>();
    if (hasSolo) {
      for (const l of comp.layers) {
        if (!l.solo) continue;
        let g = this.nearestGroupId(comp, l);
        while (g) {
          soloContainers.add(g);
          const gl = comp.find(g);
          g = gl ? this.nearestGroupId(comp, gl) : null;
        }
      }
    }

    this.renderContainer(comp, null, ctx, frame, ev, input, hasSolo, soloContainers, 0);
  }

  private renderContainer(
    comp: Composition,
    containerId: string | null,
    ctx: CanvasRenderingContext2D,
    frame: FrameContext,
    ev: Evaluator,
    input: InputSnapshot,
    hasSolo: boolean,
    soloContainers: Set<string>,
    depth: number,
    layout?: { fn: NonNullable<ReturnType<Registry["get"]>>["layout"]; props: Record<string, PropertyValue> },
  ): void {
    // Members of this container, in stack order (index 0 = top). Draw bottom→top.
    const members = comp.layers.filter((l) => this.nearestGroupId(comp, l) === containerId);
    const count = members.length;

    // In a layout, position each member on a slot (fill in add order: bottom = slot 0).
    const drawMatrix = (member: Layer, k: number): DOMMatrix => {
      if (layout?.fn) return this.layoutMatrix(member, layout.fn(count - 1 - k, count, layout.props), ev);
      return this.worldMatrixWithin(comp, member, containerId, ev);
    };

    for (let k = members.length - 1; k >= 0; k--) {
      const layer = members[k];
      if (!layer.isVisibleAt(frame.time)) continue;
      const kind = this.kindOf(layer);

      if (hasSolo) {
        const allowed = layer.solo || (this.isContainer(layer) && soloContainers.has(layer.id));
        if (!allowed) continue;
      }

      const t = this.evalTransform(layer, ev);
      const alpha = Math.max(0, Math.min(1, t.opacity / 100));
      const blend = BLEND_TO_COMPOSITE[layer.blendMode];

      if (kind === "group" || kind === "layout") {
        if (depth > 8) continue; // guard against runaway nesting
        const buf = this.buffer(this.groupBuffers, depth);
        buf.ctx.setTransform(1, 0, 0, 1, 0, 0);
        buf.ctx.globalAlpha = 1;
        buf.ctx.globalCompositeOperation = "source-over";
        buf.ctx.clearRect(0, 0, buf.canvas.width, buf.canvas.height);
        const childLayout =
          kind === "layout" ? { fn: this.registry.get(layer.type)?.layout, props: this.evalProps(layer, ev) } : undefined;
        this.renderContainer(comp, layer.id, buf.ctx, frame, ev, input, hasSolo, soloContainers, depth + 1, childLayout);
        const m = drawMatrix(layer, k);
        ctx.save();
        ctx.setTransform(m.a, m.b, m.c, m.d, m.e, m.f);
        ctx.globalAlpha = alpha;
        ctx.globalCompositeOperation = blend;
        try { ctx.drawImage(buf.canvas, 0, 0); } catch { /* skip */ }
        ctx.restore();
        continue;
      }

      const renderer = this.rendererFor(layer);
      if (!renderer) continue;
      const props = this.evalProps(layer, ev);

      if (kind === "effect") {
        const bd = this.buffer(this.backdropBuffers, depth);
        bd.ctx.setTransform(1, 0, 0, 1, 0, 0);
        bd.ctx.globalAlpha = 1;
        bd.ctx.globalCompositeOperation = "source-over";
        bd.ctx.clearRect(0, 0, bd.canvas.width, bd.canvas.height);
        try { bd.ctx.drawImage(ctx.canvas, 0, 0); } catch { /* ignore */ }
        const rf: RenderFrame = { ...frame, props, evaluator: ev, input, layer, backdrop: bd.canvas };
        let out: CanvasSource | null = null;
        try { out = renderer.render(rf); } catch (err) { console.error(`[compositor] effect "${layer.name}"`, err); }
        if (out) {
          ctx.save();
          ctx.setTransform(1, 0, 0, 1, 0, 0);
          ctx.globalAlpha = alpha;
          ctx.globalCompositeOperation = blend;
          try { ctx.drawImage(out as CanvasImageSource, 0, 0); } catch { /* skip */ }
          ctx.restore();
        }
        continue;
      }

      // content — also receives the "source" of the layer directly below it
      const below = this.belowSource(comp, members[k + 1], ev, frame.time);
      const rf: RenderFrame = { ...frame, props, evaluator: ev, input, layer, below };
      let source: CanvasSource | null = null;
      try { source = renderer.render(rf); } catch (err) { console.error(`[compositor] "${layer.name}"`, err); }
      if (!source) continue;
      const m = drawMatrix(layer, k);
      ctx.save();
      ctx.setTransform(m.a, m.b, m.c, m.d, m.e, m.f);
      ctx.globalAlpha = alpha;
      ctx.globalCompositeOperation = blend;
      const canvas = source as HTMLCanvasElement;
      const offsetX = layer.type === "plant" ? -canvas.width/4: 0;
      const offsetY = layer.type === "plant" ? -canvas.height /4: 0;
      try { ctx.drawImage(canvas, offsetX, offsetY); } catch { /* skip */ }
      ctx.restore();
    }
  }

  private evalProps(layer: Layer, ev: Evaluator): Record<string, PropertyValue> {
    const props: Record<string, PropertyValue> = {};
    for (const p of layer.allProperties()) props[p.key] = ev.evaluate(p, layer);
    return props;
  }

  /** Place a child on a layout slot (centred in the buffer), keeping the child's own
   * rotation/scale/anchor but NOT its position — the layout owns position. */
  private layoutMatrix(member: Layer, slot: { x: number; y: number; rotation?: number; scale?: number }, ev: Evaluator): DOMMatrix {
    const t = this.evalTransform(member, ev);
    const s = slot.scale ?? 1;
    const m = new DOMMatrix();
    m.translateSelf(this.canvas.width / 2 + slot.x, this.canvas.height / 2 + slot.y);
    m.rotateSelf((slot.rotation ?? 0) + t.rotation);
    m.scaleSelf((s * t.scale[0]) / 100, (s * t.scale[1]) / 100);
    m.translateSelf(-t.anchor[0], -t.anchor[1]);
    return m;
  }

  /** Build the source output (field/mesh) of the layer directly beneath a consumer. */
  private belowSource(comp: Composition, belowLayer: Layer | undefined, ev: Evaluator, time: number): BelowSource | null {
    if (!belowLayer) return null;
    const r = this.rendererFor(belowLayer);
    if (!r || (!r.fieldSource && !r.meshSource)) return null;
    const props = this.evalProps(belowLayer, ev);
    return {
      layerType: belowLayer.type,
      field: r.fieldSource?.(props),
      mesh: r.meshSource ? () => r.meshSource!(props, time) : undefined,
      key: r.sourceKey?.(props, time) ?? belowLayer.id,
    };
  }

  dispose(): void {
    for (const { renderer } of this.renderers.values()) renderer.dispose();
    this.renderers.clear();
  }
}
