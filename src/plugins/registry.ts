import { ButtonParam, Param } from "@/controls/Param";
import { Plugin } from "./Plugin";

/** Generators draw fresh; effects transform the layers below. Derived from folder, never declared. */
export type PluginKind = "generator" | "effect";

export interface PluginInfo {
  id: string;
  label: string;
  kind: PluginKind;
}

type Entry = PluginInfo & { ctor: new () => Plugin };

/**
 * Auto-discovers every plugin from the filesystem. Any `*Layer.ts` under plugins/ or shaders/ that
 * exports a `Plugin` subclass is registered, and its id/label/kind come entirely from its path —
 * `plugins/ShapeLayer.ts` → `{ id: "shape", label: "Shape", kind: "generator" }`,
 * `shaders/PixelateLayer.ts` → `{ id: "pixelate", label: "Pixelate", kind: "effect" }`. No manual
 * metadata, no central list: dropping a file in is the whole registration.
 */
const modules = import.meta.glob<Record<string, unknown>>(
  ["./**/*Layer.ts", "../shaders/*Layer.ts"],
  { eager: true },
);

const registry = new Map<string, Entry>();
for (const [path, mod] of Object.entries(modules)) {
  const ctor = Object.values(mod).find(isPluginClass);
  if (!ctor) continue;
  const info = metaFromPath(path);
  if (registry.has(info.id)) console.warn(`[registry] duplicate plugin id "${info.id}" — overwriting`);
  registry.set(info.id, { ...info, ctor });
}

function isPluginClass(x: unknown): x is new () => Plugin {
  return typeof x === "function" && x.prototype instanceof Plugin;
}

/** id/label/kind from a module path — the only source of plugin metadata. */
function metaFromPath(path: string): PluginInfo {
  const file = path.split("/").pop()!.replace(/Layer\.ts$/, "").replace(/\.ts$/, "");
  return {
    id: file.charAt(0).toLowerCase() + file.slice(1),
    label: file.replace(/([a-z0-9])([A-Z])/g, "$1 $2"),
    kind: path.includes("/shaders/") ? "effect" : "generator",
  };
}

export function list(): PluginInfo[] {
  return [...registry.values()].map(({ id, label, kind }) => ({ id, label, kind }));
}

export function create(id: string): Plugin {
  const entry = registry.get(id);
  if (!entry) throw new Error(`unknown plugin: ${id}`);
  const plugin = new entry.ctor();
  plugin.id = id;
  // Label each bound control with the field name it was assigned to (for the on-screen surface).
  // (Slots reserved for app globals — knob:9 hue, crossfader — can't reach here: the Plugin factory
  // types reject them at compile time, so there's no runtime collision to guard against.)
  for (const [key, value] of Object.entries(plugin)) {
    if ((value instanceof Param || value instanceof ButtonParam) && !value.name) value.name = key;
  }
  return plugin;
}
