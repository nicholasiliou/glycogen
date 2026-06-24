import type { PropType, PropertyMeta, PropertyValue } from "../core/types";
import type { Layer } from "../scene/Layer";
import type { LayerRenderer, RenderHost } from "../render/types";

/** Declarative description of one animatable property a layer type exposes. */
export interface PropertySchema {
  key: string;
  name: string;
  type: PropType;
  default: PropertyValue;
  meta?: PropertyMeta;
  group?: string;
  animatable?: boolean;
}

/**
 * The registration unit of the plugin system. A LayerTypeDefinition is the entire
 * public surface a new visual system must provide: how it appears in the UI, what
 * animatable properties it exposes, what non-animatable config it owns, and how to
 * build a renderer for an instance. Register one and a brand-new layer type appears
 * throughout the editor (add menu, inspector, timeline, serialization) with no other
 * changes. This is the third-party extension point.
 */
export interface LayerTypeDefinition {
  /** Unique stable id, e.g. "plant", "solid", "shader". */
  type: string;
  label: string;
  category?: string;
  /**
   * How the compositor treats this type:
   *  - "content" (default): draws its own surface.
   *  - "effect": post-processes the backdrop (everything composited below it within
   *    its container). Its renderer receives `frame.backdrop` and returns a full-frame result.
   *  - "group": a container; its child layers are composited into an isolated buffer
   *    first, so blend modes/effects between children stay scoped to the group.
   *  - "layout": a container that ALSO arranges its children's positions via `layout`.
   */
  kind?: "content" | "effect" | "group" | "layout";
  /**
   * For `kind: "layout"` types: given a child's index/count and the layout's evaluated
   * props, return the child's slot (centre-relative px + optional rotation/scale). The
   * compositor positions each child accordingly (ignoring the child's own position).
   */
  layout?: (
    index: number,
    count: number,
    props: Record<string, PropertyValue>,
  ) => { x: number; y: number; rotation?: number; scale?: number };
  /** lucide-react icon name. */
  icon?: string;
  description?: string;
  /** Animatable, schema-defined properties shown in the inspector & timeline. */
  schema?: PropertySchema[];
  /** Factory for the per-instance non-animatable config blob. */
  defaultData?: () => Record<string, unknown>;
  /** Intrinsic size for new instances; defaults to composition size. */
  defaultSize?: (comp: { width: number; height: number }) => [number, number];
  /** Build a renderer bound to a specific layer instance. */
  createRenderer: (layer: Layer, host: RenderHost) => LayerRenderer;
  /** Optional custom (de)serialization for the `data` blob (e.g. to drop caches). */
  serializeData?: (data: Record<string, unknown>) => unknown;
  deserializeData?: (raw: unknown) => Record<string, unknown>;
}

/**
 * Registry of layer types. Deliberately tiny and dependency-free so it can be the
 * stable contract third-party modules compile against.
 */
export class Registry {
  private defs = new Map<string, LayerTypeDefinition>();

  register(def: LayerTypeDefinition): () => void {
    if (this.defs.has(def.type)) {
      console.warn(`[registry] layer type "${def.type}" already registered — overwriting`);
    }
    this.defs.set(def.type, def);
    return () => {
      if (this.defs.get(def.type) === def) this.defs.delete(def.type);
    };
  }

  get(type: string): LayerTypeDefinition | undefined {
    return this.defs.get(type);
  }

  has(type: string): boolean {
    return this.defs.has(type);
  }

  all(): LayerTypeDefinition[] {
    return [...this.defs.values()];
  }

  categories(): Map<string, LayerTypeDefinition[]> {
    const out = new Map<string, LayerTypeDefinition[]>();
    for (const def of this.defs.values()) {
      const cat = def.category ?? "General";
      if (!out.has(cat)) out.set(cat, []);
      out.get(cat)!.push(def);
    }
    return out;
  }
}
