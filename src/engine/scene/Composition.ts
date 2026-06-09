import { uid } from "../core/ids";
import type { RGBA } from "../core/types";
import { Layer } from "./Layer";

export interface GuideSettings {
  showSafeAreas: boolean;
  showGrid: boolean;
  showRulers: boolean;
  /** Title-safe / action-safe insets as a fraction of each edge. */
  titleSafe: number;
  actionSafe: number;
}

export interface CompositionInit {
  id?: string;
  name: string;
  width: number;
  height: number;
  fps?: number;
  duration?: number;
  background?: RGBA | null;
  guides?: Partial<GuideSettings>;
}

const DEFAULT_GUIDES: GuideSettings = {
  showSafeAreas: false,
  showGrid: false,
  showRulers: false,
  titleSafe: 0.1,
  actionSafe: 0.05,
};

/**
 * A composition: a canvas of fixed pixel dimensions, a frame rate, a duration and
 * an ordered stack of layers. Index 0 is the TOP layer (renders last / on top),
 * mirroring After Effects. Compositions can be nested — a layer of type
 * "precomp" references another composition by id (the engine resolves it).
 */
export class Composition {
  readonly id: string;
  name: string;
  width: number;
  height: number;
  fps: number;
  duration: number;
  background: RGBA | null;
  guides: GuideSettings;
  layers: Layer[] = [];

  constructor(init: CompositionInit) {
    this.id = init.id ?? uid("comp");
    this.name = init.name;
    this.width = init.width;
    this.height = init.height;
    this.fps = init.fps ?? 30;
    this.duration = init.duration ?? 10;
    this.background = init.background ?? [10, 10, 10, 255];
    this.guides = { ...DEFAULT_GUIDES, ...init.guides };
  }

  get center(): [number, number] {
    return [this.width / 2, this.height / 2];
  }

  addLayer(layer: Layer, index = 0): Layer {
    this.layers.splice(index, 0, layer);
    return layer;
  }

  removeLayer(id: string): Layer | undefined {
    const i = this.layers.findIndex((l) => l.id === id);
    if (i < 0) return undefined;
    const [removed] = this.layers.splice(i, 1);
    // Orphan any children rather than deleting them.
    for (const l of this.layers) if (l.parentId === id) l.parentId = null;
    return removed;
  }

  indexOf(id: string): number {
    return this.layers.findIndex((l) => l.id === id);
  }

  moveLayer(id: string, toIndex: number): void {
    const from = this.indexOf(id);
    if (from < 0) return;
    const [layer] = this.layers.splice(from, 1);
    this.layers.splice(Math.max(0, Math.min(toIndex, this.layers.length)), 0, layer);
  }

  find(id: string): Layer | undefined {
    return this.layers.find((l) => l.id === id);
  }

  byName(name: string): Layer | undefined {
    return this.layers.find((l) => l.name === name);
  }

  children(parentId: string): Layer[] {
    return this.layers.filter((l) => l.parentId === parentId);
  }

  /** Walk the parent chain (excludes self), nearest parent first. */
  ancestry(layer: Layer): Layer[] {
    const chain: Layer[] = [];
    let current = layer.parentId ? this.find(layer.parentId) : undefined;
    const seen = new Set<string>([layer.id]);
    while (current && !seen.has(current.id)) {
      chain.push(current);
      seen.add(current.id);
      current = current.parentId ? this.find(current.parentId) : undefined;
    }
    return chain;
  }

  uniqueLayerName(base: string): string {
    if (!this.byName(base)) return base;
    let i = 2;
    while (this.byName(`${base} ${i}`)) i++;
    return `${base} ${i}`;
  }

  toJSON(): unknown {
    return {
      id: this.id,
      name: this.name,
      width: this.width,
      height: this.height,
      fps: this.fps,
      duration: this.duration,
      background: this.background,
      guides: this.guides,
      layers: this.layers.map((l) => l.toJSON()),
    };
  }

  static fromJSON(raw: any): Composition {
    const comp = new Composition({
      id: raw.id,
      name: raw.name,
      width: raw.width,
      height: raw.height,
      fps: raw.fps,
      duration: raw.duration,
      background: raw.background,
      guides: raw.guides,
    });
    comp.layers = (raw.layers ?? []).map((l: any) => Layer.fromJSON(l));
    return comp;
  }
}
