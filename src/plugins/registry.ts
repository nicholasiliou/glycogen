import { ButtonParam, Param } from "@/controls/Param";
import { applyDefaults } from "@/db/appDefaults";
import type { CodeRegistration } from "@/db/boot";
import { paramId, type ParamRow, type PluginRow } from "@/db/schema";
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

/**
 * Plugin ids temporarily kept out of the registry — the file stays on disk (nothing is deleted),
 * it's just not discovered, so it never appears in the browser, the db, or the fillers. Remove an id
 * here to re-enable it. Disabled for the demo: `volumetricCloud`, `pixelSort`.
 */
export const DISABLED = new Set<string>(["volumetricCloud", "pixelSort"]);

const registry = new Map<string, Entry>();
for (const [path, mod] of Object.entries(modules)) {
  const ctor = Object.values(mod).find(isPluginClass);
  if (!ctor) continue;
  const info = metaFromPath(path);
  if (DISABLED.has(info.id)) continue;
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

/** Display label for a plugin id. UI must use this, never `constructor.name` — class names minify
 *  in production builds ("LandscapeLayer" → "el"). */
export function labelOf(id: string): string {
  return registry.get(id)?.label ?? id;
}

export function list(): PluginInfo[] {
  return [...registry.values()].map(({ id, label, kind }) => ({ id, label, kind }));
}

export function create(id: string): Plugin {
  const entry = registry.get(id);
  if (!entry) throw new Error(`unknown plugin: ${id}`);
  const plugin = new entry.ctor();
  plugin.id = id;
  stampNames(plugin);
  applyDefaults(plugin); // admin-saved paramDefaults rows override the code-declared defaults
  return plugin;
}

/** Label each declared param with the field name it was assigned to (drives labels everywhere). */
function stampNames(plugin: Plugin): void {
  for (const [key, value] of Object.entries(plugin)) {
    if ((value instanceof Param || value instanceof ButtonParam) && !value.name) value.name = key;
  }
}

/**
 * Author the db's code-sourced rows from the registry: one `plugins` row per entry and one
 * read-only `params` row per declared field, harvested from a throwaway instance (declarations are
 * field initialisers, so they only exist on instances — constructors are cheap: a canvas + empty
 * state, no rendering).
 */
export function harvestRegistrations(): CodeRegistration {
  const pluginRows: PluginRow[] = [];
  const paramRows: ParamRow[] = [];
  for (const { id, label, kind, ctor } of registry.values()) {
    pluginRows.push({ id, label, kind });
    let plugin: Plugin;
    try {
      plugin = new ctor();
    } catch {
      // A constructor body may need GL/p5 the harvest environment lacks — the declarations are
      // field initialisers and already sit on the under-construction instance.
      plugin = Plugin.underConstruction!;
    }
    let order = 0;
    for (const [key, value] of Object.entries(plugin)) {
      if (!(value instanceof Param || value instanceof ButtonParam)) continue;
      // The factory `color` cycle recolors a *layer* (the Stage reads the generator's) — an
      // effect's own copy is dead weight, so it gets no row: invisible and unbindable.
      if (kind === "effect" && value === plugin.color) continue;
      paramRows.push({ id: paramId(id, key), pluginId: id, name: key, order: order++, control: value.control });
    }
    try {
      plugin.dispose();
    } catch {
      /* partially-constructed throwaway — nothing to release */
    }
  }
  return { plugins: pluginRows, params: paramRows };
}
