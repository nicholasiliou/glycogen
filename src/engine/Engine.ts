import { Emitter } from "./core/EventBus";
import type { FrameContext } from "./core/types";
import { Transport } from "./time/Transport";
import { Ticker } from "./time/Ticker";
import { InputManager } from "./inputs/InputManager";
import { History, type Command } from "./commands/History";
import { Registry } from "./plugins/Registry";
import { Compositor } from "./render/Compositor";
import type { RenderHost } from "./render/types";
import { Property } from "./properties/Property";
import type { Interpolation } from "./properties/interpolation";
import { bindingExpression } from "./properties/expression";
import { Layer, type BlendMode, type LayerInit } from "./scene/Layer";
import { Composition } from "./scene/Composition";
import { Project } from "./scene/Project";
import type { PropertyValue } from "./core/types";

export type EngineEvents = {
  "project:loaded": { project: Project };
  /** Structure or property data changed (NOT fired for routine time ticks). */
  "project:changed": void;
  "composition:changed": { id: string };
  "selection:changed": { ids: string[] };
  /** High-frequency clock updates — subscribe via onTime, not the structural bus. */
  "time:changed": { time: number; frame: number; playing: boolean };
  "transport:changed": void;
  "history:changed": void;
  "render:frame": { time: number };
  "audio:changed": { enabled: boolean };
};

export interface AddLayerOptions {
  name?: string;
  index?: number;
  data?: Record<string, unknown>;
  transform?: LayerInit["transform"];
  select?: boolean;
  /** Drop the new layer inside this container (group/auto-layout). */
  parentId?: string | null;
}

/**
 * The conductor. Every subsystem (clock, inputs, compositor, history, registry)
 * is owned here, but they only ever talk to each other through this façade and the
 * event bus — never sideways. The UI consumes this exact public API; nothing in the
 * UI reaches into a subsystem directly.
 */
export class Engine {
  readonly registry: Registry;
  readonly transport = new Transport();
  readonly input = new InputManager();
  readonly bus = new Emitter<EngineEvents>();
  readonly history: History;

  project: Project;
  selection: string[] = [];

  private compositor?: Compositor;
  private ticker?: Ticker;
  private host?: RenderHost;
  private lastWall = 0;
  private frameDelta = 0;

  constructor(opts?: { registry?: Registry }) {
    this.registry = opts?.registry ?? new Registry();
    this.history = new History(() => {
      this.bus.emit("project:changed", undefined);
      this.bus.emit("history:changed", undefined);
      this.renderNow();
    });
    this.project = new Project({
      name: "Untitled",
      compositions: [new Composition({ name: "Composition 1", width: 1920, height: 1080 })],
    });
    this.syncTransport();
  }

  // ───────────────────────── lifecycle ─────────────────────────

  mount(host: RenderHost): HTMLCanvasElement {
    this.host = host;
    this.compositor = new Compositor(this.registry, host);
    this.compositor.resize(this.comp.width, this.comp.height);
    this.ticker = new Ticker((now) => this.tick(now));
    this.ticker.start();
    return this.compositor.canvas;
  }

  unmount(): void {
    this.ticker?.stop();
    this.compositor?.dispose();
    this.input.dispose();
  }

  get canvas(): HTMLCanvasElement | undefined {
    return this.compositor?.canvas;
  }

  // ───────────────────────── composition access ─────────────────────────

  get comp(): Composition {
    return this.project.activeComposition();
  }

  private syncTransport(): void {
    const c = this.comp;
    this.transport.configure({ duration: c.duration, fps: c.fps, workIn: c.workArea.in, workOut: c.workArea.out });
    this.input.setCompSize(c.width, c.height);
  }

  /** Set the work area (loop region + default export range), in seconds. */
  setWorkArea(inT: number, outT: number): void {
    const comp = this.comp;
    const prev = { ...comp.workArea };
    const din = Math.max(0, Math.min(inT, comp.duration - 1 / comp.fps));
    const dout = Math.max(din + 1 / comp.fps, Math.min(outT, comp.duration));
    this.history.execute({
      label: "Work area",
      coalesceKey: `workarea:${comp.id}`,
      do: () => {
        comp.workArea = { in: din, out: dout };
        this.syncTransport();
      },
      undo: () => {
        comp.workArea = { ...prev };
        this.syncTransport();
      },
    });
    this.bus.emit("composition:changed", { id: comp.id });
  }

  setActiveComposition(id: string): void {
    if (!this.project.findComposition(id)) return;
    this.project.activeCompositionId = id;
    this.transport.seek(0);
    this.syncTransport();
    this.compositor?.resize(this.comp.width, this.comp.height);
    this.clearSelection();
    this.bus.emit("composition:changed", { id });
    this.bus.emit("project:changed", undefined);
    this.renderNow();
  }

  addComposition(init: ConstructorParameters<typeof Composition>[0]): Composition {
    const comp = new Composition(init);
    this.history.execute({
      label: `New composition "${comp.name}"`,
      do: () => this.project.addComposition(comp),
      undo: () => {
        this.project.compositions = this.project.compositions.filter((c) => c.id !== comp.id);
      },
    });
    this.setActiveComposition(comp.id);
    return comp;
  }

  setCompositionSettings(
    patch: Partial<Pick<Composition, "name" | "width" | "height" | "fps" | "duration" | "background">>,
  ): void {
    const comp = this.comp;
    const before = { name: comp.name, width: comp.width, height: comp.height, fps: comp.fps, duration: comp.duration, background: comp.background };
    const after = { ...before, ...patch };
    if (patch.duration !== undefined) after.duration = Math.max(0.1, patch.duration);
    const prevWorkArea = { ...comp.workArea };
    // The work area is also the export range. When the out handle sits at the end of the
    // timeline, let it follow the duration as it grows/shrinks (so a freshly-extended
    // timeline is immediately usable & exportable); otherwise just keep it within bounds.
    const pinnedToEnd = prevWorkArea.out >= before.duration - 1e-6;
    this.history.execute({
      label: "Composition settings",
      coalesceKey: `compsettings:${comp.id}`,
      do: () => {
        Object.assign(comp, after);
        comp.workArea = {
          in: Math.min(prevWorkArea.in, after.duration),
          out: pinnedToEnd ? after.duration : Math.min(prevWorkArea.out, after.duration),
        };
        this.syncTransport();
        this.compositor?.resize(comp.width, comp.height);
      },
      undo: () => {
        Object.assign(comp, before);
        comp.workArea = { ...prevWorkArea };
        this.syncTransport();
        this.compositor?.resize(comp.width, comp.height);
      },
    });
    this.bus.emit("composition:changed", { id: comp.id });
  }

  // ───────────────────────── selection ─────────────────────────

  select(ids: string[], additive = false): void {
    const next = additive ? [...new Set([...this.selection, ...ids])] : [...ids];
    this.selection = next;
    this.bus.emit("selection:changed", { ids: next });
  }

  toggleSelect(id: string): void {
    this.selection.includes(id)
      ? this.select(this.selection.filter((x) => x !== id))
      : this.select([id], true);
  }

  clearSelection(): void {
    if (this.selection.length) this.select([]);
  }

  get selectedLayers(): Layer[] {
    return this.selection.map((id) => this.comp.find(id)).filter((l): l is Layer => !!l);
  }

  getLayer(id: string): Layer | undefined {
    return this.comp.find(id);
  }

  // ───────────────────────── layer construction ─────────────────────────

  /** Build a fresh layer instance from a registered type's schema. */
  private buildLayer(type: string, opts?: AddLayerOptions): Layer {
    const def = this.registry.get(type);
    const comp = this.comp;
    const size = def?.defaultSize?.(comp) ?? [comp.width, comp.height];
    const props = (def?.schema ?? []).map(
      (s) =>
        new Property({
          key: s.key,
          name: s.name,
          type: s.type,
          value: s.default,
          meta: s.meta,
          group: s.group,
          animatable: s.animatable,
        }),
    );
    const name = comp.uniqueLayerName(opts?.name ?? def?.label ?? type);
    return new Layer({
      type,
      name,
      size,
      props,
      data: { ...(def?.defaultData?.() ?? {}), ...(opts?.data ?? {}) },
      transform: {
        anchor: [0, 0],
        position: [0, 0],
        ...opts?.transform,
      },
    });
  }

  addLayer(type: string, opts?: AddLayerOptions): Layer | null {
    if (!this.registry.has(type)) {
      console.warn(`[engine] unknown layer type "${type}"`);
      return null;
    }
    const layer = this.buildLayer(type, opts);
    const comp = this.comp;
    // When dropping into a container, default to the slot just under it (= first child)
    // so the new layer lands inside; otherwise default to the top of the stack.
    const parent = opts?.parentId ? comp.find(opts.parentId) : undefined;
    if (parent) layer.parentId = parent.id;
    const index = opts?.index ?? (parent ? comp.indexOf(parent.id) + 1 : 0);
    this.history.execute({
      label: `Add ${layer.name}`,
      do: () => comp.addLayer(layer, index),
      undo: () => comp.removeLayer(layer.id),
    });
    if (opts?.select !== false) this.select([layer.id]);
    return layer;
  }

  removeLayers(ids: string[]): void {
    const comp = this.comp;
    const removed = ids
      .map((id) => ({ layer: comp.find(id), index: comp.indexOf(id) }))
      .filter((x): x is { layer: Layer; index: number } => !!x.layer)
      .sort((a, b) => a.index - b.index);
    if (!removed.length) return;
    this.history.execute({
      label: removed.length > 1 ? `Delete ${removed.length} layers` : `Delete ${removed[0].layer.name}`,
      do: () => removed.forEach(({ layer }) => comp.removeLayer(layer.id)),
      undo: () => removed.forEach(({ layer, index }) => comp.addLayer(layer, index)),
    });
    this.select(this.selection.filter((id) => !ids.includes(id)));
  }

  duplicateLayers(ids: string[]): void {
    const comp = this.comp;
    const clones: { layer: Layer; index: number }[] = [];
    for (const id of ids) {
      const src = comp.find(id);
      if (!src) continue;
      const raw = src.toJSON() as any;
      raw.id = undefined;
      raw.props?.forEach((p: any) => (p.id = undefined));
      raw.transform?.forEach((p: any) => (p.id = undefined));
      const clone = Layer.fromJSON(raw);
      clone.name = comp.uniqueLayerName(src.name);
      clones.push({ layer: clone, index: comp.indexOf(id) });
    }
    if (!clones.length) return;
    this.history.execute({
      label: "Duplicate layer(s)",
      do: () => clones.forEach(({ layer, index }) => comp.addLayer(layer, index)),
      undo: () => clones.forEach(({ layer }) => comp.removeLayer(layer.id)),
    });
    this.select(clones.map((c) => c.layer.id));
  }

  reorderLayer(id: string, toIndex: number): void {
    const comp = this.comp;
    const from = comp.indexOf(id);
    if (from < 0 || from === toIndex) return;
    this.history.execute({
      label: "Reorder layer",
      do: () => comp.moveLayer(id, toIndex),
      undo: () => comp.moveLayer(id, from),
    });
  }

  reparent(childIds: string[], parentId: string | null): void {
    const comp = this.comp;
    const changes = childIds
      .map((id) => comp.find(id))
      .filter((l): l is Layer => !!l && l.id !== parentId)
      .map((l) => ({ layer: l, prev: l.parentId }));
    if (!changes.length) return;
    this.history.execute({
      label: parentId ? "Parent layers" : "Unparent layers",
      do: () => changes.forEach(({ layer }) => (layer.parentId = parentId)),
      undo: () => changes.forEach(({ layer, prev }) => (layer.parentId = prev)),
    });
  }

  /**
   * Drag-drop move: place `dragId` under `parentId` (or top level when null) at flat
   * stack `toIndex`, as a SINGLE undo step. This is what makes containers usable — a
   * plain reorder never changes parentage, so a layer dropped on an auto-layout would
   * never actually go inside it. Refuses cycles (parenting into self or a descendant).
   */
  moveLayerTo(dragId: string, parentId: string | null, toIndex: number): void {
    const comp = this.comp;
    const layer = comp.find(dragId);
    if (!layer) return;
    const parent = parentId ? comp.find(parentId) : null;
    if (parentId && (!parent || parentId === dragId || comp.ancestry(parent).some((a) => a.id === dragId))) return;
    const fromIndex = comp.indexOf(dragId);
    const prevParent = layer.parentId;
    const target = Math.max(0, Math.min(toIndex, comp.layers.length - 1));
    if (fromIndex === target && (prevParent ?? null) === (parentId ?? null)) return;
    this.history.execute({
      label: parentId ? "Move layer into container" : "Move layer",
      do: () => {
        layer.parentId = parentId ?? null;
        comp.moveLayer(dragId, target);
      },
      undo: () => {
        layer.parentId = prevParent;
        comp.moveLayer(dragId, fromIndex);
      },
    });
  }

  /** Wrap the selection in a new container (group or auto-layout). */
  private wrapInContainer(ids: string[], type: string, label: string, name: string): Layer | null {
    const comp = this.comp;
    if (!ids.length || !this.registry.has(type)) return null;
    const topIndex = Math.min(...ids.map((id) => comp.indexOf(id)).filter((i) => i >= 0));
    const container = this.buildLayer(type, { name });
    const targets = ids.map((id) => comp.find(id)).filter((l): l is Layer => !!l);
    const prevParents = targets.map((l) => l.parentId);
    this.history.execute({
      label,
      do: () => {
        comp.addLayer(container, topIndex);
        targets.forEach((l) => (l.parentId = container.id));
      },
      undo: () => {
        targets.forEach((l, i) => (l.parentId = prevParents[i]));
        comp.removeLayer(container.id);
      },
    });
    this.select([container.id]);
    return container;
  }

  groupLayers(ids: string[]): Layer | null {
    return this.wrapInContainer(ids, "group", "Group layers", "Group");
  }

  layoutLayers(ids: string[]): Layer | null {
    return this.wrapInContainer(ids, "layout", "Auto-layout selection", "Auto-Layout");
  }

  setLayerField<K extends "name" | "enabled" | "locked" | "solo" | "blendMode" | "inPoint" | "outPoint">(
    id: string,
    key: K,
    value: Layer[K],
  ): void {
    const layer = this.comp.find(id);
    if (!layer) return;
    const prev = layer[key];
    if (prev === value) return;
    this.history.execute({
      label: `Set ${key}`,
      coalesceKey: `field:${id}:${key}`,
      do: () => ((layer[key] as Layer[K]) = value),
      undo: () => ((layer[key] as Layer[K]) = prev),
    });
  }

  setBlendMode(id: string, mode: BlendMode): void {
    this.setLayerField(id, "blendMode", mode);
  }

  /** Replace a layer's non-animatable `data` blob (used by custom inspectors, e.g. the
   * glyph painter). Undoable; coalesce a continuous gesture with `coalesceKey`. */
  setLayerData(id: string, nextData: Record<string, unknown>, label = "Edit layer data", coalesceKey?: string): void {
    const layer = this.comp.find(id);
    if (!layer) return;
    const prev = layer.data;
    this.history.execute({
      label,
      coalesceKey,
      do: () => (layer.data = nextData),
      undo: () => (layer.data = prev),
    });
  }

  // ───────────────────────── property mutations ─────────────────────────

  private locate(layerId: string, propId: string): { layer: Layer; prop: Property } | null {
    const layer = this.comp.find(layerId);
    const prop = layer?.allProperties().find((p) => p.id === propId);
    return layer && prop ? { layer, prop } : null;
  }

  /**
   * Set a property's value. If the property is animated, this edits the keyframe at
   * the playhead (creating one if needed); otherwise it edits the static value.
   * `coalesce` collapses a continuous gesture (slider drag) into one undo step.
   */
  setPropertyValue(layerId: string, propId: string, value: PropertyValue, coalesce = false): void {
    const found = this.locate(layerId, propId);
    if (!found) return;
    const { prop } = found;
    const key = coalesce ? `setval:${propId}` : undefined;
    const time = this.transport.time;

    if (prop.isAnimated) {
      const existing = prop.keyframeAt(time);
      const prevValue = existing?.value;
      const prevInterp = existing?.interp ?? "linear";
      const existed = !!existing;
      this.history.execute({
        label: `Edit ${prop.name}`,
        coalesceKey: key,
        do: () => prop.setKeyframe(time, value, prevInterp),
        undo: () => {
          if (existed) prop.setKeyframe(time, prevValue as PropertyValue, prevInterp);
          else {
            const k = prop.keyframeAt(time);
            if (k) prop.removeKeyframe(k.id);
          }
        },
      });
    } else {
      const prev = prop.value;
      this.history.execute({
        label: `Set ${prop.name}`,
        coalesceKey: key,
        do: () => (prop.value = value),
        undo: () => (prop.value = prev),
      });
    }
  }

  /** Toggle the keyframe "stopwatch": animate on (seed a keyframe) / off (bake static). */
  toggleAnimation(layerId: string, propId: string): void {
    const found = this.locate(layerId, propId);
    if (!found) return;
    const { prop } = found;
    const time = this.transport.time;
    if (prop.isAnimated) {
      const prevKfs = prop.keyframes.map((k) => ({ ...k }));
      const baked = prop.valueAt(time);
      this.history.execute({
        label: `Disable animation: ${prop.name}`,
        do: () => {
          prop.clearKeyframes();
          prop.value = baked;
        },
        undo: () => (prop.keyframes = prevKfs.map((k) => ({ ...k }))),
      });
    } else {
      const seed = prop.value;
      this.history.execute({
        label: `Animate ${prop.name}`,
        do: () => prop.setKeyframe(time, seed, "linear"),
        undo: () => prop.clearKeyframes(),
      });
    }
  }

  addKeyframe(layerId: string, propId: string, time = this.transport.time): void {
    const found = this.locate(layerId, propId);
    if (!found) return;
    const { prop } = found;
    const value = prop.isAnimated ? prop.valueAt(time) : prop.value;
    if (prop.keyframeAt(time)) return;
    this.history.execute({
      label: `Add keyframe: ${prop.name}`,
      do: () => prop.setKeyframe(time, value, "linear"),
      undo: () => {
        const k = prop.keyframeAt(time);
        if (k) prop.removeKeyframe(k.id);
      },
    });
  }

  removeKeyframe(layerId: string, propId: string, kfId: string): void {
    const found = this.locate(layerId, propId);
    if (!found) return;
    const { prop } = found;
    const kf = prop.keyframes.find((k) => k.id === kfId);
    if (!kf) return;
    const snapshot = { ...kf };
    this.history.execute({
      label: `Delete keyframe: ${prop.name}`,
      do: () => prop.removeKeyframe(kfId),
      undo: () => {
        prop.keyframes.push({ ...snapshot });
        prop.sortKeyframes();
      },
    });
  }

  moveKeyframe(layerId: string, propId: string, kfId: string, time: number): void {
    const found = this.locate(layerId, propId);
    if (!found) return;
    const { prop } = found;
    const kf = prop.keyframes.find((k) => k.id === kfId);
    if (!kf) return;
    const prev = kf.time;
    this.history.execute({
      label: `Move keyframe`,
      coalesceKey: `movekf:${kfId}`,
      do: () => {
        kf.time = Math.max(0, time);
        prop.sortKeyframes();
      },
      undo: () => {
        kf.time = prev;
        prop.sortKeyframes();
      },
    });
  }

  setKeyframeInterpolation(layerId: string, propId: string, kfId: string, interp: Interpolation): void {
    const found = this.locate(layerId, propId);
    if (!found) return;
    const kf = found.prop.keyframes.find((k) => k.id === kfId);
    if (!kf) return;
    const prev = kf.interp;
    this.history.execute({
      label: "Set interpolation",
      do: () => (kf.interp = interp),
      undo: () => (kf.interp = prev),
    });
  }

  setExpression(layerId: string, propId: string, expression: string | null): void {
    const found = this.locate(layerId, propId);
    if (!found) return;
    const { prop } = found;
    const prev = prop.expression;
    this.history.execute({
      label: expression ? `Set expression: ${prop.name}` : `Clear expression: ${prop.name}`,
      coalesceKey: `expr:${propId}`,
      do: () => (prop.expression = expression),
      undo: () => (prop.expression = prev),
    });
  }

  /** Pickwhip: bind a property to another layer's property via a generated expression. */
  bindProperty(targetLayerId: string, targetPropId: string, sourceLayerName: string, sourceKey: string): void {
    this.setExpression(targetLayerId, targetPropId, bindingExpression(sourceLayerName, sourceKey));
  }

  setGlobal(key: string, value: unknown): void {
    const prev = this.project.globals[key];
    this.history.execute({
      label: `Set global ${key}`,
      coalesceKey: `global:${key}`,
      do: () => (this.project.globals[key] = value),
      undo: () => (this.project.globals[key] = prev),
    });
  }

  // ───────────────────────── transport ─────────────────────────

  play(): void {
    this.transport.play();
    this.bus.emit("transport:changed", undefined);
  }
  pause(): void {
    this.transport.pause();
    this.bus.emit("transport:changed", undefined);
  }
  togglePlay(): void {
    this.transport.playing ? this.pause() : this.play();
  }
  seek(time: number): void {
    this.transport.seek(time);
    this.emitTime();
    this.renderNow();
  }
  seekFrame(frame: number): void {
    this.transport.seekFrame(frame);
    this.emitTime();
    this.renderNow();
  }
  step(frames: number): void {
    this.transport.stepFrames(frames);
    this.emitTime();
    this.renderNow();
  }
  setRate(rate: number): void {
    this.transport.rate = rate;
    this.bus.emit("transport:changed", undefined);
  }
  setLoop(loop: boolean): void {
    this.transport.loop = loop;
    this.bus.emit("transport:changed", undefined);
  }

  async enableInputAudio(): Promise<void> {
    try {
      await this.input.enableAudio();
      this.bus.emit("audio:changed", { enabled: true });
    } catch (err) {
      console.warn("[engine] microphone access denied", err);
    }
  }

  // ───────────────────────── rendering ─────────────────────────

  private tick(now: number): void {
    this.frameDelta = this.lastWall ? (now - this.lastWall) / 1000 : 1 / 60;
    this.lastWall = now;
    const changed = this.transport.advance(now);
    this.input.update(now, this.transport.time);
    this.renderNow();
    if (changed || this.transport.playing) this.emitTime();
  }

  frameContext(): FrameContext {
    const c = this.comp;
    return {
      time: this.transport.time,
      frame: this.transport.frame,
      fps: c.fps,
      duration: c.duration,
      width: c.width,
      height: c.height,
      playing: this.transport.playing,
      delta: this.frameDelta,
    };
  }

  renderNow(): void {
    if (!this.compositor) return;
    const comp = this.comp;
    this.input.setCompSize(comp.width, comp.height);
    this.compositor.render(comp, this.frameContext(), this.input.snapshot(), this.project.globals);
    this.bus.emit("render:frame", { time: this.transport.time });
  }

  private emitTime(): void {
    this.bus.emit("time:changed", {
      time: this.transport.time,
      frame: this.transport.frame,
      playing: this.transport.playing,
    });
  }

  // ───────────────────────── project IO ─────────────────────────

  loadProjectInstance(project: Project): void {
    this.transport.pause();
    this.project = project;
    this.selection = [];
    this.history.clear();
    this.syncTransport();
    this.compositor?.resize(this.comp.width, this.comp.height);
    this.bus.emit("project:loaded", { project });
    this.bus.emit("project:changed", undefined);
    this.bus.emit("selection:changed", { ids: [] });
    this.renderNow();
  }

  // ───────────────────────── reactive subscriptions ─────────────────────────

  /** Structural subscription: fires on project/selection/composition/history changes. */
  subscribe(fn: () => void): () => void {
    const unsubs = [
      this.bus.on("project:changed", fn),
      this.bus.on("selection:changed", fn),
      this.bus.on("composition:changed", fn),
      this.bus.on("history:changed", fn),
      this.bus.on("project:loaded", fn),
      this.bus.on("transport:changed", fn),
      this.bus.on("audio:changed", fn),
    ];
    return () => unsubs.forEach((u) => u());
  }

  /** High-frequency clock subscription, kept separate so it never re-renders the whole UI. */
  onTime(fn: (t: { time: number; frame: number; playing: boolean }) => void): () => void {
    return this.bus.on("time:changed", fn);
  }
}
