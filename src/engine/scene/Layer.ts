import { uid } from "../core/ids";
import { Property } from "../properties/Property";
import type { Vec2 } from "../core/types";

export type BlendMode =
  | "normal"
  | "add"
  | "multiply"
  | "screen"
  | "overlay"
  | "lighten"
  | "darken"
  | "difference";

export const BLEND_TO_COMPOSITE: Record<BlendMode, GlobalCompositeOperation> = {
  normal: "source-over",
  add: "lighter",
  multiply: "multiply",
  screen: "screen",
  overlay: "overlay",
  lighten: "lighten",
  darken: "darken",
  difference: "difference",
};

export interface TransformValues {
  anchor: Vec2;
  position: Vec2;
  scale: Vec2;
  rotation: number;
  opacity: number;
}

export interface LayerInit {
  id?: string;
  type: string;
  name: string;
  enabled?: boolean;
  locked?: boolean;
  solo?: boolean;
  /** Layer visibility window in composition seconds. */
  inPoint?: number;
  outPoint?: number;
  parentId?: string | null;
  blendMode?: BlendMode;
  /** Intrinsic content size; defaults handled by the spawning factory. */
  size?: Vec2;
  transform?: Partial<TransformValues>;
  /** Type-specific animatable properties (built from the plugin schema). */
  props?: Property[];
  /** Type-specific non-animatable config blob owned by the plugin. */
  data?: Record<string, unknown>;
}

function makeTransformProps(t?: Partial<TransformValues>): Property[] {
  return [
    new Property({ key: "anchor", name: "Anchor Point", type: "point", value: t?.anchor ?? [0, 0], group: "Transform" }),
    new Property({ key: "position", name: "Position", type: "point", value: t?.position ?? [0, 0], group: "Transform" }),
    new Property({ key: "scale", name: "Scale", type: "point", value: t?.scale ?? [100, 100], group: "Transform", meta: { unit: "%", step: 1 } }),
    new Property({ key: "rotation", name: "Rotation", type: "angle", value: t?.rotation ?? 0, group: "Transform", meta: { unit: "°", step: 1 } }),
    new Property({ key: "opacity", name: "Opacity", type: "percent", value: t?.opacity ?? 100, group: "Transform", meta: { min: 0, max: 100, unit: "%" } }),
  ];
}

/**
 * A Layer is the universal unit of composition. A plant, a solid, an image, a
 * shader and a particle system are all just Layers with a different `type` and a
 * different set of `customProps`. Everything shared — transform, opacity, blend
 * mode, in/out points, parenting — lives here so new visual systems inherit it for
 * free.
 */
export class Layer {
  readonly id: string;
  type: string;
  name: string;
  enabled: boolean;
  locked: boolean;
  solo: boolean;
  inPoint: number;
  outPoint: number;
  parentId: string | null;
  blendMode: BlendMode;
  size: Vec2;
  data: Record<string, unknown>;

  transformProps: Property[];
  customProps: Property[];

  constructor(init: LayerInit) {
    this.id = init.id ?? uid("layer");
    this.type = init.type;
    this.name = init.name;
    this.enabled = init.enabled ?? true;
    this.locked = init.locked ?? false;
    this.solo = init.solo ?? false;
    this.inPoint = init.inPoint ?? 0;
    this.outPoint = init.outPoint ?? Number.POSITIVE_INFINITY;
    this.parentId = init.parentId ?? null;
    this.blendMode = init.blendMode ?? "normal";
    this.size = init.size ?? [1920, 1080];
    this.data = init.data ?? {};
    this.transformProps = makeTransformProps(init.transform);
    this.customProps = init.props ?? [];
  }

  allProperties(): Property[] {
    return [...this.transformProps, ...this.customProps];
  }

  property(key: string): Property | undefined {
    return this.allProperties().find((p) => p.key === key);
  }

  transform(key: keyof TransformValues): Property {
    return this.transformProps.find((p) => p.key === key)!;
  }

  isVisibleAt(time: number): boolean {
    return this.enabled && time >= this.inPoint && time < this.outPoint;
  }

  /** Property groups in display order: Transform first, then plugin groups. */
  groups(): { label: string; props: Property[] }[] {
    const out: { label: string; props: Property[] }[] = [
      { label: "Transform", props: this.transformProps },
    ];
    const byGroup = new Map<string, Property[]>();
    for (const p of this.customProps) {
      const g = p.group ?? "Properties";
      if (!byGroup.has(g)) byGroup.set(g, []);
      byGroup.get(g)!.push(p);
    }
    for (const [label, props] of byGroup) out.push({ label, props });
    return out;
  }

  toJSON(): unknown {
    return {
      id: this.id,
      type: this.type,
      name: this.name,
      enabled: this.enabled,
      locked: this.locked,
      solo: this.solo,
      inPoint: this.inPoint,
      outPoint: this.outPoint === Number.POSITIVE_INFINITY ? null : this.outPoint,
      parentId: this.parentId,
      blendMode: this.blendMode,
      size: this.size,
      data: this.data,
      transform: this.transformProps.map((p) => p.toJSON()),
      props: this.customProps.map((p) => p.toJSON()),
    };
  }

  static fromJSON(raw: any): Layer {
    const layer = new Layer({
      id: raw.id,
      type: raw.type,
      name: raw.name,
      enabled: raw.enabled,
      locked: raw.locked,
      solo: raw.solo,
      inPoint: raw.inPoint,
      outPoint: raw.outPoint ?? Number.POSITIVE_INFINITY,
      parentId: raw.parentId ?? null,
      blendMode: raw.blendMode ?? "normal",
      size: raw.size,
      data: raw.data ?? {},
      props: (raw.props ?? []).map((p: any) => Property.fromJSON(p)),
    });
    if (Array.isArray(raw.transform) && raw.transform.length) {
      layer.transformProps = raw.transform.map((p: any) => Property.fromJSON(p));
    }
    return layer;
  }
}
