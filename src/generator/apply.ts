import { Layer, Property, type Engine, type Composition, type RGBA } from "@/engine";
import type { SceneLayerSpec, SceneSpec } from "./plan";

/** Build a real Layer from a SceneLayerSpec, using the registered type's schema. */
export function buildLayerFromSpec(engine: Engine, comp: Composition, spec: SceneLayerSpec): Layer {
  if (!engine.registry.has(spec.type)) {
    throw new Error(`[generator] unknown layer type "${spec.type}"`);
  }
  const def = engine.registry.get(spec.type);
  const size = def?.defaultSize?.(comp) ?? [comp.width, comp.height];
  const props = (def?.schema ?? []).map((s) => {
    const value = spec.props?.[s.key] ?? s.default;
    const prop = new Property({
      key: s.key,
      name: s.name,
      type: s.type,
      value,
      meta: s.meta,
      group: s.group,
      animatable: s.animatable,
    });
    const expr = spec.expressions?.[s.key];
    if (expr) prop.expression = expr;
    return prop;
  });
  const layer = new Layer({
    type: spec.type,
    name: comp.uniqueLayerName(spec.name),
    size: size as [number, number],
    props,
    data: def?.defaultData?.() ?? {},
    transform: {
      anchor: spec.transform?.anchor ?? [size[0] / 2, size[1] / 2],
      position: spec.transform?.position ?? [comp.width / 2, comp.height / 2],
      ...(spec.transform ?? {}),
    },
  });
  // Apply expressions to transform properties too (e.g. rotation wiggle).
  if (spec.expressions) {
    for (const [key, expr] of Object.entries(spec.expressions)) {
      const tp = layer.transformProps.find((p) => p.key === key);
      if (tp) tp.expression = expr;
    }
  }
  return layer;
}

/** Replace the active composition's layers + background with the scene, atomically. */
export function applyScene(engine: Engine, spec: SceneSpec): void {
  const comp = engine.comp;
  const prevLayers = [...comp.layers];
  const prevBg = comp.background;
  const next = spec.layers.map((s) => buildLayerFromSpec(engine, comp, s));
  engine.history.execute({
    label: "Generate",
    do: () => {
      comp.layers = next;
      comp.background = spec.background as RGBA;
    },
    undo: () => {
      comp.layers = prevLayers;
      comp.background = prevBg;
    },
  });
  engine.clearSelection();
}

/** Stable djb2 hash of the composition's serialized layers + background. */
export function sceneHash(comp: Composition): string {
  const json = JSON.stringify({
    background: comp.background,
    layers: comp.layers.map((l) => l.toJSON()),
  });
  let h = 5381;
  for (let i = 0; i < json.length; i++) h = ((h << 5) + h + json.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}
